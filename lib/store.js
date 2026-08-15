// dsh-memory storage primitives.
//
// This module intentionally has no DSH runtime imports so its parsing, budget,
// journal, search, and file-layout logic can be unit-tested with plain Node.js.
import { appendFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

export const SUMMARY_FILE = 'memory_summary.md'
export const RAW_FILE = 'raw_memories.md'
export const STATE_FILE = 'state.json'
export const JOURNAL_FILE = 'journal.jsonl'
export const ROLLOUT_DIR = 'rollout_summaries'
export const SUMMARY_HISTORY_DIR = 'summary_history'
export const RAW_ARCHIVE_DIR = 'archive'
export const DEFAULT_RAW_ARCHIVE_MAX_BYTES = 200000
export const DEFAULT_RAW_KEEP_ENTRIES = 200
export const SUMMARY_HEADER = '# DSH memory'
export const DEFAULT_MAX_BYTES = 8000
export const DEFAULT_CONSOLIDATE_EVERY = 3
export const DEFAULT_CONSOLIDATE_MAX_BYTES = 40000
export const DEFAULT_KEEP_SUMMARY_VERSIONS = 20
export const DEFAULT_MAX_CONTENT_BYTES = 2000
export const DEFAULT_MAX_TAGS = 16
export const DEFAULT_MAX_TAG_CHARS = 48
export const RAW_ID_PREFIX = 'mem-'

export function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

export function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = Math.max(0, Math.trunc(maxBytes))
  while (end > 0 && (bytes.readUInt8(end) & 192) === 128) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

export function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ')
}

export function sanitizeFilePart(value) {
  return String(value).replace(/[^\w.-]/g, '_').slice(0, 120)
}

