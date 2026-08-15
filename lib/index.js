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
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  SUMMARY_FILE,
  SUMMARY_HEADER,
  DEFAULT_MAX_BYTES,
  DEFAULT_CONSOLIDATE_EVERY,
  DEFAULT_CONSOLIDATE_MAX_BYTES,
  byteLength,
  truncateUtf8,
  nowStamp,
  summaryVersion,
  ensureVersionLine,
  finishError,
  validateContent,
  normalizeTags,
  journalToNetChanges,
  buildConsolidationInput,
  MemoryStore
} from './store.js'

export const name = 'dsh-memory'

const MIN_TURN_BYTES = 200
const MAX_TURN_INPUT_BYTES = 40000
const DEBOUNCE_MS = 5 * 60 * 1000
const CONSOLIDATE_INTERVAL_MS = 10 * 60 * 1000
const LLM_TIMEOUT_MS = 60 * 1000
const MAX_ROLLOUT_FILES = 16

export const Config = z.object({
  memoryDir: z.string().default(''),
  maxBytes: z.number().step(1).min(256).max(1048576).default(DEFAULT_MAX_BYTES),
  consolidateMaxBytes: z.number().step(1).min(1024).max(1048576).default(DEFAULT_CONSOLIDATE_MAX_BYTES),
  autoSummarize: z.boolean().default(true),
  summarizeProvider: z.string().default(''),
  summarizeModel: z.string().default(''),
  consolidateEvery: z.number().step(1).min(1).max(64).default(DEFAULT_CONSOLIDATE_EVERY),
  seedFromAgentsMd: z.boolean().default(true)
})

