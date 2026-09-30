# Changelog

## 0.3.1 (2026-09-30)

### Move the per-turn read off the deprecated Surface call

DSH 0.2.0-rc.2 marks `agent.session.snapshotEvents()` **`@deprecated`** —
"existing logic may remain unmigrated for now, but new calls are prohibited" —
and that call was this plugin's only way to read a turn. The supported path is
now a `sessionQuery` observation lease:

- `ctx.inject(['sessionQuery'])` waits for the query service (the same pattern
  the llm service already uses), and `observeSession(sessionId, { projectionMode: 'none' })`
  returns an immutable cut whose `events` are the **raw** log; the lease is
  disposed immediately after the read.
- It is never `deriveMessages()`: that projection removes compaction-shadowed
  messages — exactly the content that has not been distilled into memory yet.
  A host-wiring guard enforces this on comment-stripped source.
- The deprecated call stays as the fallback, so a composition without a usable
  query backend (or an older DSH line) keeps distilling instead of going silent;
  a failed observation logs and falls back.

Because the observation is async, the work queue is claimed before the read and
the `too-short` skip is now reported from the job instead of before it. Suite
stays at 88; the host-wiring guard additionally requires `observeSession` and
the injected service.

## 0.3.0 (2026-09-30)

### Capture subagent results, the one content class memory never saw

Distillation is driven by `agent/turn-stopping`, which the plugin only acts on
for **root** sessions, so every delegated child was skipped by design — in a
delegation-heavy session the densest durable content (research findings, the
fix a child verified) never reached memory at all.

`subagent/end` carries the child's final answer (`lastAssistantMessage`), but
its payload has no parent identity: dsh-subagent dispatches the lifecycle with
a **scope carrier keyed to the delegating parent agent**, so the parent is only
reachable through the dispatch receiver. The plugin therefore registers the
listener on that agent's own scoped context (`agent.ctx`, obtained from
`agent/created` and, for agents already live at load time, from the
`agent/turn-stopping` handler the plugin already consumes). Each agent's scope
then receives exactly its children's events — no global run-to-parent
bookkeeping, and disposal follows the agent's teardown.

- New config key **`captureSubagents`** (default `true`): keep a bounded
  excerpt of each settled child's final answer as a rollout block for the
  parent session, via the new pure `formatSubagentResult` (2000 chars max,
  ignored below 80 chars, `[subagent result (<stopReason>)]` marker).
- **No extra LLM call**: capturing is one file append under the existing store
  lock; the periodic consolidation already reads rollout blocks and distills
  them, so cost is bounded by the summary pipeline that already runs.
- Duplicate suppression: a continuable child settles once per residency epoch,
  so the last captured body per child session is remembered (bounded to 64) and
  repeats are skipped with reason `subagent-duplicate`; empty/short children
  report `subagent-empty` through `memory_stats.skips`.
- Scope routing matches turn distillation: global, or the parent's
  workspace/project scope when `scopedMemory` is on.
- Graceful degradation: without `agent.ctx` (compositions that do not scope
  agents) capture is silently unavailable, and a non-lock-owning instance
  skips with `no-lock` instead of writing.