export function parseRaw(text) {
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

export function serializeRaw(entries) {
  const parts = ['# Raw memories', '', `Entries: ${entries.length}`, '']
  for (const entry of entries) {
    parts.push(`### ${entry.ts}`, `**id:** ${entry.id}`)
    if (entry.tags.length > 0) parts.push(`**tags:** ${entry.tags.join(', ')}`)
    parts.push('', entry.content, '')
  }
  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function stripStandaloneVersionLines(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .filter((line) => !/^v\d+\s*$/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Version is only meaningful after the summary header, not inside seeded body text. */
export function summaryVersion(text) {
  const str = String(text ?? '')
  const headerIndex = str.indexOf(SUMMARY_HEADER)
  if (headerIndex < 0) return 0
  const tail = str.slice(headerIndex)
  const match = tail.match(/^v(\d+)\s*$/m)
  return match ? Number(match[1]) : 0
}

/**
 * Strip every standalone `vN` line and insert exactly one version line before
 * the first `## ` section (after the header/preamble).
 */
export function ensureVersionLine(text, version) {
  let out = stripStandaloneVersionLines(text)
  if (out.length === 0) return `${SUMMARY_HEADER}\n\nv${version}\n`
  if (!out.startsWith(SUMMARY_HEADER)) out = `${SUMMARY_HEADER}\n\n${out}`
  const firstSection = out.indexOf('\n## ')
  if (firstSection >= 0) {
    return `${out.slice(0, firstSection)}\n\nv${version}\n\n${out.slice(firstSection + 1)}`
  }
  return `${out.trimEnd()}\n\nv${version}\n`
}

/** Parse a rollout file into `## <timestamp>` blocks. Older file-level headers are ignored. */
export function parseRolloutBlocks(text) {
  const blocks = []
  let current = null
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^## (\d{4}-\d{2}-\d{2}T\S*)\s*$/)
    if (match) {
      if (current !== null) blocks.push(current)
      current = { header: match[1], lines: [] }
    } else if (current !== null) {
      current.lines.push(line)
    }
  }
  if (current !== null) blocks.push(current)
  return blocks.map((block) => ({ header: block.header, text: block.lines.join('\n').trim() }))
}

/** Translate a BlockAssembler terminal finish reason into an error, if any. */
export function finishError(finish) {
  switch (finish && finish.kind) {
    case 'stop': return undefined
    case 'error':
    case 'aborted': {
      const failure = finish.failure
      const error = new Error(failure && failure.message ? failure.message : `LLM call ended with ${finish.kind}`)
      if (failure && failure.code) error.code = failure.code
      return error
    }
    case 'max-tokens': return new Error('dsh-memory: LLM output reached max tokens')
    case 'tool-calls': return new Error('dsh-memory: LLM unexpectedly requested a tool')
    default: return new Error(`dsh-memory: unsupported finish reason ${String(finish && finish.kind)}`)
  }
}

export function hashText(value) {
  return createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16)
}

/**
 * Truncate on complete lines while keeping code fences balanced. If the budget
 * ends inside an unclosed fenced code block, that block is dropped whole rather
 * than emitting a half-open fence.
 */
export function truncateUtf8Markdown(value, maxBytes) {
  const text = String(value ?? '')
  if (byteLength(text) <= maxBytes) return text
  const budget = Math.max(0, Math.trunc(maxBytes) - 1)
  const lines = text.split('\n')
  const kept = []
  const fenceStack = []
  let used = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const needed = byteLength(line) + (kept.length > 0 ? 1 : 0)
    if (used + needed > budget) break
    kept.push(line)
    used += needed
    if (line.trimStart().startsWith('```')) {
      if (fenceStack.length > 0) fenceStack.pop()
      else fenceStack.push(index)
    }
  }
  if (fenceStack.length > 0) {
    const lastOpen = fenceStack[fenceStack.length - 1]
    if (lastOpen < kept.length) kept.length = lastOpen
  }
  if (kept.length === 0) return truncateUtf8(text, maxBytes)
  return kept.join('\n') + '\n'
}

/**
 * Strict validation for consolidation output. The raw model text must already
 * carry the header, one standalone version line, and at least one `##` section;
 * missing pieces are rejected so a malformed merge can never overwrite a good
 * summary (version normalization happens afterwards).
 */
export function validateMergedSummary(text) {
  const cleaned = String(text ?? '').trim()
  if (!cleaned.startsWith(SUMMARY_HEADER)) return { ok: false, reason: 'missing # DSH memory header' }
  if (!/^v\d+\s*$/m.test(cleaned)) return { ok: false, reason: 'missing vN version line' }
  if (!/^##\s+\S/m.test(cleaned)) return { ok: false, reason: 'missing ## sections' }
  return { ok: true, text: cleaned }
}

export function normalizeTags(tags, { maxTags = DEFAULT_MAX_TAGS, maxTagChars = DEFAULT_MAX_TAG_CHARS } = {}) {
  const normalized = Array.isArray(tags)
    ? tags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, maxTags)
    : []
  for (const tag of normalized) {
    if (tag.length > maxTagChars) throw new Error(`tag exceeds ${maxTagChars} characters: ${tag}`)
  }
  return normalized
}

export function validateContent(content, { maxContentBytes = DEFAULT_MAX_CONTENT_BYTES } = {}) {
  const clean = String(content ?? '').trim()
  if (clean.length === 0) throw new Error('content must be a non-empty string')
  if (byteLength(clean) > maxContentBytes) throw new Error(`content exceeds ${maxContentBytes} bytes (UTF-8)`)
  return clean
}

export function validateEntryInput(content, tags, options = {}) {
  return {
    content: validateContent(content, options),
    tags: normalizeTags(tags, options)
  }
}

/**
 * Collapse journal events into one net change per entry id. Events are expected
 * to arrive in ascending `seq` order; the last event for an id wins.
 */
export function journalToNetChanges(events) {
  const latest = new Map()
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    if (typeof event.id !== 'string' || event.id.length === 0) continue
    if (!Number.isFinite(event.seq)) continue
    latest.set(event.id, event)
  }
  return [...latest.values()].sort((a, b) => a.seq - b.seq)
}

/**
 * Build the bounded consolidation input. Fixed slice budget keeps the total
 * under `maxBytes`: existing summary 40%, new rollouts 45%, journal net
 * changes 15% (newest rollout blocks are expected first).
 */
