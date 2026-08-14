// dsh-memory: Codex-like persistent memory for DeepSeek Harness.
//
// Storage layout under $DSH_HOME/memories/ (default ~/.dsh/memories/):
//   memory_summary.md          distilled, versioned, bounded memory injected into every prompt
//   raw_memories.md            append-only dated entries written by the memory tools
//   rollout_summaries/<sid>.md per-session turn summaries produced by auto-summarization
//   state.json                 consolidation bookkeeping (lastConsolidatedAt, summaryVersion)
//
// Injection: a systemPrompt.context provider re-reads memory_summary.md at every
// prompt assembly, so tool writes surface in the very next model step.
//
// Auto-summarization: on agent/turn-stopping (root agents only), the turn's new
// text is distilled with the default model into a rollout summary; every
// `consolidateEvery` summaries, the global summary is re-distilled (atomic write,
// version bump). All LLM work runs on a private serial queue with a timeout and
// never blocks a turn.
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dsh-memory'

const SUMMARY_FILE = 'memory_summary.md'
const RAW_FILE = 'raw_memories.md'
const STATE_FILE = 'state.json'
const ROLLOUT_DIR = 'rollout_summaries'
const SUMMARY_HEADER = '# DSH memory'
const DEFAULT_MAX_BYTES = 8000
const DEFAULT_CONSOLIDATE_EVERY = 3
const MIN_TURN_BYTES = 200
const MAX_TURN_INPUT_BYTES = 40000
const DEBOUNCE_MS = 5 * 60 * 1000
const CONSOLIDATE_INTERVAL_MS = 10 * 60 * 1000
const LLM_TIMEOUT_MS = 60 * 1000
const MAX_ROLLOUT_FILES = 16
const MAX_RAW_SCAN_ENTRIES = 60
const SUMMARY_VERSION_RE = /^v(\d+)$/m
const RAW_ID_PREFIX = 'mem-'

export const Config = z.object({
  memoryDir: z.string().default(''),
  maxBytes: z.number().step(1).min(256).max(1048576).default(DEFAULT_MAX_BYTES),
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

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = Math.max(0, Math.trunc(maxBytes))
  while (end > 0 && (bytes.readUInt8(end) & 192) === 128) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

function sanitizeFilePart(value) {
  return String(value).replace(/[^\w.-]/g, '_').slice(0, 120)
}

function parseRaw(text) {
  const entries = []
  let current = null
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith('### ')) {
      current = { ts: line.slice(4).trim(), id: '', tags: [], content: [] }
      entries.push(current)
    } else if (current !== null) {
      const idMatch = line.match(/^\*\*id:\*\* (.+)$/)
      const tagsMatch = line.match(/^\*\*tags:\*\* (.+)$/)
      if (idMatch) current.id = idMatch[1].trim()
      else if (tagsMatch) current.tags = tagsMatch[1].split(',').map((tag) => tag.trim()).filter(Boolean)
      else if (line.trim().length > 0) current.content.push(line)
    }
  }
  return entries.map((entry) => ({ ...entry, content: entry.content.join('\n').trim() }))
}

