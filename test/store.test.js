import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MemoryStore,
  buildConsolidationInput,
  finishError,
  hashText,
  byteLength,
  ensureVersionLine,
  journalToNetChanges,
  normalizeTags,
  parseRaw,
  parseRolloutBlocks,
  searchEntries,
  makeSnippet,
  scoreEntry,
  serializeRaw,
  stripStandaloneVersionLines,
  summaryVersion,
  tokenizeQuery,
  truncateUtf8,
  truncateUtf8Markdown,
  validateMergedSummary,
  validateContent,
  validateEntryInput
} from '../lib/store.js'

async function tempStore(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return new MemoryStore(dir)
}

test('truncateUtf8 preserves UTF-8 character boundaries', () => {
  const text = '你好世界'
  assert.equal(byteLength(text), 12)
  assert.equal(truncateUtf8(text, 12), text)
  assert.equal(byteLength(truncateUtf8(text, 9)), 9)
  assert.equal(truncateUtf8('abc', 0), '')
  assert.doesNotThrow(() => truncateUtf8(text, 10))
})

test('parseRaw and serializeRaw roundtrip', () => {
  const entries = [
    { ts: '2026-08-15 08:00', id: 'mem-12345678', tags: ['project', 'preference'], content: '第一行\n第二行' },
    { ts: '2026-08-15 09:00', id: 'mem-abcdef12', tags: [], content: 'no tags' }
  ]
  const serialized = serializeRaw(entries)
  assert.equal(serialized.startsWith('# Raw memories'), true)
  assert.deepEqual(parseRaw(serialized), entries)
})

test('summaryVersion only trusts a version line after the header', () => {
  const text = '# DSH memory\n\nMaintained by the dsh-memory plugin.\n\nv3\n\n# Seeded body\n\nv9\n'
  assert.equal(summaryVersion(text), 3)
  assert.equal(summaryVersion('no header here\nv5\n'), 0)
})

test('stripStandaloneVersionLines removes only standalone vN lines', () => {
  const input = 'v1\n\n# Body\n\nv2\n\nv1.5 stays\nversion v3 stays\n'
  const out = stripStandaloneVersionLines(input)
  assert.equal(out.includes('\nv1\n'), false)
  assert.equal(out.includes('\nv2\n'), false)
  assert.equal(out.includes('v1.5 stays'), true)
  assert.equal(out.includes('version v3 stays'), true)
})

test('ensureVersionLine produces exactly one standalone version line before sections', () => {
  const merged = '# DSH memory\n\nA preamble.\n\n## User Profile\n\nPrefs\n\n## Knowledge\n\nFacts\n'
  const out = ensureVersionLine(merged, 4)
  const versionLines = out.split(/\r?\n/).filter((line) => /^v\d+\s*$/.test(line))
  assert.deepEqual(versionLines, ['v4'])
  assert.equal(out.indexOf('\n## User Profile') > out.indexOf('\nv4\n'), true)
  assert.equal(summaryVersion(out), 4)
})

test('finishError maps terminal reasons correctly', () => {
  assert.equal(finishError({ kind: 'stop' }), undefined)
  assert.equal(finishError({ kind: 'max-tokens' }).message, 'dsh-memory: LLM output reached max tokens')
  const failure = finishError({ kind: 'error', failure: { message: 'boom', code: 'E_BOOM' } })
  assert.equal(failure.message, 'boom')
  assert.equal(failure.code, 'E_BOOM')
})

test('seedSummary stays within maxBytes and has a single version line', async (t) => {
  const store = await tempStore(t)
  const seed = '# Seeded body\n\n' + 'x'.repeat(2000) + '\n\nv7\n'
  const { seeded } = await store.seedSummary(seed, 512)
  assert.equal(seeded, true)
  const text = await store.readSummary()
  assert.equal(byteLength(text) <= 512, true)
  const versionLines = text.split(/\r?\n/).filter((line) => /^v\d+\s*$/.test(line))
  assert.deepEqual(versionLines, ['v1'])
  assert.equal(summaryVersion(text), 1)
  const second = await store.seedSummary('ignored', 512)
  assert.deepEqual(second, { seeded: false })
})

