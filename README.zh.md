# dsh-memory

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的类 Codex 记忆插件。每个会话都拥有一份持久化、自动注入的记忆：蒸馏后的全局记忆摘要随每次提示词注入；智能体通过专用工具读写、搜索记忆；每轮对话结束后自动蒸馏为会话级 rollout 摘要，并定期重新合并进全局记忆文件。

## 工作原理

```
$DSH_HOME/memories/
├── memory_summary.md           蒸馏版、带版本号、有字节上限的全局记忆 —— 注入每个提示词
├── raw_memories.md             工具写入的追加式原始条目（带日期）
├── rollout_summaries/<sid>.md  每会话的轮次摘要（自动）
├── journal.jsonl               变更日志（合并游标消费）
├── summary_history/<v>.<ts>.md 保留的摘要历史版本（可回滚）
├── archive/raw-YYYY-MM.md      超出字节预算后被归档的旧 raw 条目
├── scopes/ws-<hash>/...         按工作区隔离的记忆库（开启 scopedMemory 后）
└── state.json                  版本 + journal/rollout 游标进度
```

- **注入** —— 通过 `systemPrompt.context` 在每次提示词组装时重读 `memory_summary.md`，因此 `memory_add` 写入后下一步立即生效。
- **工具** —— `memory_read` / `memory_add` / `memory_update` / `memory_delete` / `memory_search` / `memory_review` / `memory_merge` / `memory_export` / `memory_import` / `memory_stats` / `memory_history` / `memory_rollback` / `memory_sync`（见下表）。
- **自动记忆** —— 根代理每轮结束后，用默认模型把新增对话蒸馏成 rollout 摘要；累计 `consolidateEvery` 份后重新合并对应作用域摘要（原子写入、版本号递增）。开启 `scopedMemory` 后，rollout 与合并按会话工作区路由。所有 LLM 调用带超时，绝不阻塞轮次。
- **种子导入** —— 首次运行时从 `$DSH_HOME/AGENTS.md`（Codex 同步的全局记忆）导入初始摘要，不修改原文件。

## 安装

1. 将包复制到 profile 的外部插件目录：

   ```powershell
   Copy-Item -Recurse E:\git\github\dsh-Plugin "$env:USERPROFILE\.dsh\profiles\web\node_modules\@dsh-external\dsh-memory"
   ```

2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 中追加 loader 行（必须是 `insert` 条目——独立的 `- id:` 行只用于覆盖已存在的 bundle 条目，不会挂载新插件）：

   ```yaml
   - insert:
       - id: dsh-memory
         name: '@dsh-external/dsh-memory'
         config:
           maxBytes: 8000
           autoSummarize: true
   ```

3. 重启 DeepSeek Harness。插件以 `dsh-memory` 挂载，设置命名空间为 `memory`。

## 配置

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `memoryDir` | `$DSH_HOME/memories` | 记忆目录（空 = 默认）。 |
| `maxBytes` | `8000` | 注入摘要的字节上限。 |
| `consolidateMaxBytes` | `40000` | 合并模型输入的总字节预算。 |
| `keepSummaryVersions` | `20` | 保留的摘要历史版本数，供 `memory_rollback` 回滚（0 = 不保留）。 |
| `rawArchiveMaxBytes` | `200000` | 活动 raw 文件字节预算；超出后最旧条目移入 `archive/`。 |
| `autoSummarize` | `true` | 是否把结束的轮次蒸馏成 rollout 摘要。 |
| `summarizeProvider` / `summarizeModel` | 当前选择的模型 | 摘要使用的模型。 |
| `consolidateEvery` | `3` | 累计多少份 rollout 摘要后重新合并全局摘要。 |
| `summaryMaxTokens` | `600` | 单轮摘要 LLM 的最大输出 token。 |
| `consolidateMaxTokens` | `1500` | 摘要合并 LLM 的最大输出 token。 |
| `llmRetries` | `1` | LLM 瞬时失败后的重试次数。 |
| `maxActiveSummaries` | `4` | 同时进行的轮次摘要上限，超出后丢弃新任务。 |
| `scopedMemory` | `false` | 开启按工作区隔离的记忆作用域。 |
| `redactSecrets` | `true` | 注入前对疑似凭据文本做脱敏。 |
| `scopeMaxBytes` | `2400` | scopedMemory 开启时工作区摘要的注入字节预算。 |
| `seedFromAgentsMd` | `true` | 是否用 `$DSH_HOME/AGENTS.md` 导入初始摘要。 |

## 工具

| 工具 | 用途 |
| --- | --- |
| `memory_read { scope? }` | 读取全局、工作区或项目（最近 git 根）记忆摘要。 |
| `memory_add { content, tags?, scope?, importance?, allowDuplicate?, allowSecret? }` | 存储事实；明显凭据默认拒绝（除非 `allowSecret:true`），`importance` 0-3 影响排序，默认拒绝重复事实。 |
| `memory_update { id, content?, tags?, importance?, scope? }` | 在指定作用域替换条目的内容/标签/重要性。 |
| `memory_delete { id, scope? }` | 从指定作用域删除条目。 |
| `memory_search { query, tags?, mode?, fuzzy?, limit?, scope? }` | 在指定作用域（`global`/`workspace`/`project`）做 BM25 多关键词相关性搜索，支持标签过滤与零依赖拼写/CJK 模糊兜底。 |
| `memory_stats {}` | 报告全局 + 各作用域库存、游标、历史、LLM 计数与最近错误。 |
| `memory_history { scope? }` | 列出保留的摘要版本（新→旧）供 `memory_rollback` 使用。 |
| `memory_rollback { version }` | 回滚到之前保留的摘要版本。 |
| `memory_sync {}` | AGENTS.md 变化时重新导入；若摘要也被手改则报告冲突而不覆盖。 |
| `memory_export { targetDir, scope?, overwrite? }` | 导出作用域为 Codex 兼容的 `memory_summary.md` + `raw_memories.md`。 |
| `memory_import { sourceDir, scope?, merge? }` | 从 Codex 兼容的 `raw_memories.md` 导入条目（追加或替换）。 |
| `memory_review { scope?, limit?, olderThanDays? }` | 列出最旧条目与近重复组供复核；绝不自动删除。 |
| `memory_merge { ids, keepId?, scope? }` | 合并活动条目：保留最长内容、标签并集、最高重要性。 |

## 范围

v1 记忆为全局共享（所有会话可见，与 Codex 一致）；项目级作用域记忆留作后续扩展。

## License

MIT
