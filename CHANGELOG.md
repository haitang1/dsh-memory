# Changelog

## 0.2.12 (2026-09-10)

### Fix: stop settings saves from pinning defaults, and floor the consolidation budget

Raising a schema default is not enough on its own: the user layer outranks the
composition base and the schema, so a value written by an older release keeps
overriding the new default. 0.2.11 raised `consolidateMaxTokens` to 8192, yet an
install that had ever saved the Memory settings card still carried
`consolidateMaxTokens: 3000` in its user layer and kept failing every merge with
`dsh-memory: LLM output reached max tokens` — the summary never advanced while
the plugin still loaded, served all 14 tools, and answered the settings endpoint
(verified live: journal cursor stuck at 13/42, `lastConsolidatedAt` 7 days old).

Root cause: the Web card seeded its form with the **resolved** value and saved
the whole object through `settings.replace`, so a single save wrote all 22 fields
— including every default — into the user layer.

- **The card now persists only the fields you changed.** It posts a
  `{ set, unset }` diff, and a field saved back at its default removes its
  user-layer entry instead of re-pinning the default.
- **The endpoint normalizes every payload into that minimal patch** and applies
  it with `settings.mutate` (path-addressed `set`/`unset`) instead of
  `settings.replace`, so the legacy full-section payload — including one from a
  card cached in a browser — cannot pin defaults either.
- **`consolidateMaxTokens` has a runtime floor** derived from `maxBytes`
  (`min(16384, max(4096, ceil(maxBytes / 2)))`): a sub-floor value is lifted to
  the floor rather than obeyed, because a budget that cannot emit the bounded
  summary fails every merge. Larger configured values are still honored.
- **The lift is observable**: `memory_stats` reports the effective
  `summaryMaxTokens` / `consolidateMaxTokens` and a `configAlerts` array, the
  plugin logs a warning, and `diagnostics.json` records it.
- **Truncation failures now name the cause**: `LLM output reached max tokens
  (consolidateMaxTokens=3000; raise it in the Memory settings card or remove the
  user-layer override)`.
- `scripts/check-release.mjs` resolves its root with `fileURLToPath`, so
  `npm run check` runs on Windows instead of failing with `E:\E:\…`.
- Guarded by new tests: minimal-patch saves, reset-to-default unset, the
  set/unset protocol, malformed payloads, `defaults` in the snapshot, source
  guards for `settings.mutate` / the token floor, and an `apply()` smoke that
  asserts a sub-floor budget is lifted and reported. Suite is 71/71.
- Docs: README (en/zh) gains an **Upgrade notes / 升级须知** section explaining
  the three-layer resolution order and how to clear a stale override; AGENTS.md
  records the release rule.

## 0.2.11 (2026-09-05)

### Fix: raise consolidateMaxTokens so consolidation fits the summary

- With auto-summarization restored (0.2.10), the consolidation step surfaced a
  second default-cap issue: `consolidateMaxTokens` default 3000 is too small to
  emit the merged summary for a ~8 KB bounded memory file (~4-6 K tokens of
  Chinese text), so the merge LLM failed with `LLM output reached max tokens`
  and the summary never advanced (verified live: distill wrote a rollout, then
  consolidation errored).
- Raise the default to **8192** (schema max 16384; the default model's output
  cap is 256 K, so this is comfortable headroom). Docs/types synced.

## 0.2.10 (2026-09-05)

### Fix: wait for the llm service so automatic summarization actually runs

- The plugin captured `ctx.get('llm')` once at apply() time. On DSH 0.1.2-rc.1
  that returns undefined, and `scheduleSummarize` then skips every turn with
  reason `disabled` (silently — no error, no rollout, no consolidation; the
  injected summary never advances). Verified on the live deployment: live
  config shows `autoSummarize: true` while `memory_stats` reports `llm calls: 0`
  and `skips {"disabled":1}`.
- Acquire the service via `ctx.inject(['llm'], …)` instead, matching how the
  tools/skills registrations already wait for their services. Summary of the
  fix: a mutable `llm` holder filled by the inject callback.
- Add a host-wiring source guard: `inject(['llm'])` present, and no
  boot-time `const llm = ctx.get('llm')`. Suite is 65/65 when the harness deps
  are present (the apply smoke is skipped otherwise).

## 0.2.9 (2026-09-05)

### Compat: DSH 0.1.2-rc.1 (Session.events → Surface layer) + turn distillation guard

