#!/usr/bin/env node
// Standalone MCP stdio server for dsh-memory.
//
// It reuses lib/store.js only (no DeepSeek Harness runtime), so it can be
// attached to any MCP client (Codex/Claude/etc.) that can spawn:
//   node E:/git/github/dsh-Plugin/bin/dsh-memory-mcp.mjs
//
// Environment:
//   DSH_MEMORY_DIR          memory root (default ~/.dsh/memories)
//   DSH_MEMORY_REDACT       reject/redact credential-looking content (default 1)
//
// Tools carry an optional `scope` argument. `global` (default) uses the root
// store; `workspace`/`project` use `cwd` to derive ws-/project- keys.
import { createInterface } from 'node:readline'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  MemoryStore,
  RAW_FILE,
  SUMMARY_FILE,
  DEFAULT_MAX_CONTENT_BYTES,
  detectSecrets,
  findGitRoot,
  findNearDuplicateGroups,
  normalizeScopeArg,
  normalizeTags,
  projectScopeKey,
  scopeKeyForCwd,
  scopedStoreDir,
  searchEntries,
  serializeRaw,
  summaryVersion,
  validateContent
} from '../lib/store.js'

const rootDir = process.env.DSH_MEMORY_DIR && process.env.DSH_MEMORY_DIR.trim().length > 0
  ? process.env.DSH_MEMORY_DIR.trim()
  : join(homedir(), '.dsh', 'memories')
const redact = process.env.DSH_MEMORY_REDACT !== '0'
const root = new MemoryStore(rootDir)
const stores = new Map()

function storeForScope(key) {
  if (key === 'global') return root
  let store = stores.get(key)
  if (store === undefined) {
    store = new MemoryStore(scopedStoreDir(rootDir, key))
    stores.set(key, store)
  }
  return store
}

async function route(args = {}) {
  const scope = normalizeScopeArg(args.scope)
  if (scope === 'workspace') {
    const cwd = String(args.cwd ?? '').trim()
    if (cwd.length === 0) throw new Error("memory: 'workspace' scope requires cwd")
    const key = scopeKeyForCwd(cwd)
    return { key, store: storeForScope(key) }
  }
  if (scope === 'project') {
    const cwd = String(args.cwd ?? '').trim()
    if (cwd.length === 0) throw new Error("memory: 'project' scope requires cwd")
    const gitRoot = await findGitRoot(cwd)
    if (gitRoot === undefined) throw new Error('memory: no git repository found for project scope')
    const key = projectScopeKey(gitRoot)
    return { key, store: storeForScope(key) }
  }
  return { key: 'global', store: root }
}

const tools = [
  {
    name: 'memory_read',
    description: 'Read the memory summary for a scope.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', description: "global, workspace, or project (default global)" },
        cwd: { type: 'string', description: 'Working directory for workspace/project scope' }
      }
    }
  },
  {
    name: 'memory_add',
    description: 'Store one durable fact. Duplicates and obvious credentials are rejected by default.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number', description: '0-3, default 1' },
        allowDuplicate: { type: 'boolean' },
        allowSecret: { type: 'boolean' },
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_search',
    description: 'BM25-ranked multi-keyword search with optional tag filtering and fuzzy fallback.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', description: "all or any" },
        fuzzy: { type: 'boolean' },
        vector: { type: 'boolean' },
        limit: { type: 'number' },
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_update',
    description: 'Update an entry by id.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        content: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        importance: { type: 'number' },
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_delete',
    description: 'Delete an entry by id.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_merge',
    description: 'Merge two or more entries; longest content, tag union and max importance win.',
    inputSchema: {
      type: 'object',
      required: ['ids'],
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        keepId: { type: 'string' },
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_review',
    description: 'List oldest entries and near-duplicate groups for review.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        olderThanDays: { type: 'number' },
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_history',
    description: 'List retained summary versions for a scope.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  },
  {
    name: 'memory_stats',
    description: 'Report memory store health for a scope.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string' },
        cwd: { type: 'string' }
      }
    }
  }
]