export function buildConsolidationInput({ current, rollouts, journal, maxBytes }) {
  const budget = Math.max(1024, Math.trunc(maxBytes) || DEFAULT_CONSOLIDATE_MAX_BYTES)
  const currentCap = Math.floor(budget * 0.4)
  const rolloutCap = Math.floor(budget * 0.45)
  const journalCap = Math.max(0, budget - currentCap - rolloutCap)

  const currentText = String(current ?? '').trim()
  const parts = [
    `## Existing summary\n\n${truncateUtf8(currentText.length > 0 ? currentText : '(none)', currentCap)}`
  ]

  const rolloutList = Array.isArray(rollouts) ? rollouts : []
  const rolloutText = rolloutList.length > 0
    ? rolloutList.map((item, index) => `### Rollout ${index + 1}\n\n${String(item).trim()}`).join('\n\n')
    : '(none)'
  parts.push(`## New rollout summaries\n\n${truncateUtf8(rolloutText, rolloutCap)}`)

  const journalList = Array.isArray(journal) ? journal : []
  const journalText = journalList.length > 0
    ? journalList.map((item) => String(item).trim()).join('\n')
    : '(none)'
  parts.push(`## New raw memory changes\n\n${truncateUtf8(journalText, journalCap)}`)

  return truncateUtf8(parts.join('\n\n'), budget)
}

/** Split a query into lowercase search terms (whitespace/punctuation-separated). */
export function tokenizeQuery(query) {
  return String(query ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean)
}

export function makeSnippet(content, terms, maxLength = 200) {
  const text = String(content ?? '')
  const lower = text.toLowerCase()
  let position = -1
  for (const raw of terms) {
    const term = String(raw ?? '').toLowerCase()
    if (term.length === 0) continue
    const index = lower.indexOf(term)
    if (index >= 0 && (position < 0 || index < position)) position = index
  }
  const start = position >= 0 ? Math.max(0, position - 40) : 0
  const end = Math.min(text.length, start + maxLength)
  const body = text.slice(start, end).trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Score one entry against the query terms. Deterministic parts:
 * - occurrence length in content,
 * - whole-word matches in content,
 * - exact/partial tag matches,
 * - mild recency boost that decays over 30 days.
 */
export function scoreEntry(entry, terms, now = Date.now()) {
  const content = String(entry && entry.content !== undefined ? entry.content : '')
  const lower = content.toLowerCase()
  const tags = (Array.isArray(entry && entry.tags) ? entry.tags : []).map((tag) => String(tag).toLowerCase())
  let score = 0
  let totalHits = 0
  const hitTerms = new Set()

  for (const raw of terms) {
    const term = String(raw ?? '').toLowerCase()
    if (term.length === 0) continue
    const occurrences = lower.split(term).length - 1
    const wordPattern = new RegExp(`(^|[^\\p{L}\\p{N}_])${escapeRegExp(term)}([^\\p{L}\\p{N}_]|$)`, 'gu')
    const wordMatches = (lower.match(wordPattern) || []).length
    const exactTagHits = tags.filter((tag) => tag === term).length
    const partialTagHits = tags.filter((tag) => tag !== term && tag.includes(term)).length

    if (occurrences > 0 || wordMatches > 0 || exactTagHits > 0 || partialTagHits > 0) hitTerms.add(term)
    score += occurrences * 2 + wordMatches * 10 + exactTagHits * 15 + partialTagHits * 5
    totalHits += occurrences + wordMatches + exactTagHits + partialTagHits
  }

  const parsed = Date.parse(`${String(entry && entry.ts !== undefined ? entry.ts : '').replace(' ', 'T')}Z`)
  if (Number.isFinite(parsed) && Number.isFinite(now)) {
    const ageHours = Math.max(0, (now - parsed) / 3600000)
    score += Math.max(0, 1 - ageHours / (24 * 30)) * 2
  }

  return { score, totalHits, hitTerms }
}

/**
 * Rank raw entries for a query. `mode: 'all'` requires every query term to
 * match; `mode: 'any'` requires at least one. `tags` filters entries that carry
 * at least one listed tag. Results are sorted by score, then newest first.
 */
export function searchEntries(entries, query, { tags = [], mode = 'all', limit = 10, now = Date.now() } = {}) {
  const terms = tokenizeQuery(query)
  if (terms.length === 0) return []
  const normalizedTags = Array.isArray(tags)
    ? tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim().toLowerCase()).filter(Boolean)
    : []
  const effectiveMode = mode === 'any' ? 'any' : 'all'
  const maxResults = Math.min(Math.max(1, Math.trunc(limit) || 10), 50)

  const scored = []
  for (const entry of entries) {
    const entryTags = (Array.isArray(entry.tags) ? entry.tags : []).map((tag) => String(tag).toLowerCase())
    if (normalizedTags.length > 0 && !normalizedTags.some((tag) => entryTags.includes(tag))) continue
    const result = scoreEntry(entry, terms, now)
    const matched = effectiveMode === 'any'
      ? result.hitTerms.size > 0
      : terms.every((term) => result.hitTerms.has(term))
    if (!matched) continue
    scored.push({ entry, score: result.score, matchedTerms: result.hitTerms.size })
  }

  scored.sort((a, b) => b.score - a.score || String(b.entry.ts).localeCompare(String(a.entry.ts)))
  return scored.slice(0, maxResults)
}