- DSH 0.1.2-rc.1 replaced `Session.events` with the Surface layer
  (`snapshotEvents`/`deriveMessages`). `extractTurnText` called
  `agent.session.events.entries()`, which threw
  `Cannot read properties of undefined (reading entries)` on **every** turn
  summarization (silently skipping auto-memory). It now reads
  `agent.session.snapshotEvents(fromSeq)` and uses `event.seq` (also tracked
  as `4251aa8`).
- Add a host-wiring source guard (`test/host-wiring.test.js`): asserts
  `snapshotEvents` is used and `session.events.entries()` is gone, so the next
  Surface-layer drift fails in CI instead of at turn summarization. Suite is
  64/64 when the harness deps are present (the apply smoke is skipped
  otherwise).

## 0.2.8 (2026-09-05)

### Compat: DSH 0.1.2-rc.1 (settingsNamespace helper removed) + released hardening

- `dsh-settings@0.1.2-rc.1` removed the `settingsNamespace` helper export; the
  `register()` API now takes the namespace string directly. The plugin called
  `settings.register(settingsNamespace('memory'), …)`, which crashed the host
  bundle on the 0.1.2-rc.1 line with `The requested module does not provide an
  export named 'settingsNamespace'`. It now calls `settings.register('memory', …)`
  and drops the unused import (also tracked as `beee3e9`).
- Tighten `peerDependencies` to the verified harness line:
  `@deepseek-ai/dsh-*` `^0.1.2-rc.1` and `@deepseek-ai/cordis` `^4.0.1`.
  (Pre-1.0 DSH ships breaking minor bumps, so semver satisfaction alone does
  not guarantee runtime compatibility — this makes the declared surface match
  the harness the release was validated against.)
- Add a host-wiring test suite (`test/host-wiring.test.js`): source-level guards
  (bare-string settings namespace, the removed `settingsNamespace` helper absent,
  full 14-tool surface, `agent/turn-stopping`, `systemPrompt.context`,
  `AUTO_MEMORY_SKILL`) plus an `apply()` smoke driven through a fake cordis ctx
  that asserts the namespace string, the 14 registered tools, the auto-memory
  skill, the injection hook, and the settings route. The smoke imports the
  harness packages, so in a zero-dependency CI it skips and the suite stays
  green; where the harness is present it runs for real.
- README/STATUS note the DSH 0.1.2-rc.1 compatibility. Suite is 63/63 when the
  harness deps are present (the apply smoke is skipped otherwise).

## 0.2.7 (2026-08-29)

### Fix: auto-memory runtime skill missing required `source`

- `AUTO_MEMORY_SKILL` now declares `source: 'runtime'`. The DSH skill registry
  (`dsh-skill`) validates loaded definitions and rejects runtime skills without
  a string `source` (`loaded skill "auto-memory" source must be a string`).
  Registration itself was lenient, so the skill appeared in the catalog and
  only failed when actually loaded. After this fix, `skill("auto-memory")`
  resolves normally.

## 0.2.6 (2026-08-18)

### Full configuration in the Web settings card

- The "Memory (dsh-memory)" card now exposes **every** plugin config field
  (22 total, was 4), grouped into General / Auto-summarization &
  consolidation / Scopes / Security & embeddings, with en/zh copy for every
  label and hint. No host-side change: GET already returns the full resolved
  section and POST replaces it wholesale, so the card's full draft
  round-trips every field.
- `embeddingApiKey` renders as a masked password input; the unchanged value
  round-trips untouched (no redaction placeholder that would clobber the key).
- `readOnlyScopes` is edited as a comma-separated text input.
- `memoryDir` carries a "restart DSH to take effect" hint (the store directory
  is fixed at boot).
- Number inputs carry the schema bounds (min/max) and keep the previous
  value when cleared, so an empty field cannot submit an invalid number.
- Tests: one new case asserts every field has en+zh label/hint copy and is
  wired through `update(key, ...)`; suite is 60/60.

## 0.2.5 (2026-08-18)

### DSH 0.1.0-rc.7 compatibility

- rc.7 changed the `settings.plugin.item` slot from a generic entry to a
  **keyed slot**: registration now requires `options.key`, and the plugin
  configuration tab dispatches cards by **settings namespace** (the tab
  renders the intersection of the namespaces the Host serves via
  `settings.describe` and the keys registered into the slot). The client
  bundle registered with `id: 'memory'`, which rc.7's loader rejected with
  `failed to apply loader entry ... keyed slot "settings.plugin.item"
  requires options.key` — the DSH web app then failed to boot
  (`Failed to load plugins`). The card now registers with `key: 'memory'`
  (its own settings namespace), so it loads and renders.
