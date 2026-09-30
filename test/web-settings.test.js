import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { installMemorySettingsWeb, memorySettingsRouteHandler } from '../lib/web.js'

/** Minimal server-response fake capturing the status, headers, and JSON body. */
function fakeResponse() {
  const res = {
    headers: {},
    status: 0,
    ended: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    writeHead(status) { this.status = status },
    end(body) { this.ended = Buffer.isBuffer(body) ? body.toString('utf8') : String(body) }
  }
  return res
}

function fakeRequest(method, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  req.headers = headers
  return req
}

function fakeSettings() {
  const calls = []
  const settings = {
    writable: true,
    value: { maxBytes: 8000, autoSummarize: true, consolidateEvery: 3, seedFromAgentsMd: true },
    revision: 7,
    base: undefined,
    user: undefined,
    describe() {
      return [{
        ns: 'memory',
        value: settings.value,
        ...settings.base === undefined ? {} : { base: settings.base },
        ...settings.user === undefined ? {} : { user: settings.user },
        revision: settings.revision
      }]
    },
    applyOps(ops) {
      const next = { ...settings.value }
      for (const op of ops) {
        if (op.op === 'set') next[op.path[0]] = op.value
        else delete next[op.path[0]]
      }
      settings.value = next
      if (settings.user !== undefined) {
        const user = { ...settings.user }
        for (const op of ops) {
          if (op.op === 'set') user[op.path[0]] = op.value
          else delete user[op.path[0]]
        }
        settings.user = user
      }
      settings.revision += 1
    },
    async mutate(ns, ops, expectedRevision) {
      calls.push({ method: 'mutate', ns, ops, expectedRevision })
      settings.applyOps(ops)
    },
    async replace(ns, section, expectedRevision) {
      calls.push({ method: 'replace', ns, section, expectedRevision })
      settings.value = section
      settings.revision += 1
    }
  }
  return { settings, calls }
}

/** Same-origin POST helper for the settings endpoint. */
async function postSettings(settings, payload, readDefaults) {
  const handler = memorySettingsRouteHandler(fakeCtx, settings, readDefaults)
  const res = fakeResponse()
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload)
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  return res
}

const fakeCtx = { logger: { warn: () => {} } }

test('settings card resolves the loader-row namespace on DSH 0.1.7 (no settings.register)', async () => {
  // DSH 0.1.7-rc.1 removed SettingsProvider.register() and derives a plugin's
  // settings namespace from its loader-row id (this bundle's cordis.patch.yml
  // row is `dsh-memory`), so the card must probe for it instead of assuming the
  // registered name `memory`.
  const calls = []
  const settings = {
    writable: true,
    describe: () => [{ ns: 'dsh-memory', value: { maxBytes: 8000 }, revision: 3 }],
    async mutate(ns, ops, expectedRevision) { calls.push({ ns, ops, expectedRevision }) }
  }
  const handler = memorySettingsRouteHandler(fakeCtx, settings)

  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 200)
  assert.equal(JSON.parse(res.ended).value.settings.value.maxBytes, 8000)

  const save = fakeResponse()
  await handler(fakeRequest('POST', JSON.stringify({ action: 'save', expectedRevision: 3, set: { maxBytes: 4000 }, unset: [] }), { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), save)
  assert.equal(save.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ns, 'dsh-memory', 'saves must target whichever namespace the running DSH line exposes')
})

test('GET returns the memory settings snapshot', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.settings.value.maxBytes, 8000)
  assert.equal(payload.value.settings.revision, 7)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('POST saves the section and returns the updated snapshot', async () => {
  const { settings, calls } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  const body = JSON.stringify({ action: 'save', expectedRevision: 7, value: { maxBytes: 4000, autoSummarize: false, consolidateEvery: 5, seedFromAgentsMd: false } })
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.settings.value.maxBytes, 4000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ns, 'memory')
  assert.equal(calls[0].expectedRevision, 7)
})