test('journal append/read, net-change collapse, and pre-journal backfill', async (t) => {
  const store = await tempStore(t)
  await store.ensure()

  const entryA = await store.appendRawEntry({ content: 'fact A', tags: ['a'] })
  const entryB = await store.appendRawEntry({ content: 'fact B', tags: ['b'] })
  await store.appendJournal({ op: 'add', id: entryA.id, ts: entryA.ts, entry: entryA })
  await store.appendJournal({ op: 'add', id: entryB.id, ts: entryB.ts, entry: entryB })

  const first = await store.readJournal(0)
  assert.equal(first.events.length, 2)
  assert.equal(first.maxSeq, 2)

  const updatedB = { ...entryB, content: 'fact B updated' }
  await store.appendJournal({ op: 'update', id: entryB.id, ts: entryB.ts, entry: updatedB })
  await store.appendJournal({ op: 'delete', id: entryA.id, ts: entryA.ts, entry: entryA })

  const after = await store.readJournal(first.maxSeq)
  assert.equal(after.events.length, 2)
  const net = journalToNetChanges(after.events)
  assert.equal(net.length, 2)
  const deleted = net.find((event) => event.id === entryA.id)
  const updated = net.find((event) => event.id === entryB.id)
  assert.equal(deleted.op, 'delete')
  assert.equal(deleted.entry.content, 'fact A')
  assert.equal(updated.op, 'update')
  assert.equal(updated.entry.content, 'fact B updated')
})

test('ensureJournalBackfill creates add events for v0.1.0 raw entries', async (t) => {
  const store = await tempStore(t)
  const entry = await store.appendRawEntry({ content: 'legacy fact', tags: ['legacy'] })
  const { backfilled } = await store.ensureJournalBackfill()
  assert.equal(backfilled, 1)
  const { events } = await store.readJournal(0)
  assert.equal(events.length, 1)
  assert.equal(events[0].op, 'add')
  assert.equal(events[0].id, entry.id)
  const second = await store.ensureJournalBackfill()
  assert.equal(second.backfilled, 0)
})

test('parseRolloutBlocks extracts timestamped blocks only', () => {
  const text = '# Rollout summary sid\n\n## 2026-08-15T10:00:00.000Z\n\nblock one\n\n## 2026-08-15T11:00:00.000Z\n\nblock two\n'
  const blocks = parseRolloutBlocks(text)
  assert.equal(blocks.length, 2)
  assert.deepEqual(blocks[0], { header: '2026-08-15T10:00:00.000Z', text: 'block one' })
  assert.deepEqual(blocks[1], { header: '2026-08-15T11:00:00.000Z', text: 'block two' })
})

test('buildConsolidationInput honors its byte budget', () => {
  const input = buildConsolidationInput({
    current: 'current summary '.repeat(500),
    rollouts: ['rollout '.repeat(500), 'rollout two '.repeat(500)],
    journal: ['- [1] ADDED mem-x: journal '.repeat(500)],
    maxBytes: 8000
  })
  assert.equal(byteLength(input) <= 8000, true)
  assert.equal(input.includes('## Existing summary'), true)
  assert.equal(input.includes('## New rollout summaries'), true)
  assert.equal(input.includes('## New raw memory changes'), true)
})

test('entry validation enforces content and tag quotas', () => {
  const ok = validateEntryInput('  fact  ', [' tag1 ', '', 'tag2'])
  assert.equal(ok.content, 'fact')
  assert.deepEqual(ok.tags, ['tag1', 'tag2'])

  assert.throws(() => validateContent('   '), /non-empty/)
  assert.throws(() => validateContent('x'.repeat(2001)), /exceeds/)
  assert.throws(() => normalizeTags(['a'.repeat(49)]), /exceeds 48 characters/)
  const many = normalizeTags(Array.from({ length: 20 }, (_, i) => `tag${i}`))
  assert.equal(many.length, 16)
})
test('tokenizeQuery and makeSnippet support multi-term search', () => {
  assert.deepEqual(tokenizeQuery('Alpha, beta-中文'), ['alpha', 'beta', '中文'])
  const content = 'x'.repeat(80) + 'needle here' + 'y'.repeat(200)
  const snippet = makeSnippet(content, ['needle'])
  assert.equal(snippet.includes('needle'), true)
  assert.equal(snippet.startsWith('…'), true)
  assert.equal(snippet.endsWith('…'), true)
})

test('searchEntries ranks, filters tags, and honors all/any modes', () => {
  const now = Date.parse('2026-08-15T12:00:00Z')
  const entries = [
    { ts: '2026-08-15 10:00', id: 'a', tags: ['project'], content: 'alpha beta project fact' },
    { ts: '2026-08-14 10:00', id: 'b', tags: ['other'], content: 'gamma project note' },
    { ts: '2026-08-15 11:00', id: 'c', tags: [], content: 'alpha only' }
  ]
  const all = searchEntries(entries, 'alpha beta', { mode: 'all', now })
  assert.deepEqual(all.map((item) => item.entry.id), ['a'])
  const any = searchEntries(entries, 'alpha beta', { mode: 'any', now })
  assert.deepEqual(any.map((item) => item.entry.id).sort(), ['a', 'c'])
  const tagged = searchEntries(entries, 'project', { tags: ['project'], now })
  assert.deepEqual(tagged.map((item) => item.entry.id), ['a'])
  const ranked = searchEntries(entries, 'project', { now })
  assert.equal(ranked[0].entry.id, 'a')
  assert.equal(ranked[0].score > ranked[1].score, true)
})