- rc.7 removed the hard-coded `WEB_SETTINGS_NAMESPACES` allowlist from
  `dsh-host-apiproxy` (all registered namespaces are served), so
  `scripts/patch-web-settings.ps1` no longer applies and
  `scripts/verify-after-restart.ps1` now reports the rc.7 behavior instead
  of failing.
- New `scripts/start-dsh-logged.ps1`: diagnostic launch path that restarts
  the web process with stdout/stderr redirected to `$DSH_HOME/logs/`.
- Tests: card registration assertion updated to the keyed protocol;
  suite is 59/59.

## 0.2.3 (2026-08-16)

### Auto-summarization pipeline fixes

- `extractTurnText` silently dropped every assistant reply: DSH stores
  `assistant/message` events with the message record nested at
  `event.data.message`, while `user/message` events carry it directly at
  `event.data`. The old `event.data.content` read produced near-empty turn
  text, so the `too-short` gate (200 bytes) skipped real conversations and
  no global rollout was ever written. New `extractMessageText` helper
  unwraps both shapes (moved to `lib/automation.js` so it is unit-tested).
- Settings overrides now survive restarts: the settings scope only notifies
  watchers on change, so the plugin re-seeded `resolved` from the
  composition `base` at boot and ignored the user document (e.g.
  `summarizeDebounceMs: 0`) until the first live edit. The registration
  effect now applies `settingsScope.get()` once before watching.
- Internal distill/consolidate LLM calls now pass `reasoningEffort: 'off'`:
  the deployment's default Max reasoning consumed the output budget, so
  every run failed with "LLM output reached max tokens" even with a raised
  cap. Memory curation is extraction, not reasoning — no chain-of-thought
  needed. Models without reasoning control fall back automatically
  (UNSUPPORTED_REASONING_EFFORT → plain retry).
- Default token caps raised for headroom: `summaryMaxTokens` 600 → 1500,
  `consolidateMaxTokens` 1500 → 3000.
- Tests: `extractMessageText` regression cases (user/assistant nesting,
  tool-call blocks, malformed data); suite is 59/59.

## 0.2.2 (2026-08-16)

### Real automatic memory

- `lib/automation.js`: new `auto-memory` runtime skill telling agents to
  proactively recognize key facts (preferences, decisions, conventions,
  fixes, facts), write them via `memory_add` with tags and dedup, query
  memory via `memory_search`/`memory_read` when a task depends on history,
  and correct stale entries via `memory_update`/`memory_delete`.
- `resolveSummarizeRoute` fallback chain for the auto-summarization model:
  explicit `summarizeProvider/summarizeModel` → `agentDefaultModel`
  service → the `agent-default-model` settings namespace directly (fixes
  silent skipping when the agent-scoped service is unavailable from a
  host-level context).
- Diagnostics: `memory_stats` now reports `summarizeSkipCounts` and
  `lastSummarizeSkip` (reason/time/session) for every skipped
  summarization gate (disabled/subagent/debounced/too-short/no-lock/
  already-running/queue-full/no-route), so the pipeline's behavior is
  observable.
- New `summarizeDebounceMs` config (default 300000, 0 disables the
  debounce) controlling how often a session's turns are distilled.
- Tests: `test/automation.test.js` (6 cases) covering the route fallback
  chain and the skill definition; suite is 55/55.

## 0.2.1 (2026-08-15)

### Web settings page card

- New client bundle `lib/client.js` (`dsh.client` + `exports["./client"]`):
  registers a "Memory" card on the `settings.plugin.item` slot (order 30) so
  the plugin configuration page shows editable memory settings (maxBytes,
  consolidateEvery, autoSummarize, seedFromAgentsMd) with save/discard.
- New host backend `lib/web.js`: a same-origin `/_dsh/memory/settings`
  endpoint (GET snapshot / POST save with optimistic revision, 403
  cross-site rejection, 409 on conflict) registered through `webServer`
  when present; dependency-free for unit testing.
- `scripts/patch-web-settings.ps1`: idempotently adds `memory` to the
  `WEB_SETTINGS_NAMESPACES` allowlist in the deployed `dsh-host-apiproxy`
  package so the Web settings API also serves the memory namespace
  (optional; the card works without it). Backs up the target, re-checks
  syntax, and rolls back on failure.
- `scripts/verify-after-restart.ps1` now also checks the allowlist and the
  new client/web files (opt-out via `-SkipWebSettingsCheck`).
- Tests: `test/web-settings.test.js` (6 cases) covering the endpoint
  lifecycle and the client bundle registration; suite is 47/47.

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
