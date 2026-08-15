// dsh-memory: Codex-like persistent memory for DeepSeek Harness.
//
// Storage layout under $DSH_HOME/memories/ (default ~/.dsh/memories/):
//   memory_summary.md          distilled, versioned, bounded memory injected into every prompt
//   raw_memories.md            append-only dated entries written by the memory tools
//   rollout_summaries/<sid>.md per-session turn summaries produced by auto-summarization
//   journal.jsonl              mutation journal (add/update/delete) consumed by consolidation
//   state.json                 consolidation bookkeeping (version, journal cursor, rollout cursor)
//
// Injection: a systemPrompt.context provider re-reads memory_summary.md at every
// prompt assembly, so tool writes surface in the very next model step.
//
// Auto-summarization: on agent/turn-stopping (root agents only), the turn's new
// text is distilled with the default model into a rollout summary; when enough
// new summary blocks (or pending journal mutations) exist, the global summary
// is re-distilled (atomic write, version bump). Summarization is debounced and
// singleton per session, consolidation is singleton, and every LLM call has a
// timeout; background jobs never block a turn.
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  SUMMARY_FILE,
  SUMMARY_HEADER,
  RAW_FILE,
  DEFAULT_MAX_BYTES,
  DEFAULT_CONSOLIDATE_EVERY,
  DEFAULT_CONSOLIDATE_MAX_BYTES,
  DEFAULT_KEEP_SUMMARY_VERSIONS,
  DEFAULT_RAW_ARCHIVE_MAX_BYTES,
  DEFAULT_SCOPE_MAX_BYTES,
  byteLength,
  truncateUtf8,
  truncateUtf8Markdown,
  validateMergedSummary,
  tokenizeQuery,
  makeSnippet,
  summaryVersion,
  ensureVersionLine,
  finishError,
  hashText,
  validateContent,
  normalizeTags,
  journalToNetChanges,
  buildConsolidationInput,
  MemoryStore,
  findGitRoot,
  normalizeScopeArg,
  parseRaw,
  projectScopeKey,
  scopeFromSession,
  scopeKeyForCwd,
  serializeRaw,
  scopedStoreDir
} from './store.js'

export const name = 'dsh-memory'

const MIN_TURN_BYTES = 200
const MAX_TURN_INPUT_BYTES = 40000
const DEBOUNCE_MS = 5 * 60 * 1000
const CONSOLIDATE_INTERVAL_MS = 10 * 60 * 1000
const LLM_TIMEOUT_MS = 60 * 1000
const MAX_ROLLOUT_FILES = 16
const DEFAULT_SUMMARY_MAX_TOKENS = 600
const DEFAULT_CONSOLIDATE_MAX_TOKENS = 1500
const DEFAULT_LLM_RETRIES = 1
const DEFAULT_MAX_ACTIVE_SUMMARIES = 4

export const Config = z.object({
  memoryDir: z.string().default(''),
  maxBytes: z.number().step(1).min(256).max(1048576).default(DEFAULT_MAX_BYTES),
  consolidateMaxBytes: z.number().step(1).min(1024).max(1048576).default(DEFAULT_CONSOLIDATE_MAX_BYTES),
  keepSummaryVersions: z.number().step(1).min(0).max(100).default(DEFAULT_KEEP_SUMMARY_VERSIONS),
  rawArchiveMaxBytes: z.number().step(1).min(1024).max(10485760).default(DEFAULT_RAW_ARCHIVE_MAX_BYTES),
  autoSummarize: z.boolean().default(true),
  summarizeProvider: z.string().default(''),
  summarizeModel: z.string().default(''),
  consolidateEvery: z.number().step(1).min(1).max(64).default(DEFAULT_CONSOLIDATE_EVERY),
  summaryMaxTokens: z.number().step(1).min(64).max(8192).default(DEFAULT_SUMMARY_MAX_TOKENS),
  consolidateMaxTokens: z.number().step(1).min(128).max(16384).default(DEFAULT_CONSOLIDATE_MAX_TOKENS),
  llmRetries: z.number().step(1).min(0).max(3).default(DEFAULT_LLM_RETRIES),
  maxActiveSummaries: z.number().step(1).min(1).max(32).default(DEFAULT_MAX_ACTIVE_SUMMARIES),
  scopedMemory: z.boolean().default(false),
  scopeMaxBytes: z.number().step(1).min(0).max(1048576).default(DEFAULT_SCOPE_MAX_BYTES),
  seedFromAgentsMd: z.boolean().default(true)
})

function resolveConfig(config = {}) {
  const merged = { ...config }
  return {
    memoryDir: typeof merged.memoryDir === 'string' ? merged.memoryDir : '',
    maxBytes: Number.isFinite(merged.maxBytes) && merged.maxBytes > 0 ? merged.maxBytes : DEFAULT_MAX_BYTES,
    consolidateMaxBytes: Number.isFinite(merged.consolidateMaxBytes) && merged.consolidateMaxBytes > 0 ? merged.consolidateMaxBytes : DEFAULT_CONSOLIDATE_MAX_BYTES,
    keepSummaryVersions: Number.isFinite(merged.keepSummaryVersions) && merged.keepSummaryVersions >= 0 ? merged.keepSummaryVersions : DEFAULT_KEEP_SUMMARY_VERSIONS,
    rawArchiveMaxBytes: Number.isFinite(merged.rawArchiveMaxBytes) && merged.rawArchiveMaxBytes > 0 ? merged.rawArchiveMaxBytes : DEFAULT_RAW_ARCHIVE_MAX_BYTES,
    autoSummarize: merged.autoSummarize !== false,
    summarizeProvider: typeof merged.summarizeProvider === 'string' ? merged.summarizeProvider : '',
    summarizeModel: typeof merged.summarizeModel === 'string' ? merged.summarizeModel : '',
    consolidateEvery: Number.isFinite(merged.consolidateEvery) && merged.consolidateEvery > 0 ? merged.consolidateEvery : DEFAULT_CONSOLIDATE_EVERY,
    summaryMaxTokens: Number.isFinite(merged.summaryMaxTokens) && merged.summaryMaxTokens > 0 ? merged.summaryMaxTokens : DEFAULT_SUMMARY_MAX_TOKENS,
    consolidateMaxTokens: Number.isFinite(merged.consolidateMaxTokens) && merged.consolidateMaxTokens > 0 ? merged.consolidateMaxTokens : DEFAULT_CONSOLIDATE_MAX_TOKENS,
    llmRetries: Number.isFinite(merged.llmRetries) && merged.llmRetries >= 0 ? merged.llmRetries : DEFAULT_LLM_RETRIES,
    maxActiveSummaries: Number.isFinite(merged.maxActiveSummaries) && merged.maxActiveSummaries > 0 ? merged.maxActiveSummaries : DEFAULT_MAX_ACTIVE_SUMMARIES,
    scopedMemory: merged.scopedMemory === true,
    scopeMaxBytes: Number.isFinite(merged.scopeMaxBytes) && merged.scopeMaxBytes >= 0 ? merged.scopeMaxBytes : DEFAULT_SCOPE_MAX_BYTES,
    seedFromAgentsMd: merged.seedFromAgentsMd !== false
  }
}

