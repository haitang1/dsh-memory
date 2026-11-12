# dsh-memory

Codex-like persistent memory for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). The plugin gives every session a durable, auto-injected memory: a distilled global summary is injected into each prompt, agents can read/write/search memories with dedicated tools, and each finished turn is automatically distilled into per-session rollout summaries that periodically re-consolidate the global memory file.

## How it works

```
$DSH_HOME/memories/
├── memory_summary.md           distilled, versioned, bounded memory — injected into every prompt
├── raw_memories.md             append-only dated entries written by the memory tools
├── rollout_summaries/<sid>.md  per-session turn summaries (auto)
├── journal.jsonl               mutation journal consumed by consolidation
├── summary_history/<v>.<ts>.md previous summary versions kept for rollback
├── archive/raw-YYYY-MM.md      oldest raw entries archived past the byte budget
├── scopes/ws-<hash>/...         per-workspace stores (when scopedMemory is enabled)
├── scopes/project-<hash>/...    per-git-root project stores (when scopedMemory is enabled)
└── state.json                  version + journal/rollout cursor bookkeeping
```

- **Injection** — `systemPrompt.context` re-reads `memory_summary.md` at every prompt assembly, so a `memory_add` call surfaces in the very next model step.
- **Tools** — `memory_read`, `memory_add`, `memory_update`, `memory_delete`, `memory_search`, `memory_review`, `memory_merge`, `memory_export`, `memory_import`, `memory_stats`, `memory_browse`, `memory_history`, `memory_rollback`, `memory_sync` (see below).
- **Auto memory** — on each finished turn of a root agent, the new conversation text (plus a bounded digest of the tools it ran, and of any subagent’s final answer) is distilled with the default model into a rollout summary. Every `consolidateEvery` summaries, the scope's summary is re-merged (atomic write, version bump). With `scopedMemory`, rollouts and consolidation route to the session's workspace or project scope. All LLM work is queued, timed out, and never blocks a turn.
- **Seeding** — on first run the plugin seeds the summary from `$DSH_HOME/AGENTS.md` (the Codex-synced global memory) without modifying it.

Current release: **0.5.7** — see [CHANGELOG.md](CHANGELOG.md) for the release history.

## Install

The plugin ships from GitHub (release tags and commit shas) — **there is no npm package**, so `npm install @dsh-external/dsh-memory` is not a supported path. Both paths below need a DeepSeek Harness restart afterwards.

**Recommended: install through the DSH CLI.** It writes the dependency into the profile, resolves it with pnpm, and the bundle patch mounts the row automatically (no `cordis.patch.yml` editing):

```bash
dsh plugin --profile <profile> add 'github:haitang1/dsh-memory#v0.5.7'
```

Pin a release tag (`#v0.5.7`) or a commit sha; without a suffix the default branch is installed. The CLI forwards its arguments to pnpm, so **updating** is the same command with a newer ref, and **uninstalling** is:

```bash
dsh plugin --profile <profile> remove @dsh-external/dsh-memory
```

(`<profile>` is the profile directory name, e.g. `desktop` or `web`.) Memory files under `$DSH_HOME/memories` are never touched by install, update or removal.

**Manual path** (offline, or when running the working tree):

1. Copy the package into the profile's external plugin directory:

   ```powershell
   Copy-Item -Recurse ...\dsh-memory "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\@dsh-external\dsh-memory"
   ```

2. Add a loader row to `~/.dsh/profiles/<profile>/cordis.patch.yml` — it must be an `insert` entry; a standalone `- id:` row only overrides an existing bundle row and will not mount the plugin:

   ```yaml
   - insert:
       - id: dsh-memory
         name: '@dsh-external/dsh-memory'
         config:
           maxBytes: 24000
           autoSummarize: true
   ```

3. Restart DeepSeek Harness. The plugin mounts as `dsh-memory`; its settings form is that row's configuration on the Plugins page.