test('POST persists only the fields that differ from the resolved value', async () => {
  const { settings, calls } = fakeSettings()
  // A legacy card posts the whole form; only maxBytes actually changed here.
  const res = await postSettings(settings, {
    action: 'save',
    expectedRevision: 7,
    value: { maxBytes: 4000, autoSummarize: true, consolidateEvery: 3, seedFromAgentsMd: true }
  }, () => ({ maxBytes: 8000, autoSummarize: true, consolidateEvery: 3, seedFromAgentsMd: true }))
  assert.equal(res.status, 200)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].method, 'mutate', 'saves must patch the namespace, not replace the whole section')
  assert.deepEqual(calls[0].ops, [{ op: 'set', path: ['maxBytes'], value: 4000 }])
})

test('POST drops a user-layer override that is saved back at its default', async () => {
  const { settings, calls } = fakeSettings()
  settings.user = { consolidateMaxTokens: 3000 }
  settings.value = { ...settings.value, consolidateMaxTokens: 3000 }
  const res = await postSettings(settings, {
    action: 'save',
    expectedRevision: 7,
    value: { ...settings.value, consolidateMaxTokens: 8192 }
  }, () => ({ maxBytes: 8000, consolidateMaxTokens: 8192 }))
  assert.equal(res.status, 200)
  assert.deepEqual(calls[0].ops, [{ op: 'unset', path: ['consolidateMaxTokens'] }])
  assert.equal(JSON.parse(res.ended).value.settings.value.consolidateMaxTokens, undefined)
})

test('POST accepts an explicit set/unset diff from the card', async () => {
  const { settings, calls } = fakeSettings()
  settings.user = { consolidateMaxTokens: 3000 }
  settings.value = { ...settings.value, consolidateMaxTokens: 3000 }
  const res = await postSettings(settings, {
    action: 'save',
    expectedRevision: 7,
    set: { maxBytes: 4000 },
    unset: ['consolidateMaxTokens']
  }, () => ({ maxBytes: 8000, consolidateMaxTokens: 8192 }))
  assert.equal(res.status, 200)
  assert.deepEqual(calls[0].ops, [
    { op: 'unset', path: ['consolidateMaxTokens'] },
    { op: 'set', path: ['maxBytes'], value: 4000 }
  ])
})

test('GET exposes schema defaults so the card can spot a reset field', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings, () => ({ maxBytes: 8000 }))
  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.ended).value.settings.defaults, { maxBytes: 8000 })
})

test('POST rejects a malformed save payload', async () => {
  const { settings } = fakeSettings()
  const badSet = await postSettings(settings, { action: 'save', expectedRevision: 7, set: [] })
  assert.equal(badSet.status, 400)
  assert.equal(JSON.parse(badSet.ended).error.code, 'invalid-request')
  const badUnset = await postSettings(settings, { action: 'save', expectedRevision: 7, unset: ['', 5] })
  assert.equal(badUnset.status, 400)
  assert.equal(JSON.parse(badUnset.ended).error.code, 'invalid-request')
})

test('POST rejects a cross-site origin', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('POST', '{}', { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }), res)
  assert.equal(res.status, 403)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'origin-rejected')
})

test('POST maps a settings conflict to 409', async () => {
  const { settings } = fakeSettings()
  const conflict = new Error('moved')
  conflict.code = 'SETTINGS_CONFLICT'
  settings.mutate = async () => { throw conflict }
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  const body = JSON.stringify({ action: 'save', expectedRevision: 7, value: { maxBytes: 4000 } })
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 409)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'settings-conflict')
})

test('unsupported POST actions are rejected', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('POST', JSON.stringify({ action: 'explode' }), { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.ended).error.code, 'invalid-request')
})

test('Web route waits for the webServer service before registering', () => {
  const settings = fakeSettings()
  const registrations = []
  const effects = []
  const fakeCtx = {
    logger: { warn() {} },
    inject(services, callback) {
      assert.deepEqual([...services], ['webServer'])
      callback({
        webServer: {
          register(options) {
            registrations.push(options)
            return () => {}
          }
        },
        effect(effect, label) {
          effects.push(label)
          return effect()
        }
      })
    }
  }

  installMemorySettingsWeb(fakeCtx, settings)

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].kind, 'exact')
  assert.equal(registrations[0].path, '/_dsh/memory/settings')
  assert.equal(typeof registrations[0].handler, 'function')
  assert.ok(effects.includes('dsh-memory: settings route'))
})

