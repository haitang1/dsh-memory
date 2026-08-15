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
└── state.json                  version + journal/rollout cursor bookkeeping
```

- **Injection** — `systemPrompt.context` re-reads `memory_summary.md` at every prompt assembly, so a `memory_add` call surfaces in the very next model step.
- **Tools** — `memory_read`, `memory_add`, `memory_update`, `memory_delete`, `memory_search`, `memory_stats`, `memory_rollback`, `memory_sync` (see below).
- **Auto memory** — on each finished turn of a root agent, the new conversation text is distilled with the default model into a rollout summary. Every `consolidateEvery` summaries, the global summary is re-merged (atomic write, version bump). All LLM work is queued, timed out, and never blocks a turn.
- **Seeding** — on first run the plugin seeds the summary from `$DSH_HOME/AGENTS.md` (the Codex-synced global memory) without modifying it.

## Install

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
| `autoSummarize` | `true` | Distill finished turns into rollout summaries. |
| `summarizeProvider` / `summarizeModel` | selected agent model | Model used for summarization. |
| `consolidateEvery` | `3` | Rollout summaries written before re-consolidating the global summary. |
| `seedFromAgentsMd` | `true` | Seed the first summary from `$DSH_HOME/AGENTS.md`. |

## Tools

| Tool | Purpose |
| --- | --- |
| `memory_read` | Read the current global memory summary. |
| `memory_add { content, tags? }` | Store one durable fact; returns the entry id. |
| `memory_update { id, content?, tags? }` | Replace an entry's content/tags. |
| `memory_delete { id }` | Remove an entry. |
| `memory_search { query, tags?, mode?, limit? }` | Ranked multi-keyword search with optional tag filtering. |
| `memory_stats {}` | Report memory store health (sizes, versions, cursors, background work). |
| `memory_rollback { version }` | Restore a previously retained summary version. |
| `memory_sync {}` | Re-import AGENTS.md when it changed; reports a conflict instead of overwriting manual summary edits. |

## Scope

v1 memory is global and shared by all sessions (like Codex). Project-scoped memory is a planned extension.

## License

MIT