`scripts/sync-install.ps1 -SourceDir <repo> -TargetDir <install> -Backup` is the Windows shortcut for step 1 when the install already exists.

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `memoryDir` | `$DSH_HOME/memories` | Memory directory (empty = default). |
| `maxBytes` | `24000` | Byte budget of the injected summary (and of the summary file itself). |
| `injectTokens` | `0` | Estimated-token cap for the injected summary; `0` leaves the byte budget in charge. CJK text counts about one token per character, Latin about a quarter. |
| `consolidateMaxBytes` | `40000` | Byte budget of the consolidation input sent to the merge model. |
| `keepSummaryVersions` | `20` | Previous summary versions retained for `memory_rollback` (0 disables history). |
| `rawArchiveMaxBytes` | `200000` | Active raw file byte budget; oldest entries move to `archive/` beyond it. |
| `autoSummarize` | `true` | Distill finished turns into rollout summaries. |
| `summarizeProvider` / `summarizeModel` | selected agent model | Model used for summarization. |
| `summarizeDebounceMs` | `300000` | Minimum interval between summarizations of the same session (0 disables the debounce). |
| `consolidateEvery` | `3` | Rollout summaries written before re-consolidating the global summary. |
| `summaryMaxTokens` | `1500` | Max output tokens for turn summarization. |
| `consolidateMaxTokens` | `12288` | Max output tokens for summary consolidation. Values below the floor a `maxBytes`-sized summary needs are lifted at runtime and reported in `memory_stats.configAlerts`. |
| `llmRetries` | `1` | Retries after a transient LLM failure. |
| `maxActiveSummaries` | `4` | Maximum concurrent turn summarizations before new jobs are dropped. |
| `scopedMemory` | `false` | Enable per-workspace memory scopes. |
| `captureSubagents` | `true` | Keep a bounded excerpt (2000 chars) of each settled subagent's final answer as a rollout block. Capturing costs one file append — the periodic consolidation distills it, so no extra LLM call is made. |
| `redactSecrets` | `true` | Redact credential-looking text from injected summaries. |
| `readOnlyScopes` | `[]` | Scope keys whose write tools are blocked (`global`, exact `ws-*`/`project-*` keys, or `*` for all). |
| `embeddingBaseURL` / `embeddingApiKey` / `embeddingModel` | empty | OpenAI-compatible `/embeddings` endpoint for `vector:true`; empty uses local hashed vectors. |
| `scopeMaxBytes` | `2400` | Injected byte budget for the workspace summary when scopedMemory is enabled. |
| `seedFromAgentsMd` | `true` | Seed the first summary from `$DSH_HOME/AGENTS.md`. |