function dshHome() {
  const env = process.env.DSH_HOME
  return env && env.trim().length > 0 ? env.trim() : join(homedir(), '.dsh')
}

function isRootSession(session) {
  const header = session?.header
  return header !== undefined && header.parentSession === undefined && header.origin !== 'subagent'
}

function extractTurnText(agent, fromSeq) {
  let text = ''
  let lastSeq = fromSeq
  for (const [seq, event] of agent.session.events.entries()) {
    if (seq <= fromSeq) continue
    if (seq > lastSeq) lastSeq = seq
    if (event.type !== 'user/message' && event.type !== 'assistant/message') continue
    const data = event.data
    const content = Array.isArray(data && data.content) ? data.content : []
    for (const block of content) {
      if (block && block.type === 'text' && typeof block.text === 'string') text += block.text + '\n'
    }
  }
  const bytes = byteLength(text)
  if (bytes > MAX_TURN_INPUT_BYTES) text = truncateUtf8(text, MAX_TURN_INPUT_BYTES)
  return { text, lastSeq }
}

function journalChangeText(change) {
  const op = String(change.op || 'add')
  const id = String(change.id || 'unknown')
  const entry = change.entry
  if (op === 'delete') {
    return `- [${change.seq}] DELETED ${id}: ${String(entry && entry.content !== undefined ? entry.content : '')}`
  }
  const verb = op === 'update' ? 'UPDATED' : 'ADDED'
  const tags = Array.isArray(entry && entry.tags) && entry.tags.length > 0 ? ` (tags: ${entry.tags.join(', ')})` : ''
  return `- [${change.seq}] ${verb} ${id}: ${String(entry && entry.content !== undefined ? entry.content : '')}${tags}`
}

