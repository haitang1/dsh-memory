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
├── scopes/project-<hash>/...    按 git 根隔离的项目记忆库（开启 scopedMemory 后）
└── state.json                  版本 + journal/rollout 游标进度
```

- **注入** —— 通过 `systemPrompt.context` 在每次提示词组装时重读 `memory_summary.md`，因此 `memory_add` 写入后下一步立即生效。
- **工具** —— `memory_read` / `memory_add` / `memory_update` / `memory_delete` / `memory_search` / `memory_review` / `memory_merge` / `memory_export` / `memory_import` / `memory_stats` / `memory_browse` / `memory_history` / `memory_rollback` / `memory_sync`（见下表）。
- **自动记忆** —— 根代理每轮结束后，用默认模型把新增对话蒸馏成 rollout 摘要；累计 `consolidateEvery` 份后重新合并对应作用域摘要（原子写入、版本号递增）。开启 `scopedMemory` 后，rollout 与合并按会话的工作区或项目作用域路由。所有 LLM 调用带超时，绝不阻塞轮次。
- **种子导入** —— 首次运行时从 `$DSH_HOME/AGENTS.md`（Codex 同步的全局记忆）导入初始摘要，不修改原文件。

当前版本：**0.2.5** —— 发布历史见 [CHANGELOG.md](CHANGELOG.md)。

## 安装

一键路径使用 `scripts/sync-install.ps1`（见下文「部署 / 更新」）；手动路径如下。两种方式之后都需要重启 DeepSeek Harness。

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
| `summarizeDebounceMs` | `300000` | 同一会话两次蒸馏的最小间隔（0 = 关闭防抖）。 |
| `consolidateEvery` | `3` | 累计多少份 rollout 摘要后重新合并全局摘要。 |
| `summaryMaxTokens` | `1500` | 单轮摘要 LLM 的最大输出 token。 |
| `consolidateMaxTokens` | `3000` | 摘要合并 LLM 的最大输出 token。 |
| `llmRetries` | `1` | LLM 瞬时失败后的重试次数。 |
| `maxActiveSummaries` | `4` | 同时进行的轮次摘要上限，超出后丢弃新任务。 |
| `scopedMemory` | `false` | 开启按工作区隔离的记忆作用域。 |
| `redactSecrets` | `true` | 注入前对疑似凭据文本做脱敏。 |
| `readOnlyScopes` | `[]` | 禁止写入工具的作用域键（`global`、精确 `ws-*`/`project-*`，或 `*` 表示全部）。 |
| `embeddingBaseURL` / `embeddingApiKey` / `embeddingModel` | 空 | `vector:true` 时可选的 OpenAI 兼容 `/embeddings` 端点；为空则使用本地哈希向量。 |
| `scopeMaxBytes` | `2400` | scopedMemory 开启时工作区摘要的注入字节预算。 |
| `seedFromAgentsMd` | `true` | 是否用 `$DSH_HOME/AGENTS.md` 导入初始摘要。 |

Web 设置页卡片（见下文）可在线编辑 `maxBytes`、`consolidateEvery`、`autoSummarize`、`seedFromAgentsMd`；其余键通过 loader 配置或 `settings.yaml` 的 `memory:` 段配置。

## 工具

| 工具 | 用途 |
| --- | --- |
| `memory_read { scope? }` | 读取全局、工作区或项目（最近 git 根）记忆摘要。 |
| `memory_add { content, tags?, scope?, importance?, allowDuplicate?, allowSecret? }` | 存储事实；明显凭据默认拒绝（除非 `allowSecret:true`），`importance` 0-3 影响排序，默认拒绝重复事实。 |
| `memory_update { id, content?, tags?, importance?, scope? }` | 在指定作用域替换条目的内容/标签/重要性。 |
| `memory_delete { id, scope? }` | 从指定作用域删除条目。 |
| `memory_search { query, tags?, mode?, fuzzy?, vector?, limit?, scope? }` | BM25 搜索 + 可选本地哈希向量余弦检索（`vector:true`），为缺失查询词召回候选。 |
| `memory_stats {}` | 报告全局 + 各作用域库存、游标、历史、LLM 计数与最近错误。 |
| `memory_history { scope? }` | 列出保留的摘要版本（新→旧）供 `memory_rollback` 使用。 |
| `memory_browse { targetDir, overwrite? }` | 导出全作用域的自包含交互式 HTML 记忆浏览器。 |
| `memory_rollback { version }` | 回滚到之前保留的摘要版本。 |
| `memory_sync {}` | AGENTS.md 变化时重新导入；若摘要也被手改则报告冲突而不覆盖。 |
| `memory_export { targetDir, scope?, overwrite? }` | 导出作用域为 Codex 兼容的 `memory_summary.md` + `raw_memories.md`。 |
| `memory_import { sourceDir, scope?, merge? }` | 从 Codex 兼容的 `raw_memories.md` 导入条目（追加或替换）。 |
| `memory_review { scope?, limit?, olderThanDays? }` | 列出最旧条目与近重复组供复核；绝不自动删除。 |
| `memory_merge { ids, keepId?, scope? }` | 合并活动条目：保留最长内容、标签并集、最高重要性。 |



## 独立 MCP 服务器

`bin/dsh-memory-mcp.mjs` 通过 stdio JSON-RPC（MCP）暴露同一套 Markdown 记忆库，不依赖 DeepSeek Harness 运行时。环境变量：`DSH_MEMORY_DIR`（默认 `~/.dsh/memories`）、`DSH_MEMORY_REDACT=1`（默认）。作用域参数：`global`（默认）、`workspace`/`project`（需 `cwd`）。

提供 9 个工具，存储语义与 DSH 工具一致：`memory_read`、`memory_add`、`memory_update`、`memory_delete`、`memory_search`、`memory_stats`、`memory_history`、`memory_merge`、`memory_review`。客户端配置示例见 [`examples/mcp-config.json`](examples/mcp-config.json)。



## 部署 / 更新

`scripts/sync-install.ps1` 把运行时文件复制到 DSH profile 外部插件目录并校验 SHA-256；不触碰记忆数据、不重启 DSH，同步后需重启。用法：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-install.ps1 -DryRun
powershell -ExecutionPolicy Bypass -File scripts/sync-install.ps1 -Backup
```

