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
- **Auto memory** — on each finished turn of a root agent, the new conversation text is distilled with the default model into a rollout summary. Every `consolidateEvery` summaries, the scope's summary is re-merged (atomic write, version bump). With `scopedMemory`, rollouts and consolidation route to the session's workspace or project scope. All LLM work is queued, timed out, and never blocks a turn.
- **Seeding** — on first run the plugin seeds the summary from `$DSH_HOME/AGENTS.md` (the Codex-synced global memory) without modifying it.

Current release: **0.2.12** — see [CHANGELOG.md](CHANGELOG.md) for the release history.

## Install

The one-command path is `scripts/sync-install.ps1` (see [Deploy / update](#deploy--update)); the manual path is below. Either way, restart DeepSeek Harness afterwards.

1. Put the package under the profile's external plugins:

   ```powershell
   Copy-Item -Recurse ...\dsh-memory "$env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-external\dsh-memory"
   ```

2. Add a loader row to `~/.dsh/profiles/web/cordis.patch.yml` (must be an `insert` entry — a standalone `- id:` row only overrides existing bundle entries and will not mount the plugin):

   ```yaml
   - insert:
       - id: dsh-memory
         name: '@dsh-external/dsh-memory'
         config:
           maxBytes: 8000
           autoSummarize: true
   ```

3. Restart DeepSeek Harness. The plugin mounts as `dsh-memory`; its settings namespace is `memory`.

Alternatively, from GitHub on any platform (Linux/macOS included), install through the DSH CLI — it mounts the bundle automatically, no manual `cordis.patch.yml` row needed:

```bash
dsh plugin --profile web add 'github:haitang1/dsh-memory#f3c8de4'
```

Pinning a commit is recommended (`f3c8de4` is the `v0.2.7` release commit); omitting the `#<sha>` suffix installs the default branch. Restart DeepSeek Harness afterwards.

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `memoryDir` | `$DSH_HOME/memories` | Memory directory (empty = default). |
| `maxBytes` | `8000` | Byte budget of the injected summary. |
| `consolidateMaxBytes` | `40000` | Byte budget of the consolidation input sent to the merge model. |
| `keepSummaryVersions` | `20` | Previous summary versions retained for `memory_rollback` (0 disables history). |
| `rawArchiveMaxBytes` | `200000` | Active raw file byte budget; oldest entries move to `archive/` beyond it. |
| `autoSummarize` | `true` | Distill finished turns into rollout summaries. |
| `summarizeProvider` / `summarizeModel` | selected agent model | Model used for summarization. |
| `summarizeDebounceMs` | `300000` | Minimum interval between summarizations of the same session (0 disables the debounce). |
| `consolidateEvery` | `3` | Rollout summaries written before re-consolidating the global summary. |
| `summaryMaxTokens` | `1500` | Max output tokens for turn summarization. |
| `consolidateMaxTokens` | `8192` | Max output tokens for summary consolidation. Values below the floor a `maxBytes`-sized summary needs are lifted at runtime and reported in `memory_stats.configAlerts`. |
| `llmRetries` | `1` | Retries after a transient LLM failure. |
| `maxActiveSummaries` | `4` | Maximum concurrent turn summarizations before new jobs are dropped. |
| `scopedMemory` | `false` | Enable per-workspace memory scopes. |
| `redactSecrets` | `true` | Redact credential-looking text from injected summaries. |
| `readOnlyScopes` | `[]` | Scope keys whose write tools are blocked (`global`, exact `ws-*`/`project-*` keys, or `*` for all). |
| `embeddingBaseURL` / `embeddingApiKey` / `embeddingModel` | empty | OpenAI-compatible `/embeddings` endpoint for `vector:true`; empty uses local hashed vectors. |
| `scopeMaxBytes` | `2400` | Injected byte budget for the workspace summary when scopedMemory is enabled. |
| `seedFromAgentsMd` | `true` | Seed the first summary from `$DSH_HOME/AGENTS.md`. |

The Web settings card (see below) edits every config field live; keys are likewise overridable through the loader row or the `memory:` section of `settings.yaml`. Settings resolve as schema defaults → composition `base` → **user layer**, and the user layer wins, so the card persists **only the fields you changed** and a field saved back at its default drops its user-layer entry instead of pinning the default. See [Upgrade notes](#upgrade-notes).

## Upgrade notes

An upgraded plugin may change a config **default**, but a value already stored in the user layer outranks it (defaults → `base` → user). A value pinned by an older release therefore keeps overriding the new default — that is how a `consolidateMaxTokens` of `3000` (the pre-0.2.11 default) kept capping consolidation after 0.2.11 raised the default to `8192`, so every merge failed with `dsh-memory: LLM output reached max tokens` and the summary stopped advancing while the plugin still looked healthy.

Guards from **0.2.12** on:

- **Saving the card no longer pins defaults.** The card posts only the fields you changed, and setting a field back to its default removes the user-layer override rather than re-pinning it. The endpoint normalizes whichever payload it receives, so an older cached card cannot pin defaults either.
- **A too-small consolidation budget is lifted at runtime** to the floor a `maxBytes`-sized summary needs, and reported through `memory_stats.configAlerts` plus a log warning. Larger configured values are still honored.
- A truncation failure now names the key and its effective value instead of only `LLM output reached max tokens`.

To inspect the three layers in effect:

```sh
curl -s http://127.0.0.1:3080/_dsh/memory/settings   # settings.value / .base / .user / .defaults
```

To clear a stale override, edit it in the card, or delete the key from the `memory:` section of `$DSH_HOME/settings.yaml` — the settings provider hot-reloads the file, so no DSH restart is needed.

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

The plugin ships a Web client bundle that registers a "Memory (dsh-memory)" card on the plugin configuration page (Settings → Plugins → Plugin config) automatically — no extra step is required beyond the deploy sync. The card edits **every** config field (grouped into General / Auto-summarization & consolidation / Scopes / Security & embeddings) through the plugin's own same-origin endpoint (`/_dsh/memory/settings`, registered by the host half). The card copy is localized (English/Chinese) and follows DSH's language setting; `embeddingApiKey` is shown masked, and `memoryDir` changes require a DSH restart.

Since DSH **0.1.0-rc.7**, `settings.plugin.item` is a keyed slot and the plugin configuration tab dispatches cards by **settings namespace**: the card registers with `key: 'memory'` (the plugin's own settings namespace). rc.7 also removed the hard-coded `WEB_SETTINGS_NAMESPACES` allowlist from `dsh-host-apiproxy` — the generic Web settings API serves every registered namespace, so the legacy `patch-web-settings.ps1` no longer applies. This plugin is verified against DSH **0.1.2-rc.1** (the line that dropped the `settingsNamespace` helper, requires a bare-string settings namespace, and replaced `Session.events` with the Surface layer `snapshotEvents`/`deriveMessages`), and its `peerDependencies` are tightened to the `dsh-*` `^0.1.2-rc.1` / `cordis` `^4.0.1` line to match the harness it is validated against.

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

`npm test` runs 71 tests (node:test):

- `test/store.test.js` — store semantics, journal, history, archiving, scopes;
- `test/automation.test.js` — the auto-memory skill definition, the model-route fallback chain, and `extractMessageText` (user/assistant event shapes);
- `test/browser.test.js` — the interactive HTML browser snapshot rendering;
- `test/web-settings.test.js` — the settings endpoint lifecycle (GET/POST, 403/409, body limits) plus a VM-sandbox load of the client bundle asserting the `settings.plugin.item` card registration;
- `test/embedding.integration.test.js` — fake `/embeddings` server + local hashed vectors;
- `test/mcp.integration.test.js` — real MCP child-process round-trips;
- `test/host-wiring.test.js` — guards the harness-facing surface of `lib/index.js`: bare-string settings namespace, the removed `settingsNamespace` helper absent, the Surface layer (`snapshotEvents`) instead of `Session.events`, the `llm` service waited for via `inject(['llm'])` instead of a boot-time `ctx.get`, the `settings.mutate` save path (no whole-section `replace`) with a consolidation token floor, the 14-tool list, `agent/turn-stopping`, the `systemPrompt.context` hook, the auto-memory skill, plus an `apply()` smoke through a fake cordis ctx that also asserts a sub-floor `consolidateMaxTokens` is lifted and reported (skipped in a zero-dependency CI).

The architecture and mechanism notes live in [`docs/DESIGN.md`](docs/DESIGN.md); deployment status in [`docs/STATUS.md`](docs/STATUS.md).

## License

MIT