async function callTool(name, args = {}) {
  const target = await route(args)
  const store = target.store
  switch (name) {
    case 'memory_read': {
      const summary = await store.readSummary()
      const raw = await store.readRawEntries()
      const archived = await store.archivedRawStats()
      return { scope: target.key, summary, version: summaryVersion(summary), rawCount: raw.length, archivedCount: archived.count }
    }
    case 'memory_add': {
      const content = validateContent(args.content)
      if (redact && args.allowSecret !== true) {
        const secrets = detectSecrets(content)
        if (secrets.length > 0) throw new Error(`content looks like a credential (${secrets.map((item) => item.type).join(', ')}); pass allowSecret: true to store it`)
      }
      const tags = normalizeTags(args.tags)
      const importance = Number.isFinite(args.importance) ? Math.min(3, Math.max(0, Math.trunc(args.importance))) : 1
      return store.withLock(async () => {
        if (args.allowDuplicate !== true) {
          const existing = await store.findDuplicate(content)
          if (existing !== undefined) return { id: existing.id, ts: existing.ts, duplicate: true }
        }
        const entry = await store.appendRawEntry({ content, tags, importance })
        await store.appendJournal({ op: 'add', id: entry.id, ts: entry.ts, entry })
        return { id: entry.id, ts: entry.ts, duplicate: false, scope: target.key }
      })
    }
    case 'memory_search': {
      const query = String(args.query ?? '').trim()
      if (query.length === 0) throw new Error('query must be a non-empty string')
      const limit = Number.isFinite(args.limit) ? Math.min(Math.max(1, Math.trunc(args.limit)), 50) : 10
      const mode = String(args.mode || 'all').toLowerCase()
      if (mode !== 'all' && mode !== 'any') throw new Error("mode must be 'all' or 'any'")
      const tags = Array.isArray(args.tags) ? args.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean).slice(0, 16) : []
      const entries = (await store.readRawEntries()).concat(await store.readArchivedEntries())
      const hits = searchEntries(entries, query, { tags, mode, limit, fuzzy: args.fuzzy !== false, vector: args.vector === true })
      return { scope: target.key, matches: hits.map(({ entry, score }) => ({ id: entry.id, ts: entry.ts, score, content: entry.content, tags: entry.tags })) }
    }
    case 'memory_update': {
      const id = String(args.id ?? '').trim()
      if (id.length === 0) throw new Error('id is required')
      const patch = {}
      if (args.content !== undefined) patch.content = validateContent(args.content)
      if (args.tags !== undefined) patch.tags = normalizeTags(args.tags)
      if (args.importance !== undefined) patch.importance = Math.min(3, Math.max(0, Math.trunc(args.importance)))
      return store.withLock(async () => {
        const entry = await store.updateRawEntry(id, patch)
        await store.appendJournal({ op: 'update', id: entry.id, ts: entry.ts, entry })
        return entry
      })
    }
    case 'memory_delete': {
      const id = String(args.id ?? '').trim()
      if (id.length === 0) throw new Error('id is required')
      return store.withLock(async () => {
        const entry = await store.deleteRawEntry(id)
        await store.appendJournal({ op: 'delete', id: entry.id, ts: entry.ts, entry })
        return { id }
      })
    }
    case 'memory_merge': {
      const ids = Array.isArray(args.ids) ? args.ids.map((id) => String(id).trim()).filter(Boolean) : []
      if (ids.length < 2) throw new Error('at least two entry ids are required')
      const keepId = String(args.keepId !== undefined ? args.keepId : ids[0]).trim()
      return store.withLock(async () => {
        const { kept, removed } = await store.mergeRawEntries(ids, keepId)
        await store.appendJournal({ op: 'update', id: kept.id, ts: kept.ts, entry: kept })
        for (const entry of removed) await store.appendJournal({ op: 'delete', id: entry.id, ts: entry.ts, entry })
        return { id: kept.id, mergedIds: [kept.id, ...removed.map((entry) => entry.id)], content: kept.content }
      })
    }
    case 'memory_review': {
      const entries = (await store.readRawEntries()).concat(await store.readArchivedEntries())
      const limit = Number.isFinite(args.limit) ? Math.min(Math.max(1, Math.trunc(args.limit)), 100) : 20
      const olderThanDays = Number.isFinite(args.olderThanDays) ? Math.max(0, args.olderThanDays) : 0
      const cutoff = olderThanDays > 0 ? Date.now() - olderThanDays * 24 * 60 * 60 * 1000 : undefined
      const candidates = entries
        .filter((entry) => {
          if (cutoff === undefined) return true
          const parsed = Date.parse(`${String(entry.ts).replace(' ', 'T')}Z`)
          return Number.isFinite(parsed) && parsed < cutoff
        })
        .sort((a, b) => String(a.ts).localeCompare(String(b.ts)))
        .slice(0, limit)
      return { scope: target.key, candidates, nearDuplicates: findNearDuplicateGroups(entries) }
    }
    case 'memory_history': {
      const history = await store.listSummaryHistory()
      return { scope: target.key, versions: history.map(({ version, file, mtime, bytes }) => ({ version, file, mtime, bytes })) }
    }
    case 'memory_stats': {
      const summary = await store.readSummary()
      const raw = await store.readRawEntries()
      const archived = await store.archivedRawStats()
      const state = await store.readState()
      const journal = await store.readJournal(0)
      return {
        scope: target.key,
        dir: store.dir,
        summaryVersion: summaryVersion(summary),
        summaryBytes: await store.fileBytes(SUMMARY_FILE),
        rawCount: raw.length,
        rawBytes: await store.fileBytes(RAW_FILE),
        archivedRawCount: archived.count,
        archivedRawBytes: archived.bytes,
        journalEvents: journal.events.length,
        journalCursor: state.journalCursor,
        historyFiles: (await store.listSummaryHistory()).length
      }
    }
    default:
      throw new Error(`unknown tool ${name}`)
  }
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  const raw = line.trim()
  if (raw.length === 0) return
  let message
  try {
    message = JSON.parse(raw)
  } catch {
    return
  }
  const { id, method, params } = message
  const respond = (result, error) => {
    if (id !== undefined) send({ jsonrpc: '2.0', id, result, error })
  }
  Promise.resolve().then(async () => {
    switch (method) {
      case 'initialize':
        return respond({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dsh-memory', version: '0.2.0' } })
      case 'ping':
        return respond({})
      case 'tools/list':
        return respond({ tools })
      case 'tools/call': {
        try {
          const result = await callTool(params && params.name, (params && params.arguments) || {})
          respond({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] })
        } catch (error) {
          respond({ content: [{ type: 'text', text: String(error && error.message !== undefined ? error.message : error) }], isError: true })
        }
        return undefined
      }
      default:
        return undefined
    }
  }).catch((error) => {
    respond(undefined, { code: -32000, message: String(error && error.message !== undefined ? error.message : error) })
  })
})