The Web settings form (see below) edits every config field live; keys are likewise overridable through the loader row or the `memory:` section of `settings.yaml`. Settings resolve as schema defaults → composition `base` → **user layer**, and the user layer wins, so the form persists **only the fields you changed** and a field saved back at its default drops its user-layer entry instead of pinning the default. See [Upgrade notes](#upgrade-notes).

## Upgrade notes

**0.5.6 raises the default `maxBytes` from 16,000 to 24,000.** Two prompt-level attempts (0.5.4 characters, 0.5.5 character margin) showed the model does not reliably obey a length target, so the merge kept hovering at 96–99% of a 16 KB budget and the prune pass ran on every merge. The bigger budget gives the summary real headroom again (the current ~16 KB summary is ~66%) while the prompt targets stay in place as best-effort hints; `consolidateMaxTokens` moves from `8192` to `12288` so the token floor for a 24 KB summary is covered without `configAlerts`. **A `maxBytes` value saved in the user layer still wins** — clear it (in the form, or by deleting the key from `memory:` in `$DSH_HOME/settings.yaml`) to get the new default.

**0.5.5 gives the character budget a 5% margin.** 0.5.4's exact CJK bound still let a merge land slightly over the byte target (14,581 B vs 14,400 B), so the prune pass ran on every merge. `summaryTargetChars` now targets ~4,560 characters for a 16 KB budget (≈13.7 KB of CJK), keeping merges under the 90% mark and the prune pass for the exceptions. Validation, the hard cap and the telemetry are unchanged.

**0.5.4 asks the curator for characters, not bytes.** Models cannot measure bytes, so 0.5.3's byte-targeted prompts still left the summary at 99% of the budget. Both prompts now carry a character budget (`summaryTargetChars`: byte target / 3, the CJK worst case) and the current character count; the hard cap at `maxBytes` remains the only truncation (the 90% target is never enforced by cutting the tail). `memory_stats` and `diagnostics.json` now report `lastPrune { beforeBytes, afterBytes, targetBytes, targetChars }`.

**0.5.3 forces the consolidated summary to fit its budget.** 0.5.2's prompt-level target was not enough: merges kept landing at the 16 KB cap and being truncated, so the newest facts could be cut. When a merge still exceeds 90% of the budget, one extra bounded LLM call (`kind: 'prune'`) rewrites it down to that target; malformed/failed prunes keep the merged summary and the hard truncation stays only as a last resort. `memory_stats` now also shows `lastConsolidationPrunedAt`, while `lastConsolidationTruncatedAt` means the final write really had to be truncated. The extra call only happens while the summary is over the target.

**0.5.2 makes the memory pipeline keep up with itself.** Three operational changes, no migration: a turn that arrives during the 5-minute summarization debounce is now distilled when the window closes instead of being dropped; summarization races (`queue-full` / `already-running` / `no-lock`) are retried with widening delays instead of dropped; and consolidation runs once at startup and then every 10 minutes when a backlog is pending, so memory no longer waits for the next user turn (both stay off when `autoSummarize` is disabled). `memory_stats` now reports the injected byte count, its budget ratio/high-water flag, the last truncated consolidation, and the rollout window state. Rollout summaries, compaction/subagent excerpts and the merged summary are **redacted before they are written to disk** (previously redaction happened only at injection time), so secrets no longer accumulate in `rollout_summaries/`; files written by older releases keep whatever they already contain — use `memory_review` + `memory_update` to clean them up.

**0.5.1 keeps the memory injection installed across plugin reloads.** Nothing to do beyond installing the new files and restarting DSH: the injection now waits for the `systemPrompt` service through `ctx.inject` instead of a boot-time `ctx.get`, so a plugin re-applied into a running host (a settings-triggered loader reload, a disable/enable cycle) no longer drops `# DSH memory` silently. Memory data and settings are untouched.

**0.5.0 dropped the DSH 0.1.5 line and fixed secret redaction.** Two consequences for an existing install:

- The plugin now requires DSH **0.1.7+** (`peerDependencies` `^0.1.7-rc.1 || ^0.2.0-rc.1`). A deployment still on 0.1.5 must stay on 0.4.x; on 0.1.7+/0.2.x nothing changes except that the separate settings card is gone — the configuration form on the Plugins page is now the only settings surface.
- `embeddingApiKey` is a schema-declared secret, so `GET /_dsh/memory/settings` no longer contains it; the response reports it through a `secrets` sidecar instead. A write that *clears* the key must send an explicit `unset: ["embeddingApiKey"]` — an absent field means "leave it as it is". (0.4.0 intended this but its schema probe never applied the mark, so the value kept crossing the endpoint; 0.5.0 fixes the probe.)

**`maxBytes` default moved from `8000` to `16000` in 0.3.2.** A `maxBytes` value saved in the user layer still wins, so clear or edit it (in the form, or by deleting the key from `memory:` in `$DSH_HOME/settings.yaml`) to get the larger budget. The optional `injectTokens` cap (default `0` = off) is new, so nothing pins it.

An upgraded plugin may change a config **default**, but a value already stored in the user layer outranks it (defaults → `base` → user). A value pinned by an older release therefore keeps overriding the new default — that is how a `consolidateMaxTokens` of `3000` (the pre-0.2.11 default) kept capping consolidation after 0.2.11 raised the default to `8192`, so every merge failed with `dsh-memory: LLM output reached max tokens` and the summary stopped advancing while the plugin still looked healthy.

Guards from **0.2.12** on:

- **Saving the form no longer pins defaults.** Only the fields you changed are written, and setting a field back to its default removes the user-layer override rather than re-pinning it. The endpoint normalizes whichever payload it receives, so a stale cached page cannot pin defaults either.
- **A too-small consolidation budget is lifted at runtime** to the floor a `maxBytes`-sized summary needs, and reported through `memory_stats.configAlerts` plus a log warning. Larger configured values are still honored.
- A truncation failure now names the key and its effective value instead of only `LLM output reached max tokens`.

To inspect the three layers in effect:

```sh
curl -s http://127.0.0.1:3080/_dsh/memory/settings   # settings.value / .base / .user / .defaults
```

To clear a stale override, edit it in the form, or delete the key from the `memory:` section of `$DSH_HOME/settings.yaml` — the settings provider hot-reloads the file, so no DSH restart is needed.

## Tools

| Tool | Purpose |
| --- | --- |
| `memory_read { scope? }` | Read the global, workspace, or project (nearest git root) memory summary. |
| `memory_add { content, tags?, scope?, importance?, allowDuplicate?, allowSecret? }` | Store one durable fact; obvious credentials are rejected unless `allowSecret:true`, `importance` 0-3 affects ranking, duplicates rejected by default. |
| `memory_update { id, content?, tags?, importance?, scope? }` | Replace an entry's content/tags/importance in the selected scope. |
| `memory_delete { id, scope? }` | Remove an entry from the selected scope. |
| `memory_search { query, tags?, mode?, fuzzy?, vector?, limit?, scope? }` | BM25-ranked search plus optional local hashed-embedding cosine retrieval (`vector:true`) for missing-term candidates. |
| `memory_stats {}` | Report store health: global + per-scope inventory, cursors, history, LLM counters, recent error telemetry. |
| `memory_history { scope? }` | List retained summary versions (newest first) for `memory_rollback`. |
| `memory_browse { targetDir, overwrite? }` | Write a self-contained interactive HTML browser over all scopes. |
| `memory_rollback { version }` | Restore a previously retained summary version. |
| `memory_sync {}` | Re-import AGENTS.md when it changed; reports a conflict instead of overwriting manual summary edits. |
| `memory_export { targetDir, scope?, overwrite? }` | Export a scope to Codex-compatible `memory_summary.md` + `raw_memories.md`. |
| `memory_import { sourceDir, scope?, merge? }` | Import Codex-compatible `raw_memories.md` into a scope (append or replace). |
| `memory_review { scope?, limit?, olderThanDays? }` | List oldest entries and near-duplicate groups for review; never deletes automatically. |
| `memory_merge { ids, keepId?, scope? }` | Merge active entries: longest content, union tags, max importance survive. |



## Standalone MCP server

`bin/dsh-memory-mcp.mjs` exposes the same Markdown memory store over stdio JSON-RPC (MCP) with no DeepSeek Harness runtime dependency. Environment: `DSH_MEMORY_DIR` (default `~/.dsh/memories`), `DSH_MEMORY_REDACT=1` (default). Scope arguments: `global` (default), `workspace`/`project` with a `cwd` argument.

It serves **nine** tools — `memory_read`, `memory_add`, `memory_search`, `memory_update`, `memory_delete`, `memory_merge`, `memory_review`, `memory_history`, `memory_stats`. The host plugin's other five are deliberately host-only, because each is defined by a host surface rather than by the store: `memory_browse` renders the interactive HTML browser through the host Web server, `memory_export`/`memory_import` read and write harness-side paths, `memory_rollback` restores a summary version as part of the host's consolidation bookkeeping, and `memory_sync` reconciles `$DSH_HOME/AGENTS.md` seeding with the host's fingerprint state. The store primitives they build on (`lib/store.js`) are the same file in both processes, so an MCP host can reach every entry — it just edits the Markdown directly instead of through those wrappers.

It serves 9 tools with the same store semantics as the DSH tools: `memory_read`, `memory_add`, `memory_update`, `memory_delete`, `memory_search`, `memory_stats`, `memory_history`, `memory_merge`, `memory_review`. An example client config lives in [`examples/mcp-config.json`](examples/mcp-config.json).



## Deploy / update

`scripts/sync-install.ps1` copies runtime files into a DSH profile external-plugin directory and verifies SHA-256 hashes. It never touches memory data and does not restart DSH; restart is required after sync. Usage:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-install.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File scripts/sync-install.ps1 -Backup
```

### Scripts

| Script | Purpose |
| --- | --- |
| `scripts/sync-install.ps1` | Copy runtime + metadata files into the profile external-plugin directory and verify SHA-256 (`-DryRun` preview, `-Backup` snapshot before writing). |
| `scripts/verify-after-restart.ps1` | Post-restart verification: file hashes, the Web settings allowlist (rc.7 auto-detected as removed), and an installed-copy MCP smoke test (`-SkipMcpSmoke`, `-SkipWebSettingsCheck`). |
| `scripts/restart-dsh.ps1` | Stop and relaunch the DSH web process, then run the verification (`-WhatIf` first; closes the running session). |
| `scripts/start-dsh-logged.ps1` | Diagnostic launch: restart the web process with stdout/stderr redirected to `$DSH_HOME/logs/` (captures startup errors). |
| `scripts/patch-web-settings.ps1` | Pre-rc.7 only: add `memory` to the `dsh-host-apiproxy` Web settings allowlist (obsolete since rc.7 removed the allowlist). |
| `scripts/mcp-smoke.mjs` | Standalone MCP server smoke test (version, tool count, add/search round-trip). |

## Web settings page

The plugin ships a Web client bundle that registers the configuration form for its own row on the **Plugins page** (Settings → Plugins → Plugin config) — no extra step beyond the deploy sync. The form edits **every** live-editable config field through the Host settings seam, which the plugin's own same-origin endpoint (`/_dsh/memory/settings`, registered by the host half) mirrors for programmatic readers. Copy is localized (English/Chinese) and follows DSH's language setting; `embeddingApiKey` is a write-only secret (see below), and `memoryDir` changes require a DSH restart.

**Supported DSH lines: 0.1.7 and 0.2.x.** 0.1.7-rc.1 replaced the settings provider with `SettingsForms`, made the loader-row config the settings document, and generates forms only for `meta.volatile` fields; the form is the configuration of this bundle's own loader row (`dsh-memory`), registered into the keyed `plugins.row.config` slot and gated by `configForms.whileServed`. Verified live on **0.1.7-rc.1**, **0.2.0-rc.1**, **0.2.0-rc.2** and **0.2.2-rc.1**: all 14 tools registered, the settings endpoint working, a write → summarize → consolidate round-trip with zero errors, and the peer gate re-evaluated with `includePrerelease` on rc.2. The **0.1.5 line is no longer supported** as of 0.5.0 — its provider-side `settings.register('memory', …)` seam and the standalone card that rendered into `settings.plugin.item` both went away with it, and `peerDependencies` are now `dsh-llm` / `dsh-settings` / `dsh-tools` `^0.1.7-rc.1 || ^0.2.0-rc.1` (plus `cordis` `^4.0.1`, `schemastery` `^3.18.0`). Deployments still on 0.1.5 must stay on 0.4.x.

## Automatic memory & the auto-memory skill

Two complementary layers keep memory current without manual tool calls:

1. **Host pipeline (automatic)** — every finished turn of a root agent is
   distilled into a rollout summary (debounced via `summarizeDebounceMs`),
   and summaries are periodically re-consolidated into the injected global
   summary. The summarization model resolves through
   `summarizeProvider/summarizeModel`, then the selected agent model, then
   the `agent-default-model` settings namespace. `memory_stats` reports
   `summarizeSkipCounts` / `lastSummarizeSkip` so skipped distillations are
   observable. Since 0.2.3 the distillation reads both `user/message` and
   `assistant/message` text (assistant replies were previously dropped),
   user settings apply at boot (not only after the first live edit), and
   the internal distill/consolidate LLM calls run with reasoning off so
   they cannot hit the output-token cap. End-to-end verified 2026-08-16:
   turn → rollout file → consolidation bumped the global summary v1 → v2.
2. **auto-memory skill (agent-driven)** — the plugin registers a runtime
   skill that instructs agents to proactively recognize key facts
   (preferences, decisions, conventions, fixes, facts), write them with
   `memory_add` (tags + dedup), query memory with `memory_search` /
   `memory_read` when a task depends on history, and correct stale entries.
   The skill appears in every session's skill catalog after restart.

## Scope

Memory is stored in three scopes:

- `global` — shared by all sessions (the Codex-style default);
- `workspace` — per working directory (`ws-<hash>`), active when `scopedMemory: true`;
- `project` — per nearest git root (`project-<hash>`), active when `scopedMemory: true`.

Tools accept a `scope` argument (`global` | `workspace` | `project`); the project scope resolves the session's `cwd`. Write access can be restricted per scope via `readOnlyScopes`.

## Development & testing

`npm test` runs 101 tests (node:test):

- `test/store.test.js` — store semantics, journal, history, archiving, scopes, and `redactForStorage` (secrets are scrubbed before persisting, and the switch can be turned off);
- `test/automation.test.js` — the auto-memory skill definition, the model-route fallback chain (including the `describe()`-based read on DSH 0.1.7), `extractMessageText` (user/assistant event shapes), the bounded tool-activity digest (`formatToolCall`/`formatToolResult`), the subagent and compaction excerpt formatters, the token estimator/bounder used by the injection budget, and the pure helpers behind the new reliability paths (`budgetState`, `rolloutWindowState`, `nextRetryDelay`, `summaryTargetBytes`, `summaryTargetChars`);
- `test/browser.test.js` — the interactive HTML browser snapshot rendering;
- `test/web-settings.test.js` — the settings endpoint lifecycle (GET/POST, 403/409, body limits, secret redaction), resolution of the loader-row namespace, and a VM-sandbox load of the client bundle asserting the `plugins.row.config` form registration and that the removed 0.1.5 card is gone;
- `test/volatile.test.js` — the DSH 0.1.7 volatile seam: marking a schema field live-editable only where the schema library supports it, recognizing a cosmokit Volatile box by its globally registered write hook, and reading a whole resolved config back as plain values;
- `test/embedding.integration.test.js` — fake `/embeddings` server + local hashed vectors;
- `test/mcp.integration.test.js` — real MCP child-process round-trips;
- `test/host-wiring.test.js` — guards the harness-facing surface of `lib/index.js`: bare-string settings namespace, the removed `settingsNamespace` helper absent, the Surface layer (`snapshotEvents`) instead of `Session.events`, the `llm` service waited for via `inject(['llm'])` instead of a boot-time `ctx.get`, the `settings.mutate` save path (no whole-section `replace`) with a consolidation token floor, the volatile config marking plus the `loader/volatile-update` mirror, the 14-tool list, `agent/turn-stopping`, the `systemPrompt.context` hook, the auto-memory skill, storage redaction on all three write paths, the bounded retry policy and disposable deferred timers, the injected-bytes/budget/rollout-window observability fields, the over-target prune pass (a second bounded LLM call whose output must be validated and re-bounded before it can replace the merge, with a character budget in both prompts and the `lastPrune` effect surfaced), plus two `apply()` smokes through a fake cordis ctx (the 0.1.5 provider with `register()`, and the 0.1.7 service without it whose boxed config is unboxed and re-read on a volatile commit), each asserting a sub-floor `consolidateMaxTokens` is lifted and reported (skipped in a zero-dependency CI).

The architecture and mechanism notes live in [`docs/DESIGN.md`](docs/DESIGN.md); deployment status in [`docs/STATUS.md`](docs/STATUS.md).

## License

MIT