function serializeRaw(entries) {
  const parts = ['# Raw memories', '', `Entries: ${entries.length}`, '']
  for (const entry of entries) {
    parts.push(`### ${entry.ts}`, `**id:** ${entry.id}`)
    if (entry.tags.length > 0) parts.push(`**tags:** ${entry.tags.join(', ')}`)
    parts.push('', entry.content, '')
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

function summaryVersion(text) {
  const match = String(text).match(SUMMARY_VERSION_RE)
  return match ? Number(match[1]) : 0
}

function isRootSession(session) {
  const header = session?.header
  return header !== undefined && header.parentSession === undefined && header.origin !== 'subagent'
}

class MemoryStore {
  constructor(dir) {
    this.dir = dir
    this.chain = Promise.resolve()
  }

  withLock(operation) {
    const run = this.chain.then(() => operation(), () => operation())
    this.chain = run.then(() => undefined, () => undefined)
    return run
  }

  path(file) {
    return join(this.dir, file)
  }

  async ensure() {
    await mkdir(this.dir, { recursive: true })
    await mkdir(this.path(ROLLOUT_DIR), { recursive: true })
  }

  async readText(file) {
    try {
      return await readFile(this.path(file), 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return ''
      throw error
    }
  }

  async writeAtomic(file, content) {
    const tmp = this.path(`${file}.tmp-${randomUUID().slice(0, 8)}`)
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, this.path(file))
  }

  async readRawEntries() {
    return parseRaw(await this.readText(RAW_FILE))
  }

  async appendRawEntry({ content, tags }) {
    await this.ensure()
    const entries = await this.readRawEntries()
    const entry = { ts: nowStamp(), id: RAW_ID_PREFIX + randomUUID().slice(0, 8), tags, content }
    entries.push(entry)
    await this.writeAtomic(RAW_FILE, serializeRaw(entries))
    return entry
  }

  async updateRawEntry(id, { content, tags }) {
    await this.ensure()
    const entries = await this.readRawEntries()
    const target = entries.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`memory: no entry with id ${id}`)
    if (content !== undefined) target.content = String(content).trim()
    if (tags !== undefined) target.tags = tags
    await this.writeAtomic(RAW_FILE, serializeRaw(entries))
    return target
  }

  async deleteRawEntry(id) {
    await this.ensure()
    const entries = await this.readRawEntries()
    const next = entries.filter((entry) => entry.id !== id)
    if (next.length === entries.length) throw new Error(`memory: no entry with id ${id}`)
    await this.writeAtomic(RAW_FILE, serializeRaw(next))
    return id
  }

  async searchRaw(query, limit) {
    const needle = String(query).toLowerCase()
    const hits = []
    for (const entry of await this.readRawEntries()) {
      const haystack = `${entry.content}\n${entry.tags.join(' ')}`.toLowerCase()
      if (haystack.includes(needle)) hits.push(entry)
      if (hits.length >= limit) break
    }
    return hits
  }

  async readState() {
    const text = await this.readText(STATE_FILE)
    if (text.trim().length === 0) return { lastConsolidatedAt: 0, version: 0 }
    try {
      const parsed = JSON.parse(text)
      return {
        lastConsolidatedAt: Number.isFinite(parsed.lastConsolidatedAt) ? parsed.lastConsolidatedAt : 0,
        version: Number.isFinite(parsed.version) ? parsed.version : 0
      }
    } catch {
      return { lastConsolidatedAt: 0, version: 0 }
    }
  }

  async writeState(state) {
    await this.writeAtomic(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
  }

  async seedSummary(seedText) {
    await this.ensure()
    const info = await stat(this.path(SUMMARY_FILE)).catch(() => null)
    if (info !== null) return { seeded: false }
    const header = `${SUMMARY_HEADER}\n\nMaintained by the dsh-memory plugin. Use as guidance; more specific instructions take precedence. It does not override system, developer, or direct user instructions.\n\nv1\n\n`
    const body = String(seedText ?? '').trim()
    await this.writeAtomic(SUMMARY_FILE, header + (body.length > 0 ? body + '\n' : ''))
    return { seeded: true }
  }

  async readSummary() {
    return this.readText(SUMMARY_FILE)
  }

  async appendRolloutSummary(sessionId, text) {
    await this.ensure()
    const file = sanitizeFilePart(sessionId) + '.md'
    const header = `# Rollout summary ${sanitizeFilePart(sessionId)}\n\n`
    const existing = await this.readText(join(ROLLOUT_DIR, file))
    const block = `## ${new Date().toISOString()}\n\n${String(text).trim()}\n\n`
    await this.writeAtomic(join(ROLLOUT_DIR, file), (existing.length > 0 ? existing : header) + block)
  }

  async latestRolloutSummaries(limit) {
    await this.ensure()
    let files = []
    try {
      files = await readdir(this.path(ROLLOUT_DIR))
    } catch {
      return []
    }
    const markdown = files.filter((file) => file.endsWith('.md'))
    const withMtime = []
    for (const file of markdown) {
      const info = await stat(this.path(join(ROLLOUT_DIR, file))).catch(() => null)
      if (info !== null) withMtime.push({ file, mtime: info.mtimeMs })
    }
    withMtime.sort((a, b) => b.mtime - a.mtime)
    const selected = []
    for (const item of withMtime.slice(0, limit)) {
      selected.push(await this.readText(join(ROLLOUT_DIR, item.file)))
    }
    return selected
  }
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

export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config)
  const configuredDir = resolved.memoryDir.trim().length > 0 ? resolved.memoryDir.trim() : join(dshHome(), 'memories')
  const store = new MemoryStore(configuredDir)
  const lifecycle = new AbortController()
  const disposers = []
  const lastSummarized = new Map()
  const state = { lastConsolidatedAt: 0, version: 0 }

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
  if (tools !== undefined) {
    for (const definition of toolDefinitions(store, resolved)) {
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
      if (assembler.finish) throw assembler.finish
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
    if (llm === undefined || lifecycle.signal.aborted) return
    const summaries = await store.latestRolloutSummaries(MAX_ROLLOUT_FILES)
    if (summaries.length < resolved.consolidateEvery) return
    const now = Date.now()
    if (state.lastConsolidatedAt > 0 && now - state.lastConsolidatedAt < CONSOLIDATE_INTERVAL_MS) return
    const route = await resolveRoute()
    if (route === undefined) return
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS)
    try {
      const current = (await store.readSummary()).trim()
      const rawEntries = (await store.readRawEntries())
        .filter((entry) => entry.ts > new Date(state.lastConsolidatedAt).toISOString().slice(0, 16).replace('T', ' '))
        .slice(-MAX_RAW_SCAN_ENTRIES)
      const input = [
        current.length > 0 ? `## Existing summary\n\n${current}` : '## Existing summary\n\n(none)',
        `## New rollout summaries\n\n${summaries.join('\n\n')}`,
        rawEntries.length > 0 ? `## New raw memories\n\n${rawEntries.map((entry) => `- [${entry.ts}] ${entry.id}: ${entry.content}`).join('\n')}` : '## New raw memories\n\n(none)'
      ].join('\n\n')
      const nextVersion = summaryVersion(current) + 1
      const messages = [createUserMessage({
        content: [{ type: 'text', text: input }],
        source: { kind: 'plugin', plugin: name }
      })]
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream({
        provider: route.provider,
        model: route.model,
        messages,
        system: 'You are the memory curator of a coding-agent harness. Merge the existing memory summary with the new rollout summaries and raw memories into one distilled, deduplicated memory file. Keep the user profile, preferences, and reusable project knowledge; drop superseded or transient facts. Output markdown only, starting with the exact line `# DSH memory`, a short preamble, then a version line `vN` on its own line, then `## `-sectioned content. Use the language of the existing content.',
        maxTokens: 1500,
        signal: ac.signal
      })) {
        assembler.push(chunk)
      }
      if (assembler.finish) throw assembler.finish
      const blocks = assembler.blocks()
      let merged = blocks.filter((block) => block.type === 'text').map((block) => block.text).join(' ').trim()
      if (merged.length === 0) return
      if (!merged.startsWith(SUMMARY_HEADER)) merged = `${SUMMARY_HEADER}\n\n${merged}`
      if (!SUMMARY_VERSION_RE.test(merged)) merged = merged.replace(SUMMARY_HEADER, `${SUMMARY_HEADER}\n\nv${nextVersion}`)
      await store.withLock(async () => {
        state.lastConsolidatedAt = Date.now()
        state.version = nextVersion
        await store.writeAtomic(SUMMARY_FILE, truncateUtf8(merged, resolved.maxBytes) + '\n')
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
    store.chain = store.chain
      .then(() => runSummarize(agent, text, lastSeq))
      .catch((error) => ctx.logger.warn('dsh-memory: summarization job failed: %o', error))
  }

  if (ctx.on !== undefined) {
    disposers.push(ctx.on('agent/turn-stopping', ({ agent }) => {
      scheduleSummarize(agent)
    }))
  }

  // Seed the summary once (background; never blocks startup).
  store.chain = store.chain.then(async () => {
    if (lifecycle.signal.aborted) return
    Object.assign(state, await store.readState())
    if (resolved.seedFromAgentsMd) {
      const agentsMd = join(dshHome(), 'AGENTS.md')
      const seed = await readFile(agentsMd, 'utf8').catch(() => '')
      await store.seedSummary(seed)
    } else {
      await store.seedSummary('')
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
  })

  ctx.logger.info('dsh-memory ready (dir=%s, maxBytes=%d, autoSummarize=%s)', configuredDir, resolved.maxBytes, String(resolved.autoSummarize))
}

function toolDefinitions(store, resolved) {
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
        const summary = truncateUtf8(text, resolved.maxBytes)
        return {
          summary,
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
        const content = String(args && args.content !== undefined ? args.content : '').trim()
        if (content.length === 0) throw new Error('memory_add: content must be a non-empty string')
        const tags = Array.isArray(args && args.tags)
          ? args.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 16)
          : []
        return store.withLock(async () => {
          const entry = await store.appendRawEntry({ content, tags })
          return { id: entry.id, ts: entry.ts }
        })
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
        if (args.content !== undefined) patch.content = args.content
        if (args.tags !== undefined) patch.tags = Array.isArray(args.tags) ? args.tags.map((tag) => String(tag).trim()).filter(Boolean) : []
        return store.withLock(async () => {
          const entry = await store.updateRawEntry(id, patch)
          return { id: entry.id, content: entry.content }
        })
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
        return store.withLock(async () => {
          await store.deleteRawEntry(id)
          return { id }
        })
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
