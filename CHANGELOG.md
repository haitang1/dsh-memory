# Changelog

## 0.2.0 (2026-08-15)

First feature-complete release after the v0.1.0 baseline. All changes are
backward compatible: the memory root directory remains the canonical global
scope and old raw/summary files continue to work.

### Roadmap P0 - correctness and hardening

- Seed summaries are bounded by `maxBytes` with a single version line.
- `journal.jsonl` records add/update/delete (delete snapshots) and is consumed
  via cursor; v0.1 raw entries are backfilled automatically.
- Rollout summaries are consumed block-by-block via `rolloutConsumed` cursor;
  consolidation input is bounded by `consolidateMaxBytes`.
- Entry quotas: content ≤ 2000 bytes, tags ≤ 16, tag ≤ 48 chars.
- Fixed `BlockAssembler.finish` handling (normal stop is no longer an error)
  and removed the `store.chain` self-deadlock in summarization.
- `dsh-llm`/`dsh-settings` are declared as required peers.
- Node test suite: 39 tests including a real MCP child-process integration.

### Roadmap P1 - quality and observability

- Search: BM25 ranking, tag filters, all/any modes, whole-word/tag/recency
  weights, mtime+size parse cache, snippet windows.
- `memory_stats`: sizes, versions, cursors, rollout/journal counts, background
  jobs, scope inventory, error telemetry, LLM counters.
- `AGENTS.md` resync: source/seed fingerprints, `memory_sync` imports only when
  the summary is untouched, otherwise reports a conflict.
- LLM budgets: `summaryMaxTokens`/`consolidateMaxTokens`/`llmRetries`, per-call
  structured logging.
- Concurrency: `maxActiveSummaries` drop policy, `lastSummarized` pruning,
  `.memory.lock` with 60s stale detection and read-only fallback.
- Summary safety: strict merge validation, line/fence-aware truncation,
  `summary_history/` retention and `memory_rollback`.
- Raw archive: `rawArchiveMaxBytes` moves oldest entries to
  `archive/raw-YYYY-MM.md`; archived entries stay searchable.

### Roadmap P2 - expansion

- **Scoped memory**: `scopedMemory` + `scopeMaxBytes`; stable `ws-<hash>` and
  `project-<git-root>` stores; scoped tools, injection (global + workspace
  budget split), per-scope rollout/consolidation and version history.
- **Retrieval**: BM25 + typo/CJK bigram fuzzy fallback + vector retrieval
  (`vector:true`). Local 256-dim hashed embeddings work out of the box; an
  OpenAI-compatible `/embeddings` endpoint can be configured with
  `embeddingBaseURL`/`embeddingApiKey`/`embeddingModel` and its candidates
  merge with BM25.
- **Interop**: Codex-compatible `memory_export`/`memory_import`; standalone
  stdio MCP server `bin/dsh-memory-mcp.mjs` with 9 tools.
- **Lifecycle**: `importance` 0-3 metadata, exact duplicate prevention,
  `memory_review` (oldest + near-duplicate groups), `memory_merge`.
- **Security**: secret detection/redaction for injected summaries, credential
  rejection in `memory_add`, `readOnlyScopes` write presets.
- **Observability/UI**: scope inventory and error telemetry in `memory_stats`,
  `memory_history`, and `memory_browse` (self-contained interactive HTML
  browser over all scopes).
- **Deployment**: hash-verified `scripts/sync-install.ps1` with dry-run and
  backup; no automatic restart and no memory-data modification.

## 0.1.0 (2026-08-14)

- Codex-like global memory: injected summary, raw memory tools, per-session
  rollout summaries and periodic consolidation.
