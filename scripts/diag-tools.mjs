#!/usr/bin/env node
// Diagnostic: compile the deployed plugin's tool definitions against the
// real dsh-tools DSL. The host registers every memory_* tool through
// `tools.register(defineTool(...))`; a schema that the DSL rejects surfaces
// here as a compile error — the same error the plugin's apply() would catch
// per tool (or abort on) at startup.
//
// Usage:
//   node scripts/diag-tools.mjs [indexPath]
// Default indexPath is the installed copy under the DSH profile.
import { homedir } from 'node:os'
import { join } from 'node:path'

const indexPath = process.argv[2] || join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@dsh-external', 'dsh-memory', 'lib', 'index.js')
const url = 'file:///' + indexPath.replace(/\\/g, '/')

const mod = await import(url)
if (typeof mod.toolDefinitions !== 'function') {
  console.log('SKIP: deployed copy does not export toolDefinitions (old version); sync first.')
  process.exit(0)
}

const fakeStore = {
  readSummary: async () => '',
  readRawEntries: async () => [],
  readState: async () => ({}),
  readJournal: async () => ({ events: [] }),
  fileBytes: async () => 0,
  rolloutFileCount: async () => 0,
  listSummaryHistory: async () => [],
  archivedRawStats: async () => ({ count: 0, bytes: 0 }),
  path: (file) => file,
  lockOwner: true
}
const fakeResolved = {
  memoryDir: 'C:/memories',
  maxBytes: 8000,
  consolidateMaxBytes: 40000,
  keepSummaryVersions: 20,
  rawArchiveMaxBytes: 200000,
  autoSummarize: true,
  summarizeProvider: '',
  summarizeModel: '',
  summarizeDebounceMs: 0,
  consolidateEvery: 3,
  summaryMaxTokens: 600,
  consolidateMaxTokens: 1500,
  llmRetries: 1,
  maxActiveSummaries: 4,
  scopedMemory: false,
  scopeMaxBytes: 2400,
  redactSecrets: true,
  readOnlyScopes: [],
  embeddingBaseURL: '',
  embeddingApiKey: '',
  embeddingModel: '',
  seedFromAgentsMd: true
}
const fakeRuntimeStats = {
  activeSummaries: 0,
  consolidating: false,
  llmCalls: 0,
  llmMs: 0,
  llmFailures: 0,
  errorCount: 0,
  lastError: null,
  summarizeSkipCounts: {},
  lastSummarizeSkip: null
}

try {
  const definitions = mod.toolDefinitions(
    fakeStore,
    fakeResolved,
    () => {},
    fakeRuntimeStats,
    { state: {} },
    async () => ({ key: 'global', store: fakeStore, runtime: { key: 'global' } }),
    async () => {},
    new Map()
  )
  console.log(`OK: ${definitions.length} tools compiled`)
  for (const definition of definitions) {
    console.log(`  - ${definition.name}`)
  }
} catch (error) {
  console.log('FAILED: toolDefinitions threw')
  console.log(String(error && error.stack ? error.stack : error))
  process.exit(1)
}
