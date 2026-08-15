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

Current release: **0.2.1** — see [CHANGELOG.md](CHANGELOG.md) for the release history.

## Install

The one-command path is `scripts/sync-install.ps1` (see [Deploy / update](#deploy--update)); the manual path is below. Either way, restart DeepSeek Harness afterwards.

1. Put the package under the profile's external plugins:

   ```powershell
   Copy-Item -Recurse E:\git\github\dsh-Plugin "$env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-external\dsh-memory"
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
| `consolidateEvery` | `3` | Rollout summaries written before re-consolidating the global summary. |
| `summaryMaxTokens` | `600` | Max output tokens for turn summarization. |
| `consolidateMaxTokens` | `1500` | Max output tokens for summary consolidation. |
| `llmRetries` | `1` | Retries after a transient LLM failure. |
| `maxActiveSummaries` | `4` | Maximum concurrent turn summarizations before new jobs are dropped. |
| `scopedMemory` | `false` | Enable per-workspace memory scopes. |
| `redactSecrets` | `true` | Redact credential-looking text from injected summaries. |
| `readOnlyScopes` | `[]` | Scope keys whose write tools are blocked (`global`, exact `ws-*`/`project-*` keys, or `*` for all). |
| `embeddingBaseURL` / `embeddingApiKey` / `embeddingModel` | empty | OpenAI-compatible `/embeddings` endpoint for `vector:true`; empty uses local hashed vectors. |
| `scopeMaxBytes` | `2400` | Injected byte budget for the workspace summary when scopedMemory is enabled. |
| `seedFromAgentsMd` | `true` | Seed the first summary from `$DSH_HOME/AGENTS.md`. |

The Web settings card (see below) edits `maxBytes`, `consolidateEvery`, `autoSummarize`, and `seedFromAgentsMd` live; all other keys are configured through the loader row or the `memory:` section of `settings.yaml`.

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
| `scripts/verify-after-restart.ps1` | Post-restart verification: file hashes, the Web settings allowlist, and an installed-copy MCP smoke test (`-SkipMcpSmoke`, `-SkipWebSettingsCheck`). |
| `scripts/restart-dsh.ps1` | Stop and relaunch the DSH web process, then run the verification (`-WhatIf` first; closes the running session). |
| `scripts/patch-web-settings.ps1` | Optional: add `memory` to the `dsh-host-apiproxy` Web settings allowlist (idempotent, backup + syntax check + rollback). |
| `scripts/mcp-smoke.mjs` | Standalone MCP server smoke test (version, tool count, add/search round-trip). |

## Web settings page

The plugin ships a Web client bundle that registers a "Memory (dsh-memory)" card on the plugin configuration page (Settings → Plugins → Plugin config) automatically — no extra step is required beyond the deploy sync. The card edits `maxBytes`, `consolidateEvery`, `autoSummarize`, and `seedFromAgentsMd` through the plugin's own same-origin endpoint (`/_dsh/memory/settings`, registered by the host half).

Optionally, the `memory` namespace can also be exposed to the generic Web settings API (whose allowlist lives in the `dsh-host-apiproxy` package, one level above plugins):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/patch-web-settings.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File scripts/patch-web-settings.ps1
```

The patch is idempotent, backs up the target, and re-checks syntax. `scripts/verify-after-restart.ps1` checks the deployed plugin files, the client bundle, and this allowlist. The card was verified end-to-end on this deployment (2026-08-15): edit → save → "Settings saved and applied." → the `memory:` section persisted in `settings.yaml` (changes apply live).

## Scope

Memory is stored in three scopes:

- `global` — shared by all sessions (the Codex-style default);
- `workspace` — per working directory (`ws-<hash>`), active when `scopedMemory: true`;
- `project` — per nearest git root (`project-<hash>`), active when `scopedMemory: true`.

Tools accept a `scope` argument (`global` | `workspace` | `project`); the project scope resolves the session's `cwd`. Write access can be restricted per scope via `readOnlyScopes`.

## Development & testing

`npm test` runs 49 tests (node:test):

- `test/store.test.js` — store semantics, journal, history, archiving, scopes;
- `test/browser.test.js` — the interactive HTML browser snapshot rendering;
- `test/web-settings.test.js` — the settings endpoint lifecycle (GET/POST, 403/409, body limits) plus a VM-sandbox load of the client bundle asserting the `settings.plugin.item` card registration;
- `test/embedding.integration.test.js` — fake `/embeddings` server + local hashed vectors;
- `test/mcp.integration.test.js` — real MCP child-process round-trips.

The architecture and mechanism notes live in [`docs/DESIGN.md`](docs/DESIGN.md); deployment status in [`docs/STATUS.md`](docs/STATUS.md).

## License

MIT