function resolveConfig(config = {}) {
  const merged = { ...config }
  return {
    memoryDir: typeof merged.memoryDir === 'string' ? merged.memoryDir : '',
    maxBytes: Number.isFinite(merged.maxBytes) && merged.maxBytes > 0 ? merged.maxBytes : DEFAULT_MAX_BYTES,
    consolidateMaxBytes: Number.isFinite(merged.consolidateMaxBytes) && merged.consolidateMaxBytes > 0 ? merged.consolidateMaxBytes : DEFAULT_CONSOLIDATE_MAX_BYTES,
    autoSummarize: merged.autoSummarize !== false,
    summarizeProvider: typeof merged.summarizeProvider === 'string' ? merged.summarizeProvider : '',
    summarizeModel: typeof merged.summarizeModel === 'string' ? merged.summarizeModel : '',
    consolidateEvery: Number.isFinite(merged.consolidateEvery) && merged.consolidateEvery > 0 ? merged.consolidateEvery : DEFAULT_CONSOLIDATE_EVERY,
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
  const lifecycle = new AbortController()
  const disposers = []
  const lastSummarized = new Map()
  const summarizing = new Set()
  const state = { lastConsolidatedAt: 0, version: 0, journalCursor: 0, rolloutConsumed: {} }
  let consolidating = false

  const settings = ctx.get('settings')
  if (settings !== undefined) {
    const scope = settings.register(settingsNamespace('memory'), Config, {
      base: config,
      applies: 'live'
    })
    disposers.push(scope.watch((next) => Object.assign(resolved, resolveConfig(next))))
  }

  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt !== undefined) {
    disposers.push(systemPrompt.context({
      name: 'dsh-memory',
      order: 2000,
      text: () => {
        try {
          const text = readFileSync(store.path(SUMMARY_FILE), 'utf8')
          if (text.trim().length === 0) return ''
          return truncateUtf8(text, resolved.maxBytes)
        } catch {
          return ''
        }
      }
    }))
  }

  const tools = ctx.get('tools')
  const requestConsolidation = () => {
    if (lifecycle.signal.aborted) return
    Promise.resolve().then(() => maybeConsolidate())
      .catch((error) => ctx.logger.warn('dsh-memory: consolidation request failed: %o', error))
  }
  if (tools !== undefined) {
    for (const definition of toolDefinitions(store, resolved, requestConsolidation)) {
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

  async function runSummarize(agent, text, lastSeq) {
    if (lifecycle.signal.aborted) return
    const route = await resolveRoute()
    if (route === undefined) {
      ctx.logger.warn('dsh-memory: no model route for summarization; skipping (configure summarizeProvider/summarizeModel)')
      return
    }
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS)
    try {
      const messages = [createUserMessage({
        content: [{ type: 'text', text: `Distill the following conversation excerpt into durable memory-worthy facts.\n\n${text}` }],
        source: { kind: 'plugin', plugin: name }
      })]
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        messages,
        system: 'You are the memory curator of a coding-agent harness. Extract durable, factual memory: user preferences, project facts, decisions, naming conventions, errors and their fixes. Output concise bullet points in the language of the input. Skip transient chatter, greetings, and restatements of this instruction.',
        maxTokens: 600,
        sessionId: agent.session.id,
        signal: ac.signal
      })) {
        assembler.push(chunk)
      }
      const terminalError = finishError(assembler.finish)
      if (terminalError !== undefined) throw terminalError
      const blocks = assembler.blocks()
      const summary = blocks.filter((block) => block.type === 'text').map((block) => block.text).join(' ').trim()
      if (summary.length === 0) return
      await store.withLock(async () => {
        await store.appendRolloutSummary(agent.session.id, summary)
      })
      lastSummarized.set(agent.session.id, { at: Date.now(), seq: lastSeq })
      await maybeConsolidate()
    } catch (error) {
      if (!ac.signal.aborted) ctx.logger.warn('dsh-memory: turn summarization failed: %o', error)
    } finally {
      clearTimeout(timer)
    }
  }

  async function maybeConsolidate() {
    if (consolidating) return
    consolidating = true
    try {
      await consolidateNow()
    } finally {
      consolidating = false
    }
  }

  async function consolidateNow() {
    if (llm === undefined || lifecycle.signal.aborted) return
    const now = Date.now()
    if (state.lastConsolidatedAt > 0 && now - state.lastConsolidatedAt < CONSOLIDATE_INTERVAL_MS) return

    const snapshot = await store.withLock(async () => {
      const rollouts = await store.latestRolloutBlocks(MAX_ROLLOUT_FILES)
      const { events, maxSeq } = await store.readJournal(state.journalCursor)
      const netChanges = journalToNetChanges(events)
      const consumed = { ...state.rolloutConsumed }
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
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS)
    try {
      const current = (await store.readSummary()).trim()
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
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        messages,
        system: 'You are the memory curator of a coding-agent harness. Merge the existing memory summary with the new rollout summaries and raw memory changes into one distilled, deduplicated memory file. Keep the user profile, preferences, and reusable project knowledge; apply raw memory changes exactly (new facts enter, updated facts replace old ones, deleted facts disappear); drop superseded or transient facts. Output markdown only, starting with the exact line `# DSH memory`, a short preamble, then a version line `vN` on its own line, then `## `-sectioned content. Use the language of the existing content.',
        maxTokens: 1500,
        signal: ac.signal
      })) {
        assembler.push(chunk)
      }
      const terminalError = finishError(assembler.finish)
      if (terminalError !== undefined) throw terminalError
      const blocks = assembler.blocks()
      let merged = blocks.filter((block) => block.type === 'text').map((block) => block.text).join(' ').trim()
      if (merged.length === 0) return
      merged = ensureVersionLine(merged, nextVersion)
      const bounded = truncateUtf8(merged, resolved.maxBytes)
      await store.withLock(async () => {
        state.lastConsolidatedAt = Date.now()
        state.version = nextVersion
        state.journalCursor = Math.max(state.journalCursor, snapshot.maxSeq)
        state.rolloutConsumed = snapshot.consumed
        await store.writeAtomic(SUMMARY_FILE, bounded + '\n')
        await store.writeState(state)
      })
    } catch (error) {
      if (!ac.signal.aborted) ctx.logger.warn('dsh-memory: consolidation failed: %o', error)
    } finally {
      clearTimeout(timer)
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
    if (summarizing.has(agent.session.id)) return
    summarizing.add(agent.session.id)
    const job = runSummarize(agent, text, lastSeq)
    job.finally(() => summarizing.delete(agent.session.id))
      .catch((error) => ctx.logger.warn('dsh-memory: summarization job failed: %o', error))
  }

  if (ctx.on !== undefined) {
    disposers.push(ctx.on('agent/turn-stopping', ({ agent }) => {
      scheduleSummarize(agent)
    }))
  }

  // Seed the summary once, load state, and backfill pre-journal raw entries
  // (background; never blocks startup).
  store.chain = store.chain.then(async () => {
    if (lifecycle.signal.aborted) return
    Object.assign(state, await store.readState())
    const backfill = await store.ensureJournalBackfill()
    if (backfill.backfilled > 0) ctx.logger.info('dsh-memory: backfilled %d pre-journal raw entries', backfill.backfilled)
    if (resolved.seedFromAgentsMd) {
      const agentsMd = join(dshHome(), 'AGENTS.md')
      const seed = await readFile(agentsMd, 'utf8').catch(() => '')
      await store.seedSummary(seed, resolved.maxBytes)
    } else {
      await store.seedSummary('', resolved.maxBytes)
    }
  }).catch((error) => {
    ctx.logger.warn('dsh-memory: seed failed: %o', error)
  })

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
  })

  ctx.logger.info('dsh-memory ready (dir=%s, maxBytes=%d, consolidateMaxBytes=%d, autoSummarize=%s)', configuredDir, resolved.maxBytes, resolved.consolidateMaxBytes, String(resolved.autoSummarize))
}