export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const configuredDir = resolved.memoryDir.trim().length > 0 ? resolved.memoryDir.trim() : join(dshHome(), 'memories')
  const store = new MemoryStore(configuredDir)
  store.rawArchiveMaxBytes = resolved.rawArchiveMaxBytes
  const scopedStores = new Map()
  const runtimes = new Map()
  let globalRuntimeReady = null

  function storeForScope(scopeKey) {
    if (scopeKey === 'global') return store
    let scoped = scopedStores.get(scopeKey)
    if (scoped === undefined) {
      scoped = new MemoryStore(scopedStoreDir(configuredDir, scopeKey))
      scoped.rawArchiveMaxBytes = store.rawArchiveMaxBytes
      scoped.writeBlocked = store.writeBlocked
      scoped.lockOwner = store.lockOwner
      scopedStores.set(scopeKey, scoped)
    }
    return scoped
  }

  function syncScopedLockState() {
    for (const scoped of scopedStores.values()) {
      scoped.writeBlocked = store.writeBlocked
      scoped.lockOwner = store.lockOwner
    }
  }

  const lifecycle = new AbortController()
  const disposers = []
  const lastSummarized = new Map()
  const summarizing = new Set()
  const state = { lastConsolidatedAt: 0, version: 0, journalCursor: 0, rolloutConsumed: {} }
  const stateRef = { state }
  const globalRuntime = { key: 'global', store, state, consolidating: false, ready: null }
  runtimes.set('global', globalRuntime)

  function runtimeForScope(scopeKey) {
    if (scopeKey === 'global') return globalRuntime
    let runtime = runtimes.get(scopeKey)
    if (runtime === undefined) {
      runtime = {
        key: scopeKey,
        store: storeForScope(scopeKey),
        state: { lastConsolidatedAt: 0, version: 0, journalCursor: 0, rolloutConsumed: {} },
        consolidating: false,
        ready: null
      }
      runtimes.set(scopeKey, runtime)
    }
    return runtime
  }

  function ensureRuntime(runtime) {
    if (runtime.key === 'global') return globalRuntimeReady !== null ? globalRuntimeReady : store.chain
    if (runtime.ready !== null) return runtime.ready
    runtime.ready = runtime.store.chain.then(async () => {
      Object.assign(runtime.state, await runtime.store.readState())
      await runtime.store.ensureJournalBackfill()
      await runtime.store.seedSummary('', resolved.scopeMaxBytes)
    })
    return runtime.ready
  }

  async function routeScope(args, exec) {
    const explicit = normalizeScopeArg(args && args.scope)
    if (explicit === 'global') return { key: 'global', store, runtime: globalRuntime }
    if (!resolved.scopedMemory) {
      if (explicit === 'workspace' || explicit === 'project') throw new Error('memory: scopedMemory is disabled')
      return { key: 'global', store, runtime: globalRuntime }
    }
    const session = exec && exec.agent && exec.agent.session
    if (explicit === 'project') {
      const cwd = session && session.header && session.header.cwd
      if (typeof cwd !== 'string' || cwd.trim().length === 0) throw new Error('memory: project scope requires a session cwd')
      const gitRoot = await findGitRoot(cwd)
      if (gitRoot === undefined) throw new Error('memory: no git repository found for project scope')
      const key = projectScopeKey(gitRoot)
      const runtime = runtimeForScope(key)
      return { key, store: runtime.store, runtime }
    }
    const key = scopeFromSession(session)
    if (key === 'global') return { key: 'global', store, runtime: globalRuntime }
    const runtime = runtimeForScope(key)
    return { key, store: runtime.store, runtime }
  }

  function assembleScopeKey(context) {
    const scope = context && context.scope
    const session = scope && (scope.session || (scope.agent && scope.agent.session))
    return scopeFromSession(session)
  }

  const settings = ctx.get('settings')
  if (settings !== undefined) {
    const scope = settings.register(settingsNamespace('memory'), Config, {
      base: config,
      applies: 'live'
    })
    disposers.push(scope.watch((next) => {
      Object.assign(resolved, resolveConfig(next))
      store.rawArchiveMaxBytes = resolved.rawArchiveMaxBytes
      for (const scoped of scopedStores.values()) scoped.rawArchiveMaxBytes = resolved.rawArchiveMaxBytes
    }))
  }

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    disposers.push(systemPrompt.context({
      name: 'dsh-memory',
      order: 2000,
      text: (context) => {
        try {
          const globalText = readFileSync(store.path(SUMMARY_FILE), 'utf8')
          if (!resolved.scopedMemory) return truncateUtf8(globalText, resolved.maxBytes)
          const globalBudget = Math.max(0, resolved.maxBytes - resolved.scopeMaxBytes)
          const globalPart = truncateUtf8(globalText, globalBudget)
          const scopeKey = assembleScopeKey(context)
          if (scopeKey === 'global') return globalPart
          let scopedText = ''
          try {
            scopedText = readFileSync(storeForScope(scopeKey).path(SUMMARY_FILE), 'utf8')
          } catch {
            return globalPart
          }
          if (scopedText.trim().length === 0 || !/^##\s+\S/m.test(scopedText)) return globalPart
          return `${globalPart}\n\n## Workspace memory\n\n${truncateUtf8(scopedText, resolved.scopeMaxBytes)}`
        } catch {
          return ''
        }
      }
    }))
  }

  const tools = ctx.get('tools')
  const runtimeStats = {
    get activeSummaries() { return summarizing.size },
    get consolidating() { return runtimes.size > 0 && [...runtimes.values()].some((runtime) => runtime.consolidating) },
    get llmCalls() { return llmStats.calls },
    get llmMs() { return llmStats.ms },
    get llmFailures() { return llmStats.failures }
  }
  const requestConsolidation = (runtime) => {
    if (lifecycle.signal.aborted) return
    Promise.resolve().then(async () => {
      await ensureRuntime(runtime)
      await maybeConsolidate(runtime)
    }).catch((error) => ctx.logger.warn('dsh-memory: consolidation request failed: %o', error))
  }
  if (tools !== undefined) {
    for (const definition of toolDefinitions(store, resolved, requestConsolidation, runtimeStats, stateRef, routeScope, ensureRuntime)) {
      try {
        disposers.push(tools.register(definition))
      } catch (error) {
        ctx.logger.warn('dsh-memory: failed to register tool %s: %o', definition.name, error)
      }
    }
  }

  const llm = ctx.get('llm')
  const agentDefaultModel = ctx.get('agentDefaultModel')

  async function resolveRoute() {
    if (resolved.summarizeProvider.length > 0 && resolved.summarizeModel.length > 0) {
      return { provider: resolved.summarizeProvider, model: resolved.summarizeModel }
    }
    try {
      const selection = agentDefaultModel !== undefined ? agentDefaultModel.currentSelection() : undefined
      if (selection !== undefined && selection.provider && selection.model) {
        return { provider: selection.provider, model: selection.model }
      }
    } catch {
      // fall through: no route available
    }
    return undefined
  }

  const llmStats = { calls: 0, ms: 0, failures: 0 }

  async function llmText({ kind, provider, model, messages, system, maxTokens, sessionId }) {
    const attempts = Math.max(0, Math.trunc(resolved.llmRetries)) + 1
    let lastError
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS)
      const started = Date.now()
      try {
        const assembler = new BlockAssembler()
        const streamOptions = { provider, model, messages, system, maxTokens, signal: ac.signal }
        if (sessionId !== undefined) streamOptions.sessionId = sessionId
        for await (const chunk of llm.stream(streamOptions)) {
          assembler.push(chunk)
        }
        const terminalError = finishError(assembler.finish)
        if (terminalError !== undefined) throw terminalError
        const blocks = assembler.blocks()
        const output = blocks.filter((block) => block.type === 'text').map((block) => block.text).join(' ').trim()
        const elapsed = Date.now() - started
        llmStats.calls += 1
        llmStats.ms += elapsed
        ctx.logger.info('dsh-memory: llm %s ok (provider=%s, model=%s, ms=%d, attempt=%d, usage=%s)', kind, provider, model, elapsed, attempt + 1, JSON.stringify(assembler.usage ?? {}))
        return { text: output, usage: assembler.usage ?? null, ms: elapsed }
      } catch (error) {
        lastError = error
        const nonRetryable = error && error.message !== undefined && /max tokens|unexpectedly requested a tool|unsupported finish reason/.test(error.message)
        const canRetry = !nonRetryable && attempt + 1 < attempts
        if (canRetry) {
          ctx.logger.warn('dsh-memory: llm %s retrying after failure (provider=%s, model=%s, attempt=%d): %o', kind, provider, model, attempt + 1, error)
          continue
        }
        llmStats.failures += 1
        ctx.logger.warn('dsh-memory: llm %s failed (provider=%s, model=%s, ms=%d, attempt=%d): %o', kind, provider, model, Date.now() - started, attempt + 1, error)
        throw error
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError
  }

  async function runSummarize(agent, text, lastSeq) {
    if (lifecycle.signal.aborted) return
    const route = await resolveRoute()
    if (route === undefined) {
      ctx.logger.warn('dsh-memory: no model route for summarization; skipping (configure summarizeProvider/summarizeModel)')
      return
    }
    try {
      const runtime = runtimeForScope(scopeFromSession(agent.session))
      await ensureRuntime(runtime)
      const messages = [createUserMessage({
        content: [{ type: 'text', text: `Distill the following conversation excerpt into durable memory-worthy facts.\n\n${text}` }],
        source: { kind: 'plugin', plugin: name }
      })]
      const result = await llmText({
        kind: 'summarize',
        provider: route.provider,
        model: route.model,
        messages,
        system: 'You are the memory curator of a coding-agent harness. Extract durable, factual memory: user preferences, project facts, decisions, naming conventions, errors and their fixes. Output concise bullet points in the language of the input. Skip transient chatter, greetings, and restatements of this instruction.',
        maxTokens: resolved.summaryMaxTokens,
        sessionId: agent.session.id
      })
      const summary = result.text
      if (summary.length === 0) return
      await runtime.store.withLock(async () => {
        await runtime.store.appendRolloutSummary(agent.session.id, summary)
      })
      lastSummarized.set(agent.session.id, { at: Date.now(), seq: lastSeq })
      pruneLastSummarized()
      await maybeConsolidate(runtime)
    } catch (error) {
      ctx.logger.warn('dsh-memory: turn summarization failed: %o', error)
    }
  }

  async function maybeConsolidate(runtime) {
    if (runtime.consolidating) return
    runtime.consolidating = true
    try {
      await consolidateNow(runtime)
    } finally {
      runtime.consolidating = false
    }
  }

  async function consolidateNow(runtime) {
    if (llm === undefined || lifecycle.signal.aborted) return
    const target = runtime.store
    const targetState = runtime.state
    const now = Date.now()
    if (targetState.lastConsolidatedAt > 0 && now - targetState.lastConsolidatedAt < CONSOLIDATE_INTERVAL_MS) return

    const snapshot = await target.withLock(async () => {
      const rollouts = await target.latestRolloutBlocks(MAX_ROLLOUT_FILES)
      const { events, maxSeq } = await target.readJournal(targetState.journalCursor)
      const netChanges = journalToNetChanges(events)
      const consumed = { ...targetState.rolloutConsumed }
      const newBlocks = []
      for (const item of rollouts) {
        const blocks = Array.isArray(item.blocks) ? item.blocks : []
        const start = Number.isFinite(consumed[item.file])
          ? Math.min(Math.max(0, Math.trunc(consumed[item.file])), blocks.length)
          : 0
        for (let index = start; index < blocks.length; index += 1) {
          const block = blocks[index]
          newBlocks.push({ file: item.file, header: block.header, text: block.text })
        }
        consumed[item.file] = blocks.length
      }
      for (const file of Object.keys(consumed)) {
        if (!rollouts.some((item) => item.file === file)) delete consumed[file]
      }
      return { newBlocks, consumed, netChanges, maxSeq }
    })

    // A consolidation is due when enough new rollout blocks exist, or when any
    // tool mutation (add/update/delete) is pending even if summaries lag.
    const hasPendingJournal = snapshot.netChanges.length > 0
    if (snapshot.newBlocks.length < resolved.consolidateEvery && !hasPendingJournal) return

    const route = await resolveRoute()
    if (route === undefined) return
    try {
      const current = (await target.readSummary()).trim()
      const nextVersion = summaryVersion(current) + 1
      const newestFirst = snapshot.newBlocks.reverse()
      const rollouts = newestFirst.map((block) => `[${block.file}] ${block.header}\n${block.text}`)
      const journal = snapshot.netChanges.map(journalChangeText)
      const input = buildConsolidationInput({
        current,
        rollouts,
        journal,
        maxBytes: resolved.consolidateMaxBytes
      })
      const messages = [createUserMessage({
        content: [{ type: 'text', text: input }],
        source: { kind: 'plugin', plugin: name }
      })]
      const result = await llmText({
        kind: 'consolidate',
        provider: route.provider,
        model: route.model,
        messages,
        system: 'You are the memory curator of a coding-agent harness. Merge the existing memory summary with the new rollout summaries and raw memory changes into one distilled, deduplicated memory file. Keep the user profile, preferences, and reusable project knowledge; apply raw memory changes exactly (new facts enter, updated facts replace old ones, deleted facts disappear); drop superseded or transient facts. Output markdown only, starting with the exact line `# DSH memory`, a short preamble, then a version line `vN` on its own line, then `## `-sectioned content. Use the language of the existing content.',
        maxTokens: resolved.consolidateMaxTokens
      })
      const rawMerged = result.text
      if (rawMerged.length === 0) return
      const check = validateMergedSummary(rawMerged)
      if (!check.ok) {
        ctx.logger.warn('dsh-memory: rejected malformed consolidation output (%s); keeping previous summary', check.reason)
        return
      }
      const merged = ensureVersionLine(check.text, nextVersion)
      const summaryBudget = runtime.key === 'global' ? resolved.maxBytes : Math.min(resolved.maxBytes, resolved.scopeMaxBytes)
      const bounded = truncateUtf8Markdown(merged, summaryBudget)
      const finalCheck = validateMergedSummary(bounded)
      if (!finalCheck.ok || summaryVersion(bounded) !== nextVersion) {
        ctx.logger.warn('dsh-memory: bounded consolidation output failed validation (%s); keeping previous summary', finalCheck.reason)
        return
      }
      await target.withLock(async () => {
        await target.archiveCurrentSummary(resolved.keepSummaryVersions)
        targetState.lastConsolidatedAt = Date.now()
        targetState.version = nextVersion
        targetState.journalCursor = Math.max(targetState.journalCursor, snapshot.maxSeq)
        targetState.rolloutConsumed = snapshot.consumed
        await target.writeAtomic(SUMMARY_FILE, bounded + '\n')
        await target.writeState(targetState)
      })
    } catch (error) {
      ctx.logger.warn('dsh-memory: consolidation failed: %o', error)
    }
  }

  function scheduleSummarize(agent) {
    if (!resolved.autoSummarize || llm === undefined || lifecycle.signal.aborted) return
    if (!isRootSession(agent.session)) return
    const now = Date.now()
    const prev = lastSummarized.get(agent.session.id)
    if (prev !== undefined && now - prev.at < DEBOUNCE_MS) return
    const { text, lastSeq } = extractTurnText(agent, prev !== undefined ? prev.seq : 0)
    if (byteLength(text) < MIN_TURN_BYTES) return
    // Run summarization independently of store.chain: store.chain is the file
    // operation lock, and chaining the whole LLM job onto it would deadlock
    // when the job later awaits store.withLock on that same chain.
    if (!store.lockOwner) return
    if (summarizing.has(agent.session.id)) return
    if (summarizing.size >= resolved.maxActiveSummaries) {
      ctx.logger.warn('dsh-memory: summarization queue full (%d active); dropping turn for session %s', summarizing.size, agent.session.id)
      return
    }
    summarizing.add(agent.session.id)
    const job = runSummarize(agent, text, lastSeq)
    job.finally(() => summarizing.delete(agent.session.id))
      .catch((error) => ctx.logger.warn('dsh-memory: summarization job failed: %o', error))
  }

  function pruneLastSummarized() {
    const cutoff = Date.now() - 2 * DEBOUNCE_MS
    for (const [id, value] of lastSummarized) {
      if (value.at < cutoff) lastSummarized.delete(id)
    }
    while (lastSummarized.size > 64) {
      const oldest = lastSummarized.keys().next().value
      lastSummarized.delete(oldest)
    }
  }

  if (ctx.on !== undefined) {
    disposers.push(ctx.on('agent/turn-stopping', ({ agent }) => {
      scheduleSummarize(agent)
    }))
  }

  // Seed the summary once, load state, and backfill pre-journal raw entries
  // (background; never blocks startup).
  let releaseLock = null
  store.chain = store.chain.then(async () => {
    if (lifecycle.signal.aborted) return
    const lock = await store.acquireLock()
    if (!lock.owner) {
      ctx.logger.warn('dsh-memory: memory dir locked by another process (%s); running read-only', lock.holder || 'unknown holder')
      return
    }
    releaseLock = lock.release
    syncScopedLockState()
    Object.assign(state, await store.readState())
    const backfill = await store.ensureJournalBackfill()
    if (backfill.backfilled > 0) ctx.logger.info('dsh-memory: backfilled %d pre-journal raw entries', backfill.backfilled)
    if (resolved.seedFromAgentsMd) {
      const agentsMd = join(dshHome(), 'AGENTS.md')
      const seed = await readFile(agentsMd, 'utf8').catch(() => '')
      const seeded = await store.seedSummary(seed, resolved.maxBytes)
      const summary = await store.readSummary()
      // Initialize resync baselines for both fresh seeds and pre-fingerprint stores.
      if (seeded.seeded || state.agentsMdFingerprint === undefined || state.seededSummaryFingerprint === undefined) {
        state.agentsMdFingerprint = hashText(seed)
        state.seededSummaryFingerprint = hashText(summary)
        await store.writeState(state)
      }
    } else {
      await store.seedSummary('', resolved.maxBytes)
    }
  }).catch((error) => {
    ctx.logger.warn('dsh-memory: seed failed: %o', error)
  })
  globalRuntimeReady = store.chain

  ctx.effect(() => () => {
    lifecycle.abort(new Error('dsh-memory disposed'))
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // ignore individual disposal errors
      }
    }
    lastSummarized.clear()
    summarizing.clear()
    if (releaseLock !== null) releaseLock().catch(() => {})
  })

  ctx.logger.info('dsh-memory ready (dir=%s, maxBytes=%d, consolidateMaxBytes=%d, keepSummaryVersions=%d, rawArchiveMaxBytes=%d, summaryMaxTokens=%d, consolidateMaxTokens=%d, llmRetries=%d, maxActiveSummaries=%d, scopedMemory=%s, scopeMaxBytes=%d, autoSummarize=%s)', configuredDir, resolved.maxBytes, resolved.consolidateMaxBytes, resolved.keepSummaryVersions, resolved.rawArchiveMaxBytes, resolved.summaryMaxTokens, resolved.consolidateMaxTokens, resolved.llmRetries, resolved.maxActiveSummaries, String(resolved.scopedMemory), resolved.scopeMaxBytes, String(resolved.autoSummarize))
}

