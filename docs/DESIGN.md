# dsh-memory 设计文档

## 目标

复刻 Codex 记忆体系的行为：跨会话持久化、自动注入提示词、工具化读写、每轮对话自动蒸馏（rollout summary）并定期合并（consolidation），全部落在用户可读、可编辑的 Markdown 文件上。

## 机制对照

| Codex | dsh-memory |
| --- | --- |
| `~/.codex/memories/memory_summary.md` | `$DSH_HOME/memories/memory_summary.md` |
| `~/.codex/memories/raw_memories.md` | `$DSH_HOME/memories/raw_memories.md` |
| `~/.codex/memories/rollout_summaries/` | `$DSH_HOME/memories/rollout_summaries/<sessionId>.md` |
| rollout 结束时 LLM 蒸馏 | `agent/turn-stopping` 时调度异步蒸馏（仅根代理） |
| 定期把 raw + rollout 合并进 summary | `consolidateEvery` 份 rollout 后 LLM 重新合并，`vN` 版本号递增 |

## 关键接口（实现依据）

- **注入**：`systemPrompt.context({ name, order, text: () => string })` —— `@deepseek-ai/dsh-system-prompt` 的动态上下文，每次 `assemble()` 重新求值；渲染为 "Current runtime context"。`order: 2000` 排在运行时上下文之后。文件读取用 `readFileSync`（同步 provider，约 8KB 可忽略）。
- **工具**：`tools.register(ToolDefinition)`，`ToolDefinition = ToolSchema + { output: { schema, render }, execute(args, exec) }`（`@deepseek-ai/dsh-tools`）。`output.schema` 是 JSON Schema；`render` 返回 `ContentBlock[]`；`execute` 返回 lossless JSON。
- **事件**：`agent/turn-stopping`（serial，payload `{ agent, turn, signal }`）——处理器只做调度（防抖 + 入队），立即返回，不阻塞轮次关闭。
- **LLM**：`llm.stream({ provider, model, messages, system, maxTokens, sessionId, signal })` + `BlockAssembler`（模式取自 `dsh-session-title-llm`）。默认路由：`agentDefaultModel.currentSelection()`，可被 `summarizeProvider/summarizeModel` 覆盖。
- **配置**：`settings.register(settingsNamespace('memory'), Config, { base: config, applies: 'live' })`（模式取自 `dsh-vision-toolkit`）；`scope.watch()` 使 `maxBytes` 等变更即时生效。
- **根代理判定**：`session.header.parentSession === undefined && session.header.origin !== 'subagent'`（`@deepseek-ai/dsh-session`）。

## 数据格式

`raw_memories.md`（追加式，工具解析/重写）：

```markdown
# Raw memories

### 2026-08-13 10:30
**id:** mem-1a2b3c4d
**tags:** project, preference

用户偏好：回复使用简体中文。
```

`journal.jsonl`（追加式变更日志，合并游标消费；v0.1.0 的旧 raw 条目在启动时自动回填为 `add` 事件）：

```json
{"seq":1,"op":"add","id":"mem-1a2b3c4d","ts":"2026-08-13 10:30","entry":{"id":"mem-1a2b3c4d","ts":"2026-08-13 10:30","tags":["project","preference"],"content":"用户偏好：回复使用简体中文。"}}
```

`memory_summary.md`（注入体，`vN` 版本行）：

```markdown
# DSH memory

Maintained by the dsh-memory plugin. ...

v3

## User Profile
...
## Project Knowledge
...
```

`summary_history/<version>.<timestamp>.md`：每次合并或回滚前归档当前摘要，按 `keepSummaryVersions` 保留最近版本。

## 并发与一致性

- 所有文件写入经 `MemoryStore.withLock` 进程内互斥（promise 链），工具写入与摘要追加串行化；跨进程用 `.memory.lock`（60s stale 检测），非持锁实例进入只读；摘要任务按 `maxActiveSummaries` 限流，超限丢弃。
- summary 与 raw 重写均为「临时文件 + rename」原子写，崩溃不留半截文件；journal 为追加式 JSONL，损坏行会被跳过；
- 合并只消费「新 rollout 块 + 游标之后的 journal 事件」，游标在 summary 写入成功后推进，重复消费与半截消费都有边界；
- 合并输出先严格校验（`# DSH memory`、独立 `vN`、至少一个 `##` 节），畸形输出拒绝写入并保留旧版；截断按完整行且不留下未闭合代码围栏；
- 写入新摘要前把当前版本归档到 `summary_history/`，`memory_rollback` 可恢复任意保留版本。
- 活动 raw 文件超过 `rawArchiveMaxBytes` 时，最旧条目写入 `archive/raw-YYYY-MM.md`；搜索默认合并活动与归档条目。
- 注入读取失败（文件不存在）返回空串，插件不影响会话正常组装。

## 失败模式

- 模型不可用 / 未配置 → `resolveRoute()` 返回 undefined，自动摘要跳过并告警一次；工具与注入不受影响；
- LLM 超时/瞬时失败 → 每调用 `llmRetries`（默认 1）次重试，单次 60s 超时；结构化日志记录 provider/model/耗时/usage，`memory_stats` 汇总调用数与失败数；
- 摘要/合并的 LLM 调用本身不触发记忆写入（非代理轮次，无递归风险）；
- 插件停止/更新 → `ctx.effect` 清理 + 各注册的 disposer 全部释放，无全局残留。
- `AGENTS.md` 重同步：state 记录源与种子摘要指纹，`memory_sync` 只在「源变化且摘要未被手改」时导入，双方都变化则报告冲突。

## 已知限制与扩展方向

- 作用域：`scopedMemory` 开启后按 `session.header.cwd` 派生 `ws-<hash>` 工作区库（`scopes/` 目录）；`scope:'project'` 取会话 cwd 的最近 `.git` 根派生 `project-<hash>`；工具、注入（global + workspace 预算拆分）与每作用域 rollout/合并均按路由作用域工作。根目录是 canonical global 作用域，旧数据无需迁移。
- 搜索为关键词子串匹配；向量检索（embeddings）留作 v2；
- 摘要去重依赖 LLM 合并提示；条目级去重（按内容哈希）留作 v2。

详细的分级优化清单、验收标准与里程碑见 [`ROADMAP.md`](ROADMAP.md)。