test('client bundle registers the settings.plugin.item card', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /__ModuleLoader__\.load\(\{\s*id: '@dsh-external\/dsh-memory'/)
  assert.match(source, /exports\.inject = \['slots', 'locale'\]/)
  assert.match(source, /settings\.plugin\.item/)
  assert.match(source, /key: 'memory'/)
  assert.match(source, /function apply\(ctx\)/)
  assert.match(source, /_dsh\/memory\/settings/)
  assert.match(source, /locale\.register\(NS, \{ en: en, zh: zh \}\)/)
  assert.match(source, /var zh = \{/)
  // Aligns with the built-in plugin card structure.
  assert.match(source, /dmm-headText/)
  assert.match(source, /dmm-pending/)
  assert.match(source, /dmm-footer/)
  assert.match(source, /IconChevronDownOutline14/)
  assert.match(source, /dmm-chevOpen/)
  // Saves must send a minimal set/unset patch rather than the whole form:
  // posting every field pins today's defaults into the user layer, where they
  // outrank later releases' defaults and silently break the pipeline.
  assert.match(source, /function savePatch\(\)/)
  assert.match(source, /set: patch\.set, unset: patch\.unset/)
  assert.doesNotMatch(source, /value:\s*draft/, 'the card must not post the whole form')
})

test('card exposes every config field with localized copy and correct controls', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  // Every config field (see Config in lib/index.js) must have en+zh label and
  // hint keys (checkboxes carry label-only rows), rendered in the card body.
  const labelOnly = ['autoSummarize', 'scopedMemory', 'redactSecrets', 'seedFromAgentsMd']
  const withHint = [
    'memoryDir', 'maxBytes', 'consolidateMaxBytes', 'keepSummaryVersions',
    'rawArchiveMaxBytes', 'summarizeProvider', 'summarizeModel',
    'summarizeDebounceMs', 'consolidateEvery', 'summaryMaxTokens',
    'consolidateMaxTokens', 'llmRetries', 'maxActiveSummaries', 'scopeMaxBytes',
    'readOnlyScopes', 'embeddingBaseURL', 'embeddingApiKey', 'embeddingModel'
  ]
  for (const key of labelOnly) {
    const occurrences = (source.match(new RegExp(key + 'Label', 'g')) || []).length
    assert.ok(occurrences >= 2, `${key}Label must exist in en and zh (found ${occurrences})`)
  }
  for (const key of withHint) {
    const labelHits = (source.match(new RegExp(key + 'Label', 'g')) || []).length
    const hintHits = (source.match(new RegExp(key + 'Hint', 'g')) || []).length
    assert.ok(labelHits >= 2, `${key}Label must exist in en and zh (found ${labelHits})`)
    assert.ok(hintHits >= 2, `${key}Hint must exist in en and zh (found ${hintHits})`)
  }

  // Group headings render in both locales and the body renders them.
  for (const key of ['groupGeneral', 'groupAuto', 'groupScopes', 'groupSecurity']) {
    assert.ok((source.match(new RegExp(key, 'g')) || []).length >= 3, `${key} must be defined and rendered`)
  }

  // Controls: secret field is masked; readOnlyScopes round-trips through a
  // comma-separated text input; every field writes through update(key, ...).
  assert.match(source, /type: 'password'/)
  assert.match(source, /readOnlyScopes', event\.target\.value\.split\(','\)/)
  assert.match(source, /readOnlyScopes\) \? value\.readOnlyScopes\.join\(', '\)/)
  for (const key of withHint) {
    assert.ok(source.includes(`update('${key}'`), `card must wire update('${key}', ...)`)
  }
})