### 脚本

| 脚本 | 用途 |
| --- | --- |
| `scripts/sync-install.ps1` | 把运行时 + 元数据文件复制到 profile 外部插件目录并校验 SHA-256（`-DryRun` 预览，`-Backup` 写入前快照）。 |
| `scripts/verify-after-restart.ps1` | 重启后校验：文件哈希、Web 设置白名单（rc.7 起自动识别已移除）、安装副本 MCP 冒烟（`-SkipMcpSmoke`、`-SkipWebSettingsCheck`）。 |
| `scripts/restart-dsh.ps1` | 停掉并重新拉起 DSH web 进程，随后运行校验（先 `-WhatIf`；会关闭当前会话）。 |
| `scripts/start-dsh-logged.ps1` | 诊断启动：重启 DSH 并把 stdout/stderr 重定向到 `$DSH_HOME/logs/`（抓取启动错误）。 |
| `scripts/patch-web-settings.ps1` | 仅 rc.7 之前版本：把 `memory` 加入 `dsh-host-apiproxy` 的 Web 设置白名单（rc.7 已移除白名单，脚本不再适用）。 |
| `scripts/mcp-smoke.mjs` | 独立 MCP server 冒烟（版本、工具数、add/search 往返）。 |

## Web 设置页

插件自带 Web 客户端 bundle，会自动在插件配置页（设置 → 插件 → 插件配置）注册「记忆 (dsh-memory)」卡片，无需额外步骤。卡片可编辑 `maxBytes`、`consolidateEvery`、`autoSummarize`、`seedFromAgentsMd`，通过插件自己的同源端点（`/_dsh/memory/settings`，由 host 半部分注册）读写配置。卡片文案为中英双语，跟随 DSH 的语言设置自动切换。

自 DSH **0.1.0-rc.7** 起：`settings.plugin.item` 改为 keyed 槽位，插件配置页按**设置命名空间**派发卡片 —— 卡片以 `key: 'memory'` 注册（即插件自己的设置命名空间）；同时 rc.7 移除了 `dsh-host-apiproxy` 的硬编码设置白名单（`WEB_SETTINGS_NAMESPACES`），通用 Web 设置 API 直接服务全部已注册命名空间，因此旧版 `patch-web-settings.ps1` 已不适用。

## 自动记忆与 auto-memory 技能

记忆的持续更新由两层互补机制保证（都不需要手动调用工具）：

1. **宿主管线（全自动）** —— 根代理每轮结束后自动把该轮对话蒸馏为 rollout 摘要（由 `summarizeDebounceMs` 防抖），并定期合并进注入的全局摘要。摘要模型按 `summarizeProvider`/`summarizeModel` → 当前选择的代理模型 → `agent-default-model` 设置命名空间的顺序解析；`memory_stats` 会报告 `summarizeSkipCounts` / `lastSummarizeSkip`，被跳过的蒸馏可观测。自 0.2.3 起蒸馏同时读取 `user/message` 与 `assistant/message` 文本（此前助手回复被静默丢弃）、用户设置启动即生效（而非首次在线编辑后才生效）、内部蒸馏/合并调用关闭推理（避免撞输出上限）。已于 2026-08-16 端到端实测：回合 → rollout 文件 → 合并，全局摘要 v1 → v2。
2. **auto-memory 技能（代理主动）** —— 插件注册一个运行时技能，指导代理主动识别关键信息（偏好、决策、约定、修复、事实），用 `memory_add` 写入（带 tags 与去重），在任务依赖历史时用 `memory_search` / `memory_read` 主动检索，并修正过时条目。重启后该技能会出现在每个会话的技能目录中。

## 范围

记忆存储于三个作用域：

- `global` —— 所有会话共享（类 Codex 的默认）；
- `workspace` —— 按工作目录隔离（`ws-<hash>`），`scopedMemory: true` 时启用；
- `project` —— 按最近 git 根隔离（`project-<hash>`），`scopedMemory: true` 时启用。

工具接受 `scope` 参数（`global` | `workspace` | `project`）；项目作用域解析会话的 `cwd`。各作用域的写权限可用 `readOnlyScopes` 限制。

## 开发与测试

`npm test` 运行 59 项测试（node:test）：

- `test/store.test.js` —— 存储语义、journal、历史、归档、作用域；
- `test/automation.test.js` —— auto-memory 技能定义、模型路由回退链、`extractMessageText`（user/assistant 事件结构）；
- `test/browser.test.js` —— 交互式 HTML 浏览器的快照渲染；
- `test/web-settings.test.js` —— 设置端点生命周期（GET/POST、403/409、体积限制），以及 VM 沙箱加载客户端 bundle 断言 `settings.plugin.item` 卡片注册；
- `test/embedding.integration.test.js` —— fake `/embeddings` 服务 + 本地哈希向量；
- `test/mcp.integration.test.js` —— 真实 MCP 子进程往返。

架构与机制说明见 [`docs/DESIGN.md`](docs/DESIGN.md)；部署状态见 [`docs/STATUS.md`](docs/STATUS.md)。

## License

MIT