function toolDefinitions(store, resolved, requestConsolidation) {
  const textOutput = (text) => [{ type: 'text', text }]
  return [
    defineTool({
      name: 'memory_read',
      description: 'Read the current global memory summary (bounded to the configured budget). Use it to recall user preferences, project facts, and reusable knowledge before answering.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            version: { type: 'number', required: true },
            rawCount: { type: 'number', required: true },
            truncated: { type: 'boolean', required: true }
          }
        },
        render: (_args, value) => textOutput(String(value.summary).length > 0 ? `Current memory summary:\n\n${value.summary}` : 'No memory summary yet.')
      },
      async execute(_args, exec) {
        if (exec.signal.aborted) throw new Error('memory_read: aborted')
        const text = await store.readSummary()
        const truncated = byteLength(text) > resolved.maxBytes
        return {
          summary: truncateUtf8(text, resolved.maxBytes),
          version: summaryVersion(text),
          rawCount: (await store.readRawEntries()).length,
          truncated
        }
      }
    }),
    defineTool({
      name: 'memory_add',
      description: 'Store one durable fact in long-term memory (user preferences, project facts, decisions, conventions, errors and fixes). The fact becomes part of the global memory summary injected into future prompts.',
      parameters: {
        content: { type: 'string', required: true, description: 'The fact or preference to remember, one concise statement.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags for later search, e.g. ["project", "preference"].' }
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
        const content = validateContent(args && args.content !== undefined ? args.content : '')
        const tags = normalizeTags(args && args.tags)
        const result = await store.withLock(async () => {
          const entry = await store.appendRawEntry({ content, tags })
          await store.appendJournal({ op: 'add', id: entry.id, ts: entry.ts, entry })
          return { id: entry.id, ts: entry.ts }
        })
        requestConsolidation()
        return result
      }
    }),
    defineTool({
      name: 'memory_update',
      description: 'Replace the content or tags of one raw memory entry by its id (ids come from memory_add or memory_search).',
      parameters: {
        id: { type: 'string', required: true, description: 'Entry id, e.g. mem-1a2b3c4d.' },
        content: { type: 'string', description: 'New content; omit to keep the current content.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags; omit to keep the current tags.' }
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
        const id = String(args && args.id !== undefined ? args.id : '').trim()
        if (id.length === 0) throw new Error('memory_update: id is required')
        const patch = {}
        if (args.content !== undefined) patch.content = validateContent(args.content)
        if (args.tags !== undefined) patch.tags = normalizeTags(args.tags)
        const result = await store.withLock(async () => {
          const entry = await store.updateRawEntry(id, patch)
          await store.appendJournal({ op: 'update', id: entry.id, ts: entry.ts, entry })
          return { id: entry.id, content: entry.content }
        })
        requestConsolidation()
        return result
      }
    }),
    defineTool({
      name: 'memory_delete',
      description: 'Delete one raw memory entry by its id. Use it to remove stale or wrong facts.',
      parameters: {
        id: { type: 'string', required: true, description: 'Entry id to delete, e.g. mem-1a2b3c4d.' }
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
        const id = String(args && args.id !== undefined ? args.id : '').trim()
        if (id.length === 0) throw new Error('memory_delete: id is required')
        const result = await store.withLock(async () => {
          const entry = await store.deleteRawEntry(id)
          await store.appendJournal({ op: 'delete', id: entry.id, ts: entry.ts, entry })
          return { id }
        })
        requestConsolidation()
        return result
      }
    }),
    defineTool({
      name: 'memory_search',
      description: 'Search raw memory entries by keyword. Returns matching entries with their ids so you can update or delete them.',
      parameters: {
        query: { type: 'string', required: true, description: 'Keyword to match against entry content and tags.' },
        limit: { type: 'number', description: 'Maximum number of matches, default 10.' }
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
                  snippet: { type: 'string', required: true },
                  tags: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        },
        render: (_args, value) => {
          const lines = value.matches.length === 0
            ? ['No matching memory entries.']
            : value.matches.map((match) => `- [${match.id}] (${match.ts}) ${match.snippet}`)
          return textOutput(lines.join('\n'))
        }
      },
      async execute(args, exec) {
        if (exec.signal.aborted) throw new Error('memory_search: aborted')
        const query = String(args && args.query !== undefined ? args.query : '').trim()
        if (query.length === 0) throw new Error('memory_search: query must be a non-empty string')
        const limit = Number.isFinite(args && args.limit) ? Math.min(Math.max(1, Math.trunc(args.limit)), 50) : 10
        const hits = await store.searchRaw(query, limit)
        return {
          matches: hits.map((entry) => ({
            id: entry.id,
            ts: entry.ts,
            snippet: entry.content.slice(0, 200),
            tags: entry.tags
          }))
        }
      }
    })
  ]
}