Suite 86 → 88 (`formatSubagentResult`, plus a host-wiring source guard that
pins the capture to the agent's scoped context rather than the host ctx).
Configuration surface is now 23 fields (four-place sync: `Config` →
`lib/types/index.d.ts` → README en/zh → the client card).

## 0.2.16 (2026-09-30)

### Distill tool activity, and drop retired DSH vocabulary

Turn distillation read only `user/message` and `assistant/message` text blocks,
so a coding turn reached memory as prose while the part that usually carries
the durable knowledge — the command that ran, the test that failed, the fix
that passed — was dropped: `tool/call` and `tool/result` are separate session
events. `extractTurnText` now appends a bounded digest of the turn's tool
activity, formatted by two new pure helpers in `lib/automation.js`:

- `formatToolCall` — `[tool] <name> <arguments>`, whitespace collapsed, arguments
  clipped (≤240 chars), so a call is one readable line;
- `formatToolResult` — `[tool result] ok|error: <reason or first text block>`,
  preferring the harness-recorded error reason over the model-facing content.

The digest has its own byte budget (≤4000 chars, at most half of
`MAX_TURN_INPUT_BYTES`) and is appended under a `[tool activity]` marker after
the conversation text, so trimming the conversation cannot drop it.

Also removes three pieces of retired vocabulary that the 0.2.0-rc.2 audit
surfaced (behaviour-neutral; each was wrong or inert):

- Synthesized LLM calls now send a producer-named source (`{ kind: 'dsh-memory' }`),
  matching first-party ephemeral calls such as `dsh-session-title-llm`. The
  generic v3 `{ kind: 'plugin', plugin }` pair no longer exists in the v4
  message-source map.
- The keyed `plugins.row.config` registration no longer passes `order`/`label`:
  those belong to list slots and are ignored (type-invalid) on a keyed one.
- `dsh.client.inject` no longer lists `@deepseek-ai/dsh-client-runtime`, which
  does not exist in 0.2.0-rc.2; the bundle loads `react` (host-provided) and
  `@deepseek-ai/dsh-client-ui-primitives`.

Suite 84 → 86 (`formatToolCall` / `formatToolResult`).

## 0.2.15 (2026-09-30)

### Verified on DSH 0.2.0-rc.2; no code change required

The live profile moved from DSH 0.2.0-rc.1 to **0.2.0-rc.2** on 2026-09-30.
Every integration point was re-checked against the installed 0.2.0-rc.2 tree
instead of trusting the peer range:

- Load: `$DSH_HOME/memories/diagnostics.json` — all 14 `memory_*` tools,
  `skillRegistered: true`, empty `toolErrors`, empty `configAlerts`.
- Settings seam: `GET /_dsh/memory/settings` → 200 (`writable: true`, 20
  fields). `dsh-settings` is `SettingsForms` with
  `configure/describe/update/replace/mutate` and **no `register()`/`get()`** —
  exactly the no-`register` volatile branch this plugin already takes.
- Pipeline: the summary advanced to **v23** and `memory_stats` reported
  `llm calls: 2 (14299 ms, 0 failures)`, `errors: 0`, `skips {}`, last
  consolidation `13:44:47Z` — six minutes after the rc.2 `dsh web` process
  started (`13:38:34Z`), so turn-stopping → rollout → consolidation ran on
  rc.2, not merely under it.
- APIs present in 0.2.0-rc.2: `dsh-llm` `createUserMessage` + `llm.stream`,
  `dsh-tools` `defineTool`, `dsh-session` `snapshotEvents`/`deriveMessages`,
  `dsh-system-prompt` `context()`, `agent/turn-stopping` (emitted by
  `dsh-agent-loop`; the `agent` field is added by the agent dispatcher, so the
  existing destructuring stays correct), `loader/volatile-update`, `cordis`
  4.0.4 and `schemastery` 3.18.4 with `Schema#volatile`.
- Peer gate: 0.2.0-rc.2 validates `@deepseek-ai/dsh-*` peers with
  `semver.satisfies(runtime, range, { includePrerelease: true })`, so
  `^0.1.2-rc.1 || ^0.2.0-rc.1` admits 0.2.0-rc.2 and no range change is needed.

Two forward-looking notes are recorded here because they are the next DSH
deprecations this plugin will meet (no behaviour change in this release):

- `session.snapshotEvents()` is marked `@deprecated` ("new calls are
  prohibited") and is this plugin's only per-turn reader. Its successor is
  `ctx.sessionQuery.observeSession(...)`, and any migration must keep reading
  **raw** events — never `deriveMessages()`, which drops the
  compaction-shadowed content the projector must not lose.
- The client slot `settings.plugin.item` no longer exists in 0.2.x, so the
  0.1.5 card is inert there; `plugins.row.config` + `configForms` is the live
  path (kept guarded, so nothing throws).

Docs: `docs/STATUS.md` records the 0.2.0-rc.2 matrix; `AGENTS.md` refreshes the
deployment facts (global 0.2.0-rc.2 install, the HTTP/1.1 fetch workaround) and
adds the rc.2 row to the lessons table.

## 0.2.14 (2026-09-29)

### Verified on DSH 0.2.0-rc.1; peer ranges extended

DSH 0.2.0-rc.1 keeps the settings model 0.1.7 introduced (`SettingsForms`, the
loader-row config as the settings document, forms only for `meta.volatile`
fields) and every integration point this plugin uses, so 0.2.13 runs unchanged
on it. Verified live rather than by semver alone — a 0.1.x → 0.2.x move falls
outside the previous `^0.1.2-rc.1` range by construction, and this plugin's own
rule is that a range change follows a real check:

- Load: `diagnostics.json` reports all 14 `memory_*` tools, `skillRegistered:
  true`, empty `toolErrors`.
- Seam: `GET /_dsh/memory/settings` returns 200 with schema `defaults`; a
  same-origin save still normalizes to a minimal patch and persists through
  `settings.mutate` (on this line the loader-row config *is* the settings
  document).
- APIs present in 0.2.0-rc.1: `dsh-session` `snapshotEvents`/`deriveMessages`,
  `dsh-llm` `createUserMessage`, `dsh-tools` `defineTool`, `dsh-settings`
  `SettingsForms`/`describe()`/`mutate()`. `settings.register()` is gone, which
  is exactly the path the plugin already takes when it is absent.
- Events: `agent/turn-stopping` (emitted by `dsh-agent-loop`) and
  `loader/volatile-update` (declared by `cordis-plugin-loader`) both remain.
- Forms: `@deepseek-ai/schemastery` 3.18.4 exposes `Schema#volatile`, so the
  0.2.0 settings-form path is active.
- End to end: a memory write triggered consolidation on 0.2.0-rc.1 —
  `llm calls: 1 (10251 ms, 0 failures)`, summary v168 → v169, journal cursor
  caught up, `errors: 0`.

`peerDependencies` for `dsh-llm` / `dsh-settings` / `dsh-tools` become
`^0.1.2-rc.1 || ^0.2.0-rc.1`, so both validated lines install cleanly; measured
on the 0.2.0 line: `cordis` 4.0.4, `schemastery` 3.18.4.

## 0.2.13 (2026-09-24)

### DSH 0.1.7 settings seam, alongside the 0.1.5 line

DSH 0.1.7-rc.1 replaced the settings provider (`SettingsProvider` →
`SettingsForms`) and generates an editable form only for `meta.volatile` schema
fields, committing those edits straight into the running config instead of
re-applying the plugin. Adapt to that line without dropping 0.1.5, which the
live profile still runs:

- `lib/volatile.js` (new, dependency-free): `volatileField()` marks a field
  live-editable only where schemastery exposes `Schema#volatile` (the 0.1.5 line
  has no such method, and calling it unconditionally would break plugin load
  there); `isVolatileValue()` / `unboxConfigValue()` / `plainConfig()` read a
  resolved config back as plain values, because a volatile field resolves to a
  cosmokit Volatile *box* rather than the value. Boxes are recognized by their
  globally registered write hook (`Symbol.for('cosmokit.volatile.write')`), so
  no cosmokit import is required.
- `Config` is built from marked fields; `memoryDir` and `seedFromAgentsMd` stay
  ordinary because both are consumed at apply time and a save must re-apply the
  plugin rather than commit live.
- When the settings service exposes no `register()` (0.1.7), `resolved` is
  re-derived from the row config and mirrored on every
  `loader/volatile-update`, so a saved setting takes effect without a restart.
- `lib/web.js` probes for this plugin's namespace (`memory` on 0.1.5, the
  `dsh-memory` loader-row id on 0.1.7) instead of pinning one name, and mutates
  the namespace it actually found.
- `lib/automation.js` reads `agent-default-model` through `describe()` when the
  provider no longer answers `get()`.
- `lib/client.js` registers the 0.1.7 Plugins-page form on `plugins.row.config`
  in addition to the 0.1.5 `settings.plugin.item` card, with a fallback for the
  renamed icon family.
- Suite 71 → 84: volatile-seam units, the namespace probe, both card
  registrations, and a second `apply()` smoke for a 0.1.7-shaped service whose
  boxed config is unboxed and re-read on a volatile commit.

### Fix: `npm run check` on Node 25

Node 25 defaults to the `spec` reporter whenever stdout is not a TTY, so the
suite summary reads `ℹ tests N` and the release check's TAP-only pattern matched
nothing — the check failed with "a parseable summary" while the suite itself was
green. The check now spawns the suite with `--test-reporter=tap` (available on
every Node this package supports) and keeps a fallback pattern for the spec
summary.

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
