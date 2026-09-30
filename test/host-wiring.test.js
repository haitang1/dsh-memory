import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Host-wiring guards: the harness-facing surface of lib/index.js changed under
// the plugin's feet on the DSH 0.1.x line (dsh-settings@0.1.2-rc.1 removed the
// settingsNamespace helper export; the settings namespace is now a bare string).
// These tests keep the host wiring intentionally narrow and observable, so a
// future DSH API drift is caught in CI instead of only at host load time.

const TOOL_NAMES = [
  'memory_read', 'memory_add', 'memory_update', 'memory_delete', 'memory_search',
  'memory_merge', 'memory_review', 'memory_export', 'memory_import', 'memory_stats',
  'memory_browse', 'memory_history', 'memory_rollback', 'memory_sync'
]

test('host wiring: settings namespace is a bare string, not a settingsNamespace helper', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /settings\.register\(\s*'[a-z0-9-]+'\s*,/,
    'settings.register must take the namespace as a plain string (DSH 0.1.2-rc.1 drops settingsNamespace)')
  assert.doesNotMatch(source, /settingsNamespace/,
    'the removed settingsNamespace helper must not be imported or used')
})

test('host wiring: exposes the full tool surface, the turn hook, and the skill', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  for (const name of TOOL_NAMES) {
    assert.match(source, new RegExp(`name:\\s*'${name}'`), `missing tool definition ${name}`)
  }
  assert.match(source, /agent\/turn-stopping/, 'must subscribe to agent/turn-stopping for auto-summarization')
  assert.match(source, /systemPrompt\.context\(/, 'must install a systemPrompt.context injection')
  assert.match(source, /AUTO_MEMORY_SKILL/, 'must register the auto-memory runtime skill')
})

test('host wiring: reads session events through the Surface layer', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /\.snapshotEvents\(/,
    'must keep a session.snapshotEvents fallback (DSH 0.1.2-rc.1 replaced Session.events with the Surface layer)')
  assert.doesNotMatch(source, /\.events\.entries\(\)/,
    'must not call session.events.entries() (removed in DSH 0.1.2-rc.1; throws on every turn summarization)')
  // DSH 0.2.0-rc.2 deprecates snapshotEvents ("new calls are prohibited"), so
  // the forward path is a sessionQuery observation lease. Its events are the
  // raw log: deriveMessages() would drop compaction-shadowed content.
  assert.match(source, /sessionQuery\.observeSession\(|query\.observeSession\(/,
    'must read turns through sessionQuery.observeSession')
  assert.match(source, /inject\(\['sessionQuery'\]/,
    'must wait for the sessionQuery service instead of reading it at boot')
  // Comments may name the API we refuse to use; only real calls matter.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  assert.doesNotMatch(code, /deriveMessages\(/,
    'must never read turn content through deriveMessages (drops compaction-shadowed events)')
})

test('host wiring: waits for the llm service via inject instead of a boot-time ctx.get', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /inject\(\['llm'\]/,
    'must wait for the llm service (ctx.get("llm") is undefined at boot on DSH 0.1.2-rc.1, silently disabling auto-summarization)')
  assert.doesNotMatch(source, /const llm = ctx\.get\('llm'\)/,
    'must not capture llm once at boot; wait for the injected service')
})