test('client bundle loads in a browser-like sandbox, localizes, and registers the card', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  const slotRegistrations = []
  const fakeReact = {
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props, children })
  }
  const requireMock = (spec) => {
    if (spec === 'react') return fakeReact
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        IconChevronDownOutline14: (props) => ({ type: 'svg', props: props || {} })
      }
    }
    throw new Error(`unexpected require: ${spec}`)
  }

  let loaded = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(spec) { loaded = spec }
      }
    }
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })

  assert.ok(loaded, 'ModuleLoader.load must be called')
  assert.equal(loaded.id, '@dsh-external/dsh-memory')

  const exports = loaded.factory(requireMock)
  assert.deepEqual([...exports.inject], ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')

  const effects = []
  const localeRegistrations = []
  const localeBindings = []
  const fakeCtx = {
    effect(fn, label) {
      effects.push({ fn, label })
      // Cordis executes the effect callback immediately and keeps its disposer.
      const disposer = fn()
      return () => { if (typeof disposer === 'function') disposer() }
    },
    locale: {
      register(ns, dicts) {
        localeRegistrations.push({ ns, dicts })
        return () => {}
      },
      bind(ns) {
        localeBindings.push(ns)
        // Return a translator that stamps the key so the card's copy can be
        // observed coming from `t(...)` rather than a hard-coded string.
        return (key) => `t:${key}`
      }
    },
    slots: {
      inject(key, callback) {
        assert.equal(key, 'settings.plugin.item')
        const injection = callback()
        slotRegistrations.push(injection)
        return () => {}
      },
      register(options, component) {
        return { options, component }
      }
    }
  }
  exports.apply(fakeCtx)

  assert.equal(slotRegistrations.length, 1)
  const registration = slotRegistrations[0]
  assert.equal(registration.options.name, 'settings.plugin.item')
  assert.equal(registration.options.key, 'memory')
  assert.equal(registration.options.order, 30)
  assert.equal(typeof registration.options.label, 'function')
  assert.equal(registration.options.label(), 't:nav')
  assert.equal(typeof registration.component, 'function')

  // locale registered with en/zh dictionaries carrying the card copy keys
  assert.equal(localeRegistrations.length, 1)
  assert.equal(localeRegistrations[0].ns, 'dsh-memory')
  assert.ok(localeRegistrations[0].dicts.en && localeRegistrations[0].dicts.zh)
  assert.equal(typeof localeRegistrations[0].dicts.zh.save, 'string')
  assert.equal(typeof localeRegistrations[0].dicts.zh.saved, 'string')
  assert.deepEqual(localeBindings, ['dsh-memory'])

  // Rendering the card (initial loading state) draws localized copy via t()
  const tree = registration.component()
  const treeText = JSON.stringify(tree)
  assert.ok(treeText.includes('t:loading') || treeText.includes('t:unavailable'), 'card copy must come from t()')
  assert.ok(effects.some((entry) => entry.label && entry.label.includes('locale')))
  assert.ok(effects.some((entry) => entry.label && entry.label.includes('settings card styles')))
})