export class MemoryStore {
  constructor(dir) {
    this.dir = dir
    this.chain = Promise.resolve()
    this.journalSeq = 0
    this.rawCache = null
    this.rawArchiveMaxBytes = DEFAULT_RAW_ARCHIVE_MAX_BYTES
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
    await mkdir(this.path(SUMMARY_HISTORY_DIR), { recursive: true })
    await mkdir(this.path(RAW_ARCHIVE_DIR), { recursive: true })
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
    const info = await stat(this.path(RAW_FILE)).catch(() => null)
    if (info === null) return []
    const key = `${info.mtimeMs}:${info.size}`
    if (this.rawCache !== null && this.rawCache.key === key) return this.rawCache.entries
    const entries = parseRaw(await this.readText(RAW_FILE))
    this.rawCache = { key, entries }
    return entries
  }

  async appendRawEntry({ content, tags }) {
    await this.ensure()
    const entries = await this.readRawEntries()
    const entry = { ts: nowStamp(), id: RAW_ID_PREFIX + randomUUID().slice(0, 8), tags, content }
    entries.push(entry)
    await this.writeAtomic(RAW_FILE, serializeRaw(entries))
    this.rawCache = null
    await this.archiveRawIfNeeded(this.rawArchiveMaxBytes)
    return entry
  }

  /**
   * Keep the active raw file under `maxBytes` by moving the oldest entries to
   * `archive/raw-YYYY-MM.md`. Newest entries are retained first, capped at
   * DEFAULT_RAW_KEEP_ENTRIES. Archived files stay in the same Markdown format.
   */
  async archiveRawIfNeeded(maxBytes = this.rawArchiveMaxBytes) {
    const limit = Math.max(1024, Math.trunc(maxBytes) || DEFAULT_RAW_ARCHIVE_MAX_BYTES)
    const entries = await this.readRawEntries()
    if (entries.length === 0) return { archived: 0, retained: 0 }
    const retained = []
    let retainedBytes = 0
    const maxKeep = Math.min(entries.length, DEFAULT_RAW_KEEP_ENTRIES)
    for (let index = entries.length - 1; index >= 0 && retained.length < maxKeep; index -= 1) {
      const entry = entries[index]
      const estimate = byteLength(serializeRaw([entry]))
      if (retainedBytes + estimate > limit) break
      retained.unshift(entry)
      retainedBytes += estimate
    }
    if (retained.length === entries.length) return { archived: 0, retained: retained.length }
    const archived = entries.slice(0, entries.length - retained.length)
    const month = String(archived[0].ts).slice(0, 7)
    const archiveFile = join(RAW_ARCHIVE_DIR, `raw-${month}.md`)
    const existing = parseRaw(await this.readText(archiveFile))
    await this.writeAtomic(archiveFile, serializeRaw([...existing, ...archived]))
    await this.writeAtomic(RAW_FILE, serializeRaw(retained))
    this.rawCache = null
    return { archived: archived.length, retained: retained.length }
  }

  async readArchivedEntries() {
    await this.ensure()
    let files = []
    try {
      files = await readdir(this.path(RAW_ARCHIVE_DIR))
    } catch {
      return []
    }
    const entries = []
    for (const file of files.filter((name) => name.startsWith('raw-') && name.endsWith('.md')).sort()) {
      entries.push(...parseRaw(await this.readText(join(RAW_ARCHIVE_DIR, file))))
    }
    return entries
  }

  async archivedRawStats() {
    const entries = await this.readArchivedEntries()
    let bytes = 0
    try {
      const files = await readdir(this.path(RAW_ARCHIVE_DIR))
      for (const file of files.filter((name) => name.startsWith('raw-') && name.endsWith('.md'))) {
        const info = await stat(this.path(join(RAW_ARCHIVE_DIR, file))).catch(() => null)
        if (info !== null) bytes += info.size
      }
    } catch {
      // archive directory may not exist yet
    }
    return { count: entries.length, bytes }
  }