test('host wiring: captures subagent results from the delegating agent\u2019s scoped context', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  // dsh-subagent dispatches subagent/* with a scope carrier keyed to the
  // delegating parent agent, so a listener on that agent's own scoped context
  // receives exactly its children. Registering on the host ctx instead would
  // receive every run with no way to tell the parents apart.
  assert.match(source, /agentCtx\.on\('subagent\/end'/,
    'subagent/end must be listened to on the parent agent\u2019s scoped ctx (agent.ctx), not the host ctx')
  assert.match(source, /ctx\.on\('agent\/created'/,
    'agent/created is the earliest host-level hook that carries the agent handle')
  assert.match(source, /formatSubagentResult\(/,
    'the captured excerpt must be bounded by the pure formatter')
  assert.match(source, /captureSubagents: z\.boolean\(\)\.default\(true\)/,
    'the capture switch must exist in the schema')
})

test('host wiring: settings saves patch the namespace and keep a consolidation token floor', async () => {
  const web = await readFile(new URL('../lib/web.js', import.meta.url), 'utf8')
  assert.match(web, /settings\.mutate\(/,
    'saves must go through settings.mutate (path-addressed patch)')
  assert.doesNotMatch(web, /settings\.replace\(/,
    'must not replace the whole user section: that pins current defaults into the user layer, where they outrank every later release default')
  const index = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(index, /consolidateTokenFloor\(/,
    'must floor the consolidation output budget so an inherited override cannot silently break merges')
  assert.match(index, /configAlerts/,
    'must report a lifted budget through diagnostics and memory_stats')
})

test('host wiring: marks config fields volatile so DSH 0.1.7 generates a settings form', async () => {
  // dsh-settings builds a form only for `meta.volatile` fields, and the Loader then
  // commits edits into the running config's boxes instead of re-applying the plugin.
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(source, /volatileField\(/, 'config fields must be marked live-editable where the schema supports it')
  assert.match(source, /plainConfig\(/, 'boxed volatile values must be unboxed before use')
  assert.match(source, /loader\/volatile-update/,
    'must mirror a Loader volatile commit into the resolved config, or a saved setting would do nothing')
})

// apply() smoke on the DSH 0.1.7 settings seam: SettingsForms has no
// `register()`. The plugin must wire up without one -- the namespace becomes the
// loader-row id and the row config IS the settings document -- instead of
// throwing inside the inject callback (which silently killed the settings card
// and left the plugin without a namespace).
test('host wiring: apply() wires up on DSH 0.1.7, where settings.register() no longer exists', async (t) => {
  let plugin
  try {
    plugin = await import('../lib/index.js')
  } catch {
    t.skip('harness packages (@deepseek-ai/dsh-llm, @deepseek-ai/dsh-tools) not resolvable here')
    return
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-memory-smoke-017-'))
  const cleanups = []
  const hook = { tools: [], skills: [], routes: [], systemPrompt: null, events: {} }

  // A cosmokit Volatile box, as DSH 0.1.7 hands a volatile field to apply(): the
  // value is only reachable through get(), and the Loader commits later edits by
  // mutating it in place. `memoryDir` stays a plain value on purpose -- it is a
  // structural field, so the Loader re-applies the plugin instead of hot-committing.
  let liveRawArchiveMaxBytes = 4096
  const volatileBox = (read) => {
    const box = { get: read }
    box[Symbol.for('cosmokit.volatile.write')] = () => {}
    return box
  }
  const boxedConfig = {
    memoryDir: tmpDir,
    rawArchiveMaxBytes: volatileBox(() => liveRawArchiveMaxBytes),
    autoSummarize: false,
    seedFromAgentsMd: false
  }

  // The 0.1.7 service face, verbatim: describe/writable/mutate and no register.
  const settings017 = {
    describe: () => [{ ns: 'dsh-memory', value: {}, base: {}, user: {}, revision: 0 }],
    writable: true,
    mutate: async () => {}
  }

  const fakeCtx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    settings: settings017,
    tools: null,
    skills: null,
    webServer: null,
    get(name) {
      if (name === 'systemPrompt') {
        return {
          context: (cfg) => {
            hook.systemPrompt = cfg
            return () => {}
          }
        }
      }
      return undefined
    },
    inject(names, cb) {
      if (names.includes('settings')) this.settings = settings017
      if (names.includes('tools')) this.tools = { register: (def) => { hook.tools.push(def); return () => {} } }
      if (names.includes('skills')) this.skills = { register: (skill) => { hook.skills.push(skill); return () => {} } }
      if (names.includes('webServer')) this.webServer = { register: (route) => { hook.routes.push(route); return () => {} } }
      cb(this)
    },
    on(event, handler) {
      hook.events[event] = handler
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    }
  }

  try {
    assert.doesNotThrow(
      () => plugin.apply(fakeCtx, boxedConfig),
      'apply() must not throw when the settings provider has no register()'
    )
    assert.equal(hook.tools.length, TOOL_NAMES.length, 'all memory_* tools must still be registered')
    assert.ok(hook.skills.some((skill) => skill.name === 'auto-memory'), 'auto-memory skill must still be registered')
    assert.equal(hook.systemPrompt.name, 'dsh-memory', 'systemPrompt.context must still be installed')
    assert.ok(hook.routes.length >= 1, 'the same-origin settings route must still be registered')

    // Volatile fields arrive boxed: an unhandled box would fall back to the schema
    // default, so reading the real value back proves the unboxing works.
    const stats = hook.tools.find((def) => def.name === 'memory_stats')
    const before = await stats.execute({}, { signal: { aborted: false } })
    assert.equal(before.memoryDir, tmpDir, 'the structural memoryDir must be used as given')
    assert.equal(before.rawArchiveMaxBytes, 4096, 'a boxed rawArchiveMaxBytes must be unboxed')

    // A 0.1.7 settings save mutates the box and emits loader/volatile-update instead
    // of re-applying the plugin; the plugin must pick the new value up.
    assert.equal(typeof hook.events['loader/volatile-update'], 'function',
      'must subscribe to loader/volatile-update so a saved setting takes effect')
    liveRawArchiveMaxBytes = 8192
    hook.events['loader/volatile-update']()
    const after = await stats.execute({}, { signal: { aborted: false } })
    assert.equal(after.rawArchiveMaxBytes, 8192, 'a volatile edit must reach the resolved config')
  } finally {
    for (const dispose of cleanups) {
      try { dispose() } catch { /* ignore disposal errors */ }
    }
    rmSync(tmpDir, { recursive: true, force: true })
  }
})
// apply() smoke: drives the real plugin entry through a fake cordis ctx and
// asserts the host wiring actually registers everything. Imports the harness
// packages (dsh-llm / dsh-tools) transitively, so it only runs where they are
// resolvable; in zero-dependency CI it skips so the suite stays green.
test('host wiring: apply() registers the memory settings, 14 tools, the skill, and the injection hook', async (t) => {
  let plugin
  try {
    plugin = await import('../lib/index.js')
  } catch {
    t.skip('harness packages (@deepseek-ai/dsh-llm, @deepseek-ai/dsh-tools) not resolvable here')
    return
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'dsh-memory-smoke-'))
  const cleanups = []
  const hook = { settings: null, tools: [], skills: [], routes: [], systemPrompt: null, events: {} }

  const fakeSettings = {
    register(namespace, config, opts) {
      hook.settings = { namespace, config, opts }
      // The real scope resolves schema defaults -> composition base -> user; the
      // fake carries the composition base (the loader config) as that value.
      return { get: () => ({ ...opts.base }), watch: () => () => {} }
    },
    describe: () => [{ ns: 'memory', value: {}, base: {}, user: {}, revision: 0 }],
    writable: true,
    mutate: async () => {},
    replace: async () => {}
  }

  const fakeCtx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    settings: fakeSettings,
    tools: null,
    skills: null,
    webServer: null,
    get(name) {
      if (name === 'systemPrompt') {
        return {
          context: (cfg) => {
            hook.systemPrompt = cfg
            return () => {}
          }
        }
      }
      return undefined
    },
    inject(names, cb) {
      if (names.includes('settings')) this.settings = fakeSettings
      if (names.includes('tools')) this.tools = { register: (def) => { hook.tools.push(def); return () => {} } }
      if (names.includes('skills')) this.skills = { register: (skill) => { hook.skills.push(skill); return () => {} } }
      if (names.includes('webServer')) this.webServer = { register: (route) => { hook.routes.push(route); return () => {} } }
      cb(this)
    },
    on(event, handler) {
      hook.events[event] = handler
      return () => {}
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') cleanups.push(dispose)
      return dispose
    }
  }

  try {
    plugin.apply(fakeCtx, { memoryDir: tmpDir, autoSummarize: false, seedFromAgentsMd: false, consolidateMaxTokens: 3000 })

    assert.equal(hook.settings.namespace, 'memory', 'settings namespace must be the bare string "memory"')
    assert.equal(hook.tools.length, TOOL_NAMES.length, 'all memory_* tools must be registered')
    assert.deepEqual(hook.tools.map((def) => def.name).sort(), TOOL_NAMES.slice().sort())
    assert.ok(hook.skills.some((skill) => skill.name === 'auto-memory'), 'auto-memory skill must be registered')
    assert.equal(hook.systemPrompt.name, 'dsh-memory', 'systemPrompt.context must be installed with name dsh-memory')
    assert.equal(hook.systemPrompt.order, 2000)
    assert.equal(typeof hook.events['agent/turn-stopping'], 'function', 'agent/turn-stopping handler must be subscribed')
    assert.ok(hook.routes.length >= 1, 'the same-origin settings route must be registered')

    // A user-layer override below the safe floor must be lifted (not obeyed) and
    // the lift reported, instead of failing every merge with 'max tokens'.
    const stats = hook.tools.find((def) => def.name === 'memory_stats')
    const value = await stats.execute({}, { signal: { aborted: false } })
    assert.equal(value.consolidateMaxTokens, 4096, 'consolidateMaxTokens must be floored for a maxBytes-sized summary')
    assert.equal(value.configAlerts.length, 1, 'a lifted budget must be reported')
    assert.equal(value.configAlerts[0].key, 'consolidateMaxTokens')
    assert.equal(value.configAlerts[0].configured, 3000)
  } finally {
    for (const dispose of cleanups) {
      try { dispose() } catch { /* ignore disposal errors */ }
    }
    rmSync(tmpDir, { recursive: true, force: true })
  }
})