test('scoreEntry weights exact tag matches and recency', () => {
  const now = Date.parse('2026-08-15T12:00:00Z')
  const tagged = scoreEntry({ ts: '2026-08-15 10:00', content: 'about project', tags: ['project'] }, ['project'], now)
  const untagged = scoreEntry({ ts: '2026-08-15 10:00', content: 'about project', tags: [] }, ['project'], now)
  assert.equal(tagged.score > untagged.score, true)
  const newer = scoreEntry({ ts: '2026-08-15 10:00', content: 'fact', tags: [] }, ['fact'], now)
  const older = scoreEntry({ ts: '2026-07-01 10:00', content: 'fact', tags: [] }, ['fact'], now)
  assert.equal(newer.score > older.score, true)
})

test('raw parse cache invalidates after mutations', async (t) => {
  const store = await tempStore(t)
  const entry = await store.appendRawEntry({ content: 'original content', tags: ['one'] })
  assert.equal((await store.readRawEntries())[0].content, 'original content')
  await store.updateRawEntry(entry.id, { content: 'updated content' })
  assert.equal((await store.readRawEntries())[0].content, 'updated content')
  const hits = await store.searchRaw('updated', { mode: 'all' })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].score > 0, true)
})

test('fileBytes and rolloutFileCount report on-disk state', async (t) => {
  const store = await tempStore(t)
  await store.seedSummary('hello', 512)
  await store.appendRawEntry({ content: 'fact', tags: [] })
  await store.appendRolloutSummary('sid-test', 'block')
  assert.equal((await store.fileBytes('memory_summary.md')) > 0, true)
  assert.equal((await store.fileBytes('raw_memories.md')) > 0, true)
  assert.equal(await store.rolloutFileCount(), 1)
})
test('truncateUtf8Markdown keeps line boundaries and drops unclosed fences', () => {
  const text = '# DSH memory\n\nv2\n\n## Notes\n\nline one\nline two\n\n```js\nconst x = 1\n'
  const bounded = truncateUtf8Markdown(text, 40)
  assert.equal(byteLength(bounded) <= 40, true)
  assert.equal(bounded.includes('```js'), false)
  assert.equal(bounded.includes('line two'), false)
  assert.equal(bounded.endsWith('\n'), true)
})

test('validateMergedSummary rejects malformed model output', () => {
  const valid = '# DSH memory\n\nPreamble.\n\nv3\n\n## Facts\n\n- fact\n'
  assert.deepEqual(validateMergedSummary(valid), { ok: true, text: valid.trim() })
  assert.equal(validateMergedSummary('no header here').ok, false)
  assert.equal(validateMergedSummary('# DSH memory\n\n## Facts\n').ok, false)
  assert.equal(validateMergedSummary('# DSH memory\n\nv3\n').ok, false)
})

test('summary history archives, prunes, lists, and restores by version', async (t) => {
  const store = await tempStore(t)
  const v1 = '# DSH memory\n\nPreamble.\n\nv1\n\n## Facts\n\n- one\n'
  await store.writeAtomic('memory_summary.md', v1)
  const v2 = '# DSH memory\n\nPreamble.\n\nv2\n\n## Facts\n\n- two\n'
  await store.writeAtomic('memory_summary.md', v2)
  const archived2 = await store.archiveCurrentSummary(2)
  assert.equal(archived2 !== null, true)
  const v3 = '# DSH memory\n\nPreamble.\n\nv3\n\n## Facts\n\n- three\n'
  await store.writeAtomic('memory_summary.md', v3)
  await store.archiveCurrentSummary(2)
  const history = await store.listSummaryHistory()
  assert.equal(history.length, 2)
  const latest = await store.latestSummaryHistory(2)
  assert.equal(latest.version, 2)
  assert.equal(latest.text.includes('- two'), true)
  assert.equal((await store.latestSummaryHistory(1)), null)
})
test('hashText is deterministic', () => {
  assert.equal(hashText('abc'), hashText('abc'))
  assert.notEqual(hashText('abc'), hashText('abd'))
})

test('writeSeedSummary overwrites with the requested version and budget', async (t) => {
  const store = await tempStore(t)
  await store.seedSummary('old body', 512)
  const written = await store.writeSeedSummary('new body '.repeat(200), 512, 3)
  const text = await store.readSummary()
  assert.equal(written.bytes <= 512, true)
  assert.equal(summaryVersion(text), 3)
  assert.equal(text.includes('new body'), true)
  assert.equal(text.includes('old body'), false)
})