function toolDefinitions(store, resolved, requestConsolidation, runtimeStats, stateRef, routeScope, ensureRuntime) {
  const textOutput = (text) => [{ type: 'text', text }]
  return [
    defineTool({
      name: 'memory_read',
      description: 'Read a memory summary (global or current workspace) bounded to the configured budget. Use it to recall user preferences, project facts, and reusable knowledge before answering.',
      parameters: {
        scope: { type: 'string', description: "Memory scope: 'global', 'workspace' (default), or 'project' (nearest git root of the session cwd)." },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            version: { type: 'number', required: true },
            rawCount: { type: 'number', required: true },
            archivedCount: { type: 'number', required: true },
            truncated: { type: 'boolean', required: true },
            scope: { type: 'string', required: true }
          }
        },
        render: (_args, value) => textOutput(String(value.summary).length > 0 ? `Current memory summary (${value.scope}):\n\n${value.summary}` : `No memory summary yet (${value.scope}).`)
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_read: aborted')
        const route = await routeScope(args, exec)
        await ensureRuntime(route.runtime)
        const target = route.store
        const text = await target.readSummary()
        const budget = route.key === 'global' ? resolved.maxBytes : Math.min(resolved.maxBytes, resolved.scopeMaxBytes)
        const truncated = byteLength(text) > budget
        const archived = await target.archivedRawStats()
        return {
          summary: truncateUtf8(text, budget),
          version: summaryVersion(text),
          rawCount: (await target.readRawEntries()).length,
          archivedCount: archived.count,
          truncated,
          scope: route.key
        }
      }
    }),
    defineTool({
      name: 'memory_add',
      description: 'Store one durable fact in long-term memory (user preferences, project facts, decisions, conventions, errors and fixes). The fact becomes part of the global memory summary injected into future prompts.',
      parameters: {
        content: { type: 'string', required: true, description: 'The fact or preference to remember, one concise statement.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for later search, e.g. ["project", "preference"].' },
        scope: { type: 'string', description: "Memory scope: 'global', 'workspace' (default), or 'project' (nearest git root of the session cwd)." },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            ts: { type: 'string', required: true }
          }
        },
        render: (_args, value) => textOutput(`Saved memory entry ${value.id} at ${value.ts}.`)
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_add: aborted')
        const route = await routeScope(args, exec)
        const content = validateContent(args && args.content !== undefined ? args.content : '')
        const tags = normalizeTags(args && args.tags)
        const result = await route.store.withLock(async () => {
          const entry = await route.store.appendRawEntry({ content, tags })
          await route.store.appendJournal({ op: 'add', id: entry.id, ts: entry.ts, entry })
          return { id: entry.id, ts: entry.ts }
        })
        requestConsolidation(route.runtime)
        return result
      }
    }),
    defineTool({
      name: 'memory_update',
      description: 'Replace the content or tags of one raw memory entry by its id (ids come from memory_add or memory_search).',
      parameters: {
        id: { type: 'string', required: true, description: 'Entry id, e.g. mem-1a2b3c4d.' },
        content: { type: 'string', description: 'New content; omit to keep the current content.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags; omit to keep the current tags.' },
        scope: { type: 'string', description: "Memory scope: 'global', 'workspace' (default), or 'project' (nearest git root of the session cwd)." },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true },
            content: { type: 'string', required: true }
          }
        },
        render: (_args, value) => textOutput(`Updated memory entry ${value.id}.`)
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_update: aborted')
        const route = await routeScope(args, exec)
        const id = String(args && args.id !== undefined ? args.id : '').trim()
        if (id.length === 0) throw new Error('memory_update: id is required')
        const patch = {}
        if (args.content !== undefined) patch.content = validateContent(args.content)
        if (args.tags !== undefined) patch.tags = normalizeTags(args.tags)
        const result = await route.store.withLock(async () => {
          const entry = await route.store.updateRawEntry(id, patch)
          await route.store.appendJournal({ op: 'update', id: entry.id, ts: entry.ts, entry })
          return { id: entry.id, content: entry.content }
        })
        requestConsolidation(route.runtime)
        return result
      }
    }),
    defineTool({
      name: 'memory_delete',
      description: 'Delete one raw memory entry by its id. Use it to remove stale or wrong facts.',
      parameters: {
        id: { type: 'string', required: true, description: 'Entry id to delete, e.g. mem-1a2b3c4d.' },
        scope: { type: 'string', description: "Memory scope: 'global', 'workspace' (default), or 'project' (nearest git root of the session cwd)." },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true }
          }
        },
        render: (_args, value) => textOutput(`Deleted memory entry ${value.id}.`)
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_delete: aborted')
        const route = await routeScope(args, exec)
        const id = String(args && args.id !== undefined ? args.id : '').trim()
        if (id.length === 0) throw new Error('memory_delete: id is required')
        const result = await route.store.withLock(async () => {
          const entry = await route.store.deleteRawEntry(id)
          await route.store.appendJournal({ op: 'delete', id: entry.id, ts: entry.ts, entry })
          return { id }
        })
        requestConsolidation(route.runtime)
        return result
      }
    }),
    defineTool({
      name: 'memory_search',
      description: 'Search raw memory entries with ranked multi-keyword matching and optional tag filtering. Returns matching entries with ids, scores, and snippets so you can update or delete them.',
      parameters: {
        query: { type: 'string', required: true, description: 'Keywords to match against entry content and tags. Space-separated terms.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tag filter: only entries carrying at least one of these tags match.' },
        mode: { type: 'string', description: "Match mode: 'all' requires every query term to match (default), 'any' requires at least one." },
        fuzzy: { type: 'boolean', description: 'Allow zero-dependency typo/CJK fuzzy matching for missing query terms (default true).' },
        limit: { type: 'number', description: 'Maximum number of matches, default 10.' },
        scope: { type: 'string', description: "Memory scope: 'global', 'workspace' (default), or 'project' (nearest git root of the session cwd)." },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            matches: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  ts: { type: 'string', required: true },
                  score: { type: 'number', required: true },
                  snippet: { type: 'string', required: true },
                  tags: { type: 'array', items: { type: 'string' } }
                }
              }
            },
            scope: { type: 'string', required: true }
          }
        },
        render: (_args, value) => {
          const lines = value.matches.length === 0
            ? [`No matching memory entries (${value.scope}).`]
            : value.matches.map((match) => `- [${match.id}] (${match.ts}, score ${match.score}) ${match.snippet}`)
          return textOutput(lines.join('\n'))
        }
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_search: aborted')
        const route = await routeScope(args, exec)
        const query = String(args && args.query !== undefined ? args.query : '').trim()
        if (query.length === 0) throw new Error('memory_search: query must be a non-empty string')
        const limit = Number.isFinite(args && args.limit) ? Math.min(Math.max(1, Math.trunc(args.limit)), 50) : 10
        const mode = String(args && args.mode !== undefined ? args.mode : 'all').toLowerCase()
        if (mode !== 'all' && mode !== 'any') throw new Error("memory_search: mode must be 'all' or 'any'")
        const tags = Array.isArray(args && args.tags)
          ? args.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 16)
          : []
        const fuzzy = args && args.fuzzy !== false
        const hits = await route.store.searchRaw(query, { limit, tags, mode, fuzzy })
        const terms = tokenizeQuery(query)
        return {
          scope: route.key,
          matches: hits.map(({ entry, score }) => ({
            id: entry.id,
            ts: entry.ts,
            score,
            snippet: makeSnippet(entry.content, terms),
            tags: entry.tags
          }))
        }
      }
    }),
    defineTool({
      name: 'memory_export',
      description: 'Export the selected memory scope to a Codex-compatible directory: writes memory_summary.md and raw_memories.md (active + archived raw entries). Existing files are kept unless overwrite is true.',
      parameters: {
        targetDir: { type: 'string', required: true, description: 'Destination directory (created when missing).' },
        scope: { type: 'string', description: "Memory scope: 'global', 'workspace' (default), or 'project' (nearest git root of the session cwd)." },
        overwrite: { type: 'boolean', description: 'Overwrite existing target files (default false).' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            targetDir: { type: 'string', required: true },
            scope: { type: 'string', required: true },
            entries: { type: 'number', required: true },
            summaryBytes: { type: 'number', required: true }
          }
        },
        render: (_args, value) => textOutput(`Exported memory scope ${value.scope} to ${value.targetDir} (${value.entries} raw entries, summary ${value.summaryBytes} bytes).`)
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_export: aborted')
        const route = await routeScope(args, exec)
        await ensureRuntime(route.runtime)
        const rawTarget = String(args && args.targetDir !== undefined ? args.targetDir : '').trim()
        if (rawTarget.length === 0) throw new Error('memory_export: targetDir is required')
        const targetDir = resolve(rawTarget)
        const summaryPath = join(targetDir, SUMMARY_FILE)
        const rawPath = join(targetDir, RAW_FILE)
        const overwrite = args && args.overwrite === true
        if (!overwrite && (existsSync(summaryPath) || existsSync(rawPath))) {
          throw new Error('memory_export: target files already exist; pass overwrite: true')
        }
        await mkdir(targetDir, { recursive: true })
        const summary = await route.store.readSummary()
        const active = await route.store.readRawEntries()
        const archived = await route.store.readArchivedEntries()
        const entries = active.concat(archived)
        await writeFile(summaryPath, summary.length > 0 ? summary : '', 'utf8')
        await writeFile(rawPath, serializeRaw(entries), 'utf8')
        return { targetDir, scope: route.key, entries: entries.length, summaryBytes: byteLength(summary) }
      }
    }),
    defineTool({
      name: 'memory_import',
      description: 'Import Codex-compatible raw_memories.md entries into the selected scope. Entries receive new ids; with merge: false the target raw file is replaced first.',
      parameters: {
        sourceDir: { type: 'string', required: true, description: 'Directory containing raw_memories.md.' },
        scope: { type: 'string', description: "Memory scope: 'global', 'workspace' (default), or 'project' (nearest git root of the session cwd)." },
        merge: { type: 'boolean', description: 'Append to existing entries (default true). false replaces the target raw file.' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            scope: { type: 'string', required: true },
            imported: { type: 'number', required: true }
          }
        },
        render: (_args, value) => textOutput(`Imported ${value.imported} raw memory entries into scope ${value.scope}.`)
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_import: aborted')
        const route = await routeScope(args, exec)
        await ensureRuntime(route.runtime)
        const rawSource = String(args && args.sourceDir !== undefined ? args.sourceDir : '').trim()
        if (rawSource.length === 0) throw new Error('memory_import: sourceDir is required')
        const sourceDir = resolve(rawSource)
        const text = await readFile(join(sourceDir, RAW_FILE), 'utf8').catch((error) => {
          if (error && error.code === 'ENOENT') throw new Error('memory_import: raw_memories.md not found in sourceDir')
          throw error
        })
        const parsed = parseRaw(text)
        if (parsed.length === 0) throw new Error('memory_import: source contains no memory entries')
        const entries = parsed.map((entry) => ({ content: validateContent(entry.content), tags: normalizeTags(entry.tags) }))
        const replace = args && args.merge === false
        let imported = 0
        await route.store.withLock(async () => {
          if (replace) await route.store.writeAtomic(RAW_FILE, serializeRaw([]))
          for (const entry of entries) {
            const saved = await route.store.appendRawEntry(entry)
            await route.store.appendJournal({ op: 'add', id: saved.id, ts: saved.ts, entry: saved })
            imported += 1
          }
        })
        requestConsolidation(route.runtime)
        return { scope: route.key, imported }
      }
    }),
    defineTool({
      name: 'memory_stats',
      description: 'Report memory store health: summary size and version, raw entry count and size, rollout files, journal cursor, last consolidation time, and active background work.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            memoryDir: { type: 'string', required: true },
            summaryBytes: { type: 'number', required: true },
            summaryVersion: { type: 'number', required: true },
            summaryOverBudget: { type: 'boolean', required: true },
            rawCount: { type: 'number', required: true },
            rawBytes: { type: 'number', required: true },
            rolloutFiles: { type: 'number', required: true },
            journalEvents: { type: 'number', required: true },
            journalCursor: { type: 'number', required: true },
            lastConsolidatedAt: { type: 'number', required: true },
            activeSummaries: { type: 'number', required: true },
            consolidating: { type: 'boolean', required: true },
            summaryHistoryFiles: { type: 'number', required: true },
            keepSummaryVersions: { type: 'number', required: true },
            archivedRawCount: { type: 'number', required: true },
            archivedRawBytes: { type: 'number', required: true },
            rawArchiveMaxBytes: { type: 'number', required: true },
            llmCalls: { type: 'number', required: true },
            llmMs: { type: 'number', required: true },
            llmFailures: { type: 'number', required: true },
            maxActiveSummaries: { type: 'number', required: true },
            lockOwner: { type: 'boolean', required: true }
          }
        },
        render: (_args, value) => textOutput([
          `memory dir: ${value.memoryDir}`,
          `summary: ${value.summaryBytes} bytes, v${value.summaryVersion}${value.summaryOverBudget ? ' (over budget)' : ''}`,
          `raw entries: ${value.rawCount} (${value.rawBytes} bytes)`,
          `rollout files: ${value.rolloutFiles}`,
          `journal events: ${value.journalEvents} (cursor ${value.journalCursor})`,
          `last consolidation: ${value.lastConsolidatedAt > 0 ? new Date(value.lastConsolidatedAt).toISOString() : 'never'}`,
          `active summaries: ${value.activeSummaries}, consolidating: ${value.consolidating}`,
          `summary history: ${value.summaryHistoryFiles} files (keep ${value.keepSummaryVersions})`,
          `archived raw entries: ${value.archivedRawCount} (${value.archivedRawBytes} bytes, archive budget ${value.rawArchiveMaxBytes})`,
          `llm calls: ${value.llmCalls} (${value.llmMs} ms, ${value.llmFailures} failures)`,
          `summary queue: ${value.activeSummaries}/${value.maxActiveSummaries}, lock owner: ${value.lockOwner}`
        ].join('\n'))
      },
      async execute(_args, exec) {
        if (exec.signal.aborted) throw new Error('memory_stats: aborted')
        const [summary, raw, persisted, journal, summaryBytes, rawBytes, rolloutFiles, summaryHistory, archivedRaw] = await Promise.all([
          store.readSummary(),
          store.readRawEntries(),
          store.readState(),
          store.readJournal(0),
          store.fileBytes(SUMMARY_FILE),
          store.fileBytes(RAW_FILE),
          store.rolloutFileCount(),
          store.listSummaryHistory(),
          store.archivedRawStats()
        ])
        return {
          memoryDir: store.dir,
          summaryBytes,
          summaryVersion: summaryVersion(summary),
          summaryOverBudget: byteLength(summary) > resolved.maxBytes,
          rawCount: raw.length,
          rawBytes,
          rolloutFiles,
          journalEvents: journal.events.length,
          journalCursor: persisted.journalCursor,
          lastConsolidatedAt: persisted.lastConsolidatedAt,
          activeSummaries: runtimeStats.activeSummaries,
          consolidating: runtimeStats.consolidating,
          summaryHistoryFiles: summaryHistory.length,
          keepSummaryVersions: resolved.keepSummaryVersions,
          archivedRawCount: archivedRaw.count,
          archivedRawBytes: archivedRaw.bytes,
          rawArchiveMaxBytes: resolved.rawArchiveMaxBytes,
          llmCalls: runtimeStats.llmCalls,
          llmMs: runtimeStats.llmMs,
          llmFailures: runtimeStats.llmFailures,
          maxActiveSummaries: resolved.maxActiveSummaries,
          lockOwner: store.lockOwner !== false
        }
      }
    }),
    defineTool({
      name: 'memory_rollback',
      description: 'Restore the global memory summary to a previously retained version. Versions are archived before every consolidation and rollback, so the operation is reversible.',
      parameters: {
        version: { type: 'number', required: true, description: 'Summary version to restore, e.g. 2.' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            restoredVersion: { type: 'number', required: true },
            sourceFile: { type: 'string', required: true },
            bytes: { type: 'number', required: true }
          }
        },
        render: (_args, value) => textOutput(`Restored memory summary v${value.restoredVersion} from ${value.sourceFile} (${value.bytes} bytes).`)
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_rollback: aborted')
        const version = Number.isFinite(args && args.version) ? Math.trunc(args.version) : 0
        if (version < 1) throw new Error('memory_rollback: version must be a positive integer')
        const match = await store.latestSummaryHistory(version)
        if (match === null) throw new Error(`memory_rollback: no retained summary version ${version}`)
        return store.withLock(async () => {
          await store.archiveCurrentSummary(resolved.keepSummaryVersions)
          const bounded = truncateUtf8Markdown(match.text, resolved.maxBytes)
          const restoredVersion = summaryVersion(bounded)
          if (!bounded.startsWith(SUMMARY_HEADER) || restoredVersion < 1) throw new Error('memory_rollback: retained summary is invalid')
          await store.writeAtomic(SUMMARY_FILE, bounded.trimEnd() + '\n')
          stateRef.state.version = restoredVersion
          await store.writeState(stateRef.state)
          return { restoredVersion: stateRef.state.version, sourceFile: match.file, bytes: byteLength(bounded) }
        })
      }
    }),
    defineTool({
      name: 'memory_sync',
      description: 'Re-import AGENTS.md into the memory summary when the source changed. Imports only if the current summary is still the untouched seeded version; if both changed, reports a conflict instead of overwriting edits.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            status: { type: 'string', required: true },
            conflict: { type: 'boolean', required: true },
            version: { type: 'number', required: true },
            summaryVersion: { type: 'number', required: true }
          }
        },
        render: (_args, value) => textOutput(`memory_sync: ${value.status} (conflict=${value.conflict}, summary v${value.summaryVersion})`)
      },
      async execute(_args, exec) {
        if (exec.signal.aborted) throw new Error('memory_sync: aborted')
        if (!resolved.seedFromAgentsMd) throw new Error('memory_sync: seedFromAgentsMd is disabled')
        const agentsMd = join(dshHome(), 'AGENTS.md')
        const seed = await readFile(agentsMd, 'utf8').catch(() => '')
        const sourceFingerprint = hashText(seed)
        const summary = await store.readSummary()
        const summaryFingerprint = hashText(summary)
        const baselineSource = stateRef.state.agentsMdFingerprint
        const baselineSummary = stateRef.state.seededSummaryFingerprint
        const currentVersion = summaryVersion(summary)
        if (baselineSource === undefined || baselineSummary === undefined) {
          return store.withLock(async () => {
            stateRef.state.agentsMdFingerprint = sourceFingerprint
            stateRef.state.seededSummaryFingerprint = summaryFingerprint
            await store.writeState(stateRef.state)
            return { status: 'baseline-initialized', conflict: false, version: currentVersion, summaryVersion: currentVersion }
          })
        }
        if (sourceFingerprint === baselineSource) {
          return { status: 'up-to-date', conflict: false, version: currentVersion, summaryVersion: currentVersion }
        }
        if (summaryFingerprint !== baselineSummary) {
          return { status: 'conflict', conflict: true, version: currentVersion, summaryVersion: currentVersion }
        }
        const nextVersion = currentVersion + 1
        return store.withLock(async () => {
          await store.writeSeedSummary(seed, resolved.maxBytes, nextVersion)
          const newSummary = await store.readSummary()
          stateRef.state.agentsMdFingerprint = sourceFingerprint
          stateRef.state.seededSummaryFingerprint = hashText(newSummary)
          await store.writeState(stateRef.state)
          return { status: 'imported', conflict: false, version: nextVersion, summaryVersion: nextVersion }
        })
      }
    })
  ]
}