test('client bundle registers the DSH 0.1.7 Plugins-page form on the row-config slot', () => {
  // 0.1.7 has no `settings.plugin.item` slot and no provider-side namespace: the
  // form is the configuration of the bundle's own row, registered into
  // `plugins.row.config` under `<bundle>#<rowId>` and gated by configForms.
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

  const fakeReact = {
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props, children })
  }

  /** A stand-in for the 0.1.7 primitives' generic settings-form toolkit. */
  const modelCalls = { constructed: 0, specs: null, fields: [], binds: 0, disposed: 0 }
  /** A small live model: drafts and the dirty flag move, listeners fire. */
  class FakeSettingsFormModel {
    constructor(scope, specs) {
      modelCalls.constructed += 1
      modelCalls.scope = scope
      modelCalls.specs = specs
      this.scope = scope
      this.drafts = {}
      this.dirtyFlag = false
      this.listeners = []
    }
    bind(project) {
      modelCalls.binds += 1
      this.store = { getSnapshot: () => project(), subscribe: (listener) => { this.listeners.push(listener); return () => {} } }
      return this.store
    }
    shell() {
      return { available: true, writable: true, dirty: this.dirtyFlag, invalid: false, saving: false, failed: false }
    }
    field(name) {
      modelCalls.fields.push(name)
      const text = Object.prototype.hasOwnProperty.call(this.drafts, name) ? this.drafts[name] : `value:${name}`
      return { text, overridden: false, invalid: false }
    }
    actions() {
      const self = this
      return {
        edit: (field, text) => { self.drafts[field] = text; self.dirtyFlag = true; self.publish() },
        resetField: (field) => { self.drafts[field] = ''; self.dirtyFlag = true; self.publish() },
        save: () => { self.dirtyFlag = false; self.publish() },
        discard: () => { self.drafts = {}; self.dirtyFlag = false; self.publish() }
      }
    }
    publish() { for (const listener of this.listeners) listener() }
    dispose() { modelCalls.disposed += 1 }
  }
  /** The generic primitives the card renders, as identity-checkable stubs. */
  const SettingsFormStub = (props) => ({ type: 'SettingsForm', props })
  const SettingsValueFieldStub = (props) => ({ type: 'SettingsValueField', props })
  const SettingsSecretFieldStub = (props) => ({ type: 'SettingsSecretField', props })
  const primitives = {
    IconChevronDownOutline14: (props) => ({ type: 'svg', props: props || {} }),
    SettingsFormModel: FakeSettingsFormModel,
    settingsNumberField: (field) => ({ field, format: () => '', parse: () => undefined }),
    settingsTextField: (field) => ({ field, format: () => '', parse: () => undefined }),
    SettingsForm: SettingsFormStub,
    SettingsValueField: SettingsValueFieldStub,
    SettingsSecretField: SettingsSecretFieldStub
  }
  const requireMock = (spec) => {
    if (spec === 'react') return fakeReact
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error(`unexpected require: ${spec}`)
  }

  let loaded = null
  const sandbox = { window: { __ModuleLoader__: { load(spec) { loaded = spec } } } }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  assert.equal(loaded.id, '@dsh-external/dsh-memory')
  const exports = loaded.factory(requireMock)

  const injected = []
  const registrations = []
  const gets = []
  const served = []
  const localeRegistrations = []
  const fakeCtx = {
    effect(fn) {
      const disposer = fn()
      return () => { if (typeof disposer === 'function') disposer() }
    },
    locale: {
      register(ns, dicts) { localeRegistrations.push({ ns, dicts }); return () => {} },
      bind: () => (key) => `t:${key}`
    },
    slots: {
      inject(key, callback) {
        injected.push(key)
        if (key === 'settings.plugin.item') return () => {} // absent on 0.1.7
        registrations.push(callback())
        return () => {}
      },
      register: (options, component) => ({ options, component })
    },
    inject(names, callback) {
      assert.deepEqual([...names], ['configForms', 'slots'], 'must wait for the settings-forms service')
      callback(this)
    },
    configForms: {
      get(ns) { gets.push(ns); return { __scope: ns } },
      whileServed(namespaces, register) { served.push([...namespaces]); return register(new Set(namespaces)) }
    }
  }
  exports.apply(fakeCtx)

  assert.deepEqual(gets, ['dsh-memory'], 'the form binds the settings namespace the Host serves')
  assert.deepEqual(served, [['dsh-memory']])
  assert.equal(registrations.length, 1)
  const registration = registrations[0]
  assert.equal(registration.options.name, 'plugins.row.config')
  assert.equal(registration.options.key, '@dsh-external/dsh-memory#dsh-memory')
  assert.equal(registration.options.locale, 'dsh-memory')
  // A keyed slot dispatches by key alone; `order`/`label` are list-slot fields
  // and are ignored (type-invalid) here, so they must not be passed.
  assert.equal(registration.options.order, undefined)
  assert.equal(registration.options.label, undefined)
  assert.equal(modelCalls.constructed, 1)

  const face = registration.options.inject()
  assert.ok(face.hooks && face.hooks.memoryForm, 'the form hook must be injected')
  for (const action of ['edit', 'resetField', 'save', 'discard']) {
    assert.equal(typeof face[action], 'function', `the form must inject ${action}`)
  }

  // Summary view is the row's one-liner; page view is the settings form. The slot
  // framework injects the form hook for both views, as it does for the core cards.
  const t = (key) => `t:${key}`
  const useMemoryForm = (select) => select(face.hooks.memoryForm.getSnapshot())
  assert.equal(registration.component({ view: 'summary', t, useMemoryForm }), 't:desc')

  const props = { view: 'page', t, useMemoryForm, ...face }
  const tree = registration.component(props)
  assert.equal(tree.type, SettingsFormStub, 'the page view renders the shared settings form')
  assert.equal(tree.props.onSave, face.save)
  assert.equal(tree.props.onDiscard, face.discard)
  assert.equal(tree.props.labels.save, 't:save')
  // React accepts one array child and flattens it; the stub records it as one arg.
  const controls = tree.children.flat()
  assert.equal(controls.length, 22, 'every live-editable field must render a control')
  // The embeddings API key is masked: a secret control with a configured badge,
  // while every other field is a plain value control.
  const secrets = controls.filter((child) => child.type === SettingsSecretFieldStub)
  const values = controls.filter((child) => child.type === SettingsValueFieldStub)
  assert.equal(secrets.length, 1, 'exactly one field is a secret control')
  assert.equal(secrets[0].props.id, 'dsh-memory-embeddingApiKey')
  assert.equal(secrets[0].props.configured, true, 'a non-empty staged value reads as configured')
  assert.equal(secrets[0].props.stateLabel, 't:formSecretSet')
  assert.equal(typeof secrets[0].props.onEdit, 'function')
  assert.equal(secrets[0].props.onReset, undefined, 'the secret control has no reset affordance')
  assert.equal(values.length, 21)
  for (const child of values) {
    assert.match(child.props.label, /^t:\w+Label$/, 'each control must be labelled from the dictionary')
    assert.equal(typeof child.props.onEdit, 'function')
    assert.equal(typeof child.props.onReset, 'function')
  }
  // The two structural fields are not part of the served namespace.
  const rendered = controls.map((child) => child.props.id)
  assert.ok(!rendered.includes('dsh-memory-memoryDir'), 'memoryDir is not live-editable')
  assert.ok(!rendered.includes('dsh-memory-seedFromAgentsMd'), 'seedFromAgentsMd is not live-editable')
  assert.ok(rendered.includes('dsh-memory-maxBytes'))

  // The badge previews the save. All three states need copy in both dictionaries.
  assert.equal(typeof localeRegistrations[0].dicts.zh.formSecretPending, 'string')
  assert.equal(localeRegistrations[0].dicts.en.formSecretPending, 'Pending save')
  // Object.keys, not deepEqual: the projection comes from the VM realm, so its
  // object literal has a different Object.prototype than this test's.
  assert.deepEqual(Object.keys(face.hooks.memoryForm.getSnapshot().pendingEdits), [], 'nothing is pending before an edit')

  // Stage an edit on the masked field: the form goes dirty and that field is pending.
  face.edit('embeddingApiKey', 'sk-live-value')
  const staged = face.hooks.memoryForm.getSnapshot()
  assert.equal(staged.dirty, true)
  assert.equal(staged.pendingEdits.embeddingApiKey, true)
  const pendingTree = registration.component({ ...props, useMemoryForm: (select) => select(staged) })
  const pendingSecret = pendingTree.children.flat().find((child) => child.type === SettingsSecretFieldStub)
  assert.equal(pendingSecret.props.stateLabel, 't:formSecretPending', 'a staged secret reads as pending, not saved')
  assert.equal(pendingSecret.props.text, 'sk-live-value')

  // A save that lands clears the pending set, and the badge falls back to configured.
  face.save()
  const saved = face.hooks.memoryForm.getSnapshot()
  assert.equal(saved.dirty, false)
  assert.deepEqual(Object.keys(saved.pendingEdits), [], 'a landed save clears the pending set')
  const savedTree = registration.component({ ...props, useMemoryForm: (select) => select(saved) })
  const savedSecret = savedTree.children.flat().find((child) => child.type === SettingsSecretFieldStub)
  assert.equal(savedSecret.props.stateLabel, 't:formSecretSet')
})