  async updateRawEntry(id, { content, tags }) {
    await this.ensure()
    const entries = await this.readRawEntries()
    const target = entries.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`memory: no entry with id ${id}`)
    if (content !== undefined) target.content = String(content).trim()
    if (tags !== undefined) target.tags = tags
    await this.writeAtomic(RAW_FILE, serializeRaw(entries))
    this.rawCache = null
    return target
  }

  async deleteRawEntry(id) {
    await this.ensure()
    const entries = await this.readRawEntries()
    const target = entries.find((entry) => entry.id === id)
    if (target === undefined) throw new Error(`memory: no entry with id ${id}`)
    const next = entries.filter((entry) => entry.id !== id)
    await this.writeAtomic(RAW_FILE, serializeRaw(next))
    this.rawCache = null
    return target
  }

  async searchRaw(query, options = {}) {
    const entries = await this.readRawEntries()
    const combined = options.includeArchive === false ? entries : entries.concat(await this.readArchivedEntries())
    const limit = Number.isFinite(options.limit) ? Math.min(Math.max(1, Math.trunc(options.limit)), 50) : 10
    return searchEntries(combined, query, { ...options, limit })
  }

  async fileBytes(file) {
    const info = await stat(this.path(file)).catch(() => null)
    return info !== null ? info.size : 0
  }

  async rolloutFileCount() {
    await this.ensure()
    try {
      const files = await readdir(this.path(ROLLOUT_DIR))
      return files.filter((file) => file.endsWith('.md')).length
    } catch {
      return 0
    }
  }

  async readState() {
    const text = await this.readText(STATE_FILE)
    if (text.trim().length === 0) {
      return { lastConsolidatedAt: 0, version: 0, journalCursor: 0, rolloutConsumed: {} }
    }
    try {
      const parsed = JSON.parse(text)
      return {
        lastConsolidatedAt: Number.isFinite(parsed.lastConsolidatedAt) ? parsed.lastConsolidatedAt : 0,
        version: Number.isFinite(parsed.version) ? parsed.version : 0,
        journalCursor: Number.isFinite(parsed.journalCursor) ? parsed.journalCursor : 0,
        rolloutConsumed: parsed.rolloutConsumed !== null && typeof parsed.rolloutConsumed === 'object'
          ? parsed.rolloutConsumed
          : {}
      }
    } catch {
      return { lastConsolidatedAt: 0, version: 0, journalCursor: 0, rolloutConsumed: {} }
    }
  }

  async writeState(state) {
    await this.writeAtomic(STATE_FILE, JSON.stringify(state, null, 2) + '\n')
  }

  async seedSummary(seedText, maxBytes = DEFAULT_MAX_BYTES) {
    await this.ensure()
    const info = await stat(this.path(SUMMARY_FILE)).catch(() => null)
    if (info !== null) return { seeded: false }
    const written = await this.writeSeedSummary(seedText, maxBytes, 1)
    return { seeded: true, bytes: written.bytes }
  }

  /**
   * Write (or overwrite) the summary from seed text with the given version.
   * Used by initial seeding and by the AGENTS.md resync tool.
   */
  async writeSeedSummary(seedText, maxBytes = DEFAULT_MAX_BYTES, version = 1) {
    await this.ensure()
    const baseHeader = `${SUMMARY_HEADER}\n\nMaintained by the dsh-memory plugin. Use as guidance; more specific instructions take precedence. It does not override system, developer, or direct user instructions.\n\nv${version}\n\n`
    const header = truncateUtf8(baseHeader, Math.max(0, Math.trunc(maxBytes)))
    const available = Math.max(0, Math.trunc(maxBytes) - byteLength(header))
    const body = truncateUtf8(stripStandaloneVersionLines(seedText), available).trim()
    const fileText = truncateUtf8(header + (body.length > 0 ? body + '\n' : ''), Math.max(0, Math.trunc(maxBytes)))
    await this.writeAtomic(SUMMARY_FILE, fileText)
    return { bytes: byteLength(fileText) }
  }

  async readSummary() {
    return this.readText(SUMMARY_FILE)
  }

  async archiveCurrentSummary(keep = DEFAULT_KEEP_SUMMARY_VERSIONS) {
    await this.ensure()
    const text = await this.readSummary()
    const version = summaryVersion(text)
    if (version < 1 || text.trim().length === 0) return null
    const file = `${version}.${Date.now()}.${randomUUID().slice(0, 8)}.md`
    await this.writeAtomic(join(SUMMARY_HISTORY_DIR, file), text)
    await this.pruneSummaryHistory(keep)
    return file
  }

  async pruneSummaryHistory(keep = DEFAULT_KEEP_SUMMARY_VERSIONS) {
    await this.ensure()
    let files = []
    try {
      files = await readdir(this.path(SUMMARY_HISTORY_DIR))
    } catch {
      return
    }
    const withMtime = []
    for (const file of files.filter((name) => name.endsWith('.md'))) {
      const info = await stat(this.path(join(SUMMARY_HISTORY_DIR, file))).catch(() => null)
      if (info !== null) withMtime.push({ file, mtime: info.mtimeMs })
    }
    withMtime.sort((a, b) => b.mtime - a.mtime)
    const stale = withMtime.slice(Math.max(0, Math.trunc(keep)))
    for (const item of stale) {
      await unlink(this.path(join(SUMMARY_HISTORY_DIR, item.file))).catch(() => {})
    }
  }

  async listSummaryHistory() {
    await this.ensure()
    let files = []
    try {
      files = await readdir(this.path(SUMMARY_HISTORY_DIR))
    } catch {
      return []
    }
    const history = []
    for (const file of files.filter((name) => name.endsWith('.md'))) {
      const info = await stat(this.path(join(SUMMARY_HISTORY_DIR, file))).catch(() => null)
      if (info === null) continue
      const versionMatch = file.match(/^(\d+)\./)
      history.push({
        file,
        version: versionMatch ? Number(versionMatch[1]) : 0,
        mtime: info.mtimeMs,
        bytes: info.size
      })
    }
    history.sort((a, b) => b.mtime - a.mtime)
    return history
  }

  async latestSummaryHistory(version) {
    const history = await this.listSummaryHistory()
    const match = history.find((item) => item.version === version)
    if (match === undefined) return null
    return { ...match, text: await this.readText(join(SUMMARY_HISTORY_DIR, match.file)) }
  }

  async appendRolloutSummary(sessionId, text) {
    await this.ensure()
    const file = sanitizeFilePart(sessionId) + '.md'
    const header = `# Rollout summary ${sanitizeFilePart(sessionId)}\n\n`
    const existing = await this.readText(join(ROLLOUT_DIR, file))
    const block = `## ${new Date().toISOString()}\n\n${String(text).trim()}\n\n`
    await this.writeAtomic(join(ROLLOUT_DIR, file), (existing.length > 0 ? existing : header) + block)
  }

  async latestRolloutBlocks(limit) {
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
      const text = await this.readText(join(ROLLOUT_DIR, item.file))
      selected.push({ file: item.file, blocks: parseRolloutBlocks(text) })
    }
    return selected
  }

  async appendJournal(event) {
    await this.ensure()
    const { maxSeq } = await this.readJournal(0)
    const seq = Math.max(this.journalSeq, maxSeq) + 1
    this.journalSeq = seq
    await appendFile(this.path(JOURNAL_FILE), `${JSON.stringify({ ...event, seq })}\n`, 'utf8')
    return seq
  }

  async readJournal(afterSeq = 0) {
    const text = await this.readText(JOURNAL_FILE)
    const events = []
    let maxSeq = Number.isFinite(afterSeq) ? afterSeq : 0
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim()
      if (line.length === 0) continue
      try {
        const event = JSON.parse(line)
        if (Number.isFinite(event.seq)) {
          if (event.seq > maxSeq) maxSeq = event.seq
          if (event.seq > afterSeq) events.push(event)
        }
      } catch {
        // skip partially written/corrupt lines; cursor stays behind and the
        // corresponding entry remains in the journal's tail
      }
    }
    return { events, maxSeq }
  }

  /**
   * One-time migration: raw entries written by v0.1.0 predate the journal.
   * Backfill them as synthetic `add` events so the next consolidation sees them.
   */
  async ensureJournalBackfill() {
    const { events } = await this.readJournal(0)
    if (events.length > 0) return { backfilled: 0 }
    const raw = await this.readRawEntries()
    let backfilled = 0
    for (const entry of raw) {
      await this.appendJournal({ op: 'add', id: entry.id, ts: entry.ts, entry })
      backfilled += 1
    }
    return { backfilled }
  }
}
