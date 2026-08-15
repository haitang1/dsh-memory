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
└── state.json                  版本 + journal/rollout 游标进度
```

- **注入** —— 通过 `systemPrompt.context` 在每次提示词组装时重读 `memory_summary.md`，因此 `memory_add` 写入后下一步立即生效。
- **工具** —— `memory_read` / `memory_add` / `memory_update` / `memory_delete` / `memory_search` / `memory_stats` / `memory_rollback`（见下表）。
- **自动记忆** —— 根代理每轮结束后，用默认模型把新增对话蒸馏成 rollout 摘要；累计 `consolidateEvery` 份后，重新合并全局摘要（原子写入、版本号递增）。所有 LLM 调用走私有串行队列、带超时，绝不阻塞轮次。
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
| `autoSummarize` | `true` | 是否把结束的轮次蒸馏成 rollout 摘要。 |
| `summarizeProvider` / `summarizeModel` | 当前选择的模型 | 摘要使用的模型。 |
| `consolidateEvery` | `3` | 累计多少份 rollout 摘要后重新合并全局摘要。 |
| `seedFromAgentsMd` | `true` | 是否用 `$DSH_HOME/AGENTS.md` 导入初始摘要。 |

## 工具

| 工具 | 用途 |
| --- | --- |
| `memory_read` | 读取当前全局记忆摘要。 |
| `memory_add { content, tags? }` | 存储一条持久事实，返回条目 id。 |
| `memory_update { id, content?, tags? }` | 替换条目的内容/标签。 |
| `memory_delete { id }` | 删除条目。 |
| `memory_search { query, tags?, mode?, limit? }` | 多关键词相关性搜索，支持标签过滤。 |
| `memory_stats {}` | 报告记忆库健康度（大小、版本、游标、后台任务）。 |
| `memory_rollback { version }` | 回滚到之前保留的摘要版本。 |

## 范围

v1 记忆为全局共享（所有会话可见，与 Codex 一致）；项目级作用域记忆留作后续扩展。

## License

MIT
