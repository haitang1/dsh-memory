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
- **自动记忆** —— 根代理每轮结束后，用默认模型把新增对话（连同该轮工具活动的有界摘要、以及各子代理最终答复的摘录）蒸馏成 rollout 摘要；累计 `consolidateEvery` 份后重新合并对应作用域摘要（原子写入、版本号递增）。开启 `scopedMemory` 后，rollout 与合并按会话的工作区或项目作用域路由。所有 LLM 调用带超时，绝不阻塞轮次。
- **种子导入** —— 首次运行时从 `$DSH_HOME/AGENTS.md`（Codex 同步的全局记忆）导入初始摘要，不修改原文件。

当前版本：**0.5.7** —— 发布历史见 [CHANGELOG.md](CHANGELOG.md)。

## 安装

插件通过 GitHub 发布（release tag 与 commit sha）——**没有 npm 包**，`npm install @dsh-external/dsh-memory` 不是受支持的安装方式。下面两种方式之后都需要重启 DeepSeek Harness。

**推荐：用 DSH CLI 安装。** 它会把依赖写进 profile、用 pnpm 解析，并由 bundle patch 自动挂载插件行（无需手改 `cordis.patch.yml`）：

```bash
dsh plugin --profile <profile> add 'github:haitang1/dsh-memory#v0.5.7'
```

可钉 release tag（`#v0.5.7`）或 commit sha；不带后缀则安装默认分支。CLI 把参数转发给 pnpm，因此**升级**就是换新 ref 再执行一次同样的命令，**卸载**是：

```bash
dsh plugin --profile <profile> remove @dsh-external/dsh-memory
```

（`<profile>` 是 profile 目录名，如 `desktop` 或 `web`。）`$DSH_HOME/memories` 下的记忆文件不会被安装、升级或卸载改动。

**手动路径**（离线，或要直接跑工作区代码时）：

1. 将包复制到 profile 的外部插件目录：

   ```powershell
   Copy-Item -Recurse ...\dsh-memory "$env:USERPROFILE\.dsh\profiles\<profile>\node_modules\@dsh-external\dsh-memory"
   ```

2. 在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中追加 loader 行——必须是 `insert` 条目；独立的 `- id:` 行只用于覆盖已存在的 bundle 行，不会挂载新插件：

   ```yaml
   - insert:
       - id: dsh-memory
         name: '@dsh-external/dsh-memory'
         config:
           maxBytes: 24000
           autoSummarize: true
   ```

3. 重启 DeepSeek Harness。插件以 `dsh-memory` 挂载；它的设置表单就是「插件」页该行的配置。

已存在安装副本时，Windows 上可用 `scripts/sync-install.ps1 -SourceDir <repo> -TargetDir <install> -Backup` 完成第 1 步。

## 配置

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `memoryDir` | `$DSH_HOME/memories` | 记忆目录（空 = 默认）。 |
| `maxBytes` | `24000` | 注入摘要（以及摘要文件本身）的字节上限。 |
| `injectTokens` | `0` | 注入摘要的估算 token 上限；`0` 表示只按字节限制。中文约每字符 1 token，拉丁文约 1/4。 |
| `consolidateMaxBytes` | `40000` | 合并模型输入的总字节预算。 |
| `keepSummaryVersions` | `20` | 保留的摘要历史版本数，供 `memory_rollback` 回滚（0 = 不保留）。 |
| `rawArchiveMaxBytes` | `200000` | 活动 raw 文件字节预算；超出后最旧条目移入 `archive/`。 |
| `autoSummarize` | `true` | 是否把结束的轮次蒸馏成 rollout 摘要。 |
| `summarizeProvider` / `summarizeModel` | 当前选择的模型 | 摘要使用的模型。 |
| `summarizeDebounceMs` | `300000` | 同一会话两次蒸馏的最小间隔（0 = 关闭防抖）。 |
| `consolidateEvery` | `3` | 累计多少份 rollout 摘要后重新合并全局摘要。 |
| `summaryMaxTokens` | `1500` | 单轮摘要 LLM 的最大输出 token。 |
| `consolidateMaxTokens` | `12288` | 摘要合并 LLM 的最大输出 token。低于 `maxBytes` 规模摘要所需的底线时会在运行时被提升，并在 `memory_stats.configAlerts` 中上报。 |
| `llmRetries` | `1` | LLM 瞬时失败后的重试次数。 |
| `maxActiveSummaries` | `4` | 同时进行的轮次摘要上限，超出后丢弃新任务。 |
| `scopedMemory` | `false` | 开启按工作区隔离的记忆作用域。 |
| `captureSubagents` | `true` | 把每个子代理最终答复的有界摘录（2000 字符）记为一个 rollout 块。捕获只做一次文件追加，由周期性合并负责蒸馏，**不额外调用 LLM**。 |
| `redactSecrets` | `true` | 注入前对疑似凭据文本做脱敏。 |
| `readOnlyScopes` | `[]` | 禁止写入工具的作用域键（`global`、精确 `ws-*`/`project-*`，或 `*` 表示全部）。 |
| `embeddingBaseURL` / `embeddingApiKey` / `embeddingModel` | 空 | `vector:true` 时可选的 OpenAI 兼容 `/embeddings` 端点；为空则使用本地哈希向量。 |
| `scopeMaxBytes` | `2400` | scopedMemory 开启时工作区摘要的注入字节预算。 |
| `seedFromAgentsMd` | `true` | 是否用 `$DSH_HOME/AGENTS.md` 导入初始摘要。 |

Web 设置页表单（见下文）可在线编辑**全部配置项**；各键亦可通过 loader 配置或 `settings.yaml` 的 `memory:` 段覆盖。配置解析顺序为 schema 默认 → 组合 `base` → **user 层**，user 层优先级最高，因此卡片只持久化**你改动过的字段**；把字段改回默认值时会删除其 user 层条目，而不是把默认值写死。详见[升级须知](#升级须知)。

## 升级须知

**0.5.6 把 `maxBytes` 默认值从 16,000 提高到 24,000。** 0.5.4（字符）与 0.5.5（字符 + 5% 余量）两次尝试证明模型不会可靠遵守长度目标：merge 一直停在 16 KB 预算的 96–99%，prune 每轮都跑。更大的预算重新给出真正余量（当前约 16 KB 的摘要约占 66%），提示词里的目标仍作为 best-effort 提示保留；`consolidateMaxTokens` 从 `8192` 提到 `12288`，覆盖 24 KB 摘要所需的 token 底线、不产生 `configAlerts`。**user 层里保存过的 `maxBytes` 仍然优先**——要在卡片里清零/改写，或从 `$DSH_HOME/settings.yaml` 的 `memory:` 段删掉该键。

**0.5.5 给字符预算加 5% 余量。** 0.5.4 的「字节目标 / 3」是无余量的 CJK 上界，混入英文后 merge 仍会略超字节目标（实测 14,581 B vs 14,400 B），导致每次合并都触发 prune。现在 `summaryTargetChars` 对 16 KB 预算给出约 4,560 字符（≈13.7 KB 中文），让 merge 稳定落在 90% 以下，prune 只作为例外兜底；校验、硬上限与遥测均不变。

**0.5.4 让模型按「字符」而不是「字节」控制摘要长度。** 模型数不了字节，0.5.3 的字节目标仍让摘要停在预算 99%。现在两个提示词都给字符预算（`summaryTargetChars`：字节目标 / 3，按中文最坏情况换算）并附当前字符数；硬上限仍是 `maxBytes`，不会为了 90% 目标再截一次尾（避免切掉最新事实）。`memory_stats` 与 `diagnostics.json` 新增 `lastPrune { beforeBytes, afterBytes, targetBytes, targetChars }`，prune 效果可见。

**0.5.3 强制合并结果落回预算内。** 0.5.2 的提示词目标不够用：合并结果持续贴着 16 KB 上限被截断，最新事实可能被切掉。当合并结果仍超过预算 90% 时，会追加一次有界的 LLM 调用（`kind: 'prune'`）把摘要改写到目标大小；prune 输出畸形/失败则保留合并结果，硬截断只作最后兜底。`memory_stats` 新增 `lastConsolidationPrunedAt`，而 `lastConsolidationTruncatedAt` 现在表示「最终写盘真的被截断」；额外调用只在超目标期间发生。

**0.5.2 让记忆管线不再「等下一轮」才推进。** 三处运行行为变化，无需迁移：5 分钟蒸馏防抖窗口内到来的轮次，窗口到期后会自动补蒸馏而不是被丢弃；并发竞争（`queue-full` / `already-running` / `no-lock`）改为加宽间隔的有界重试，不再直接丢弃；合并会在启动后跑一次、随后在有待消费 backlog 时每 10 分钟跑一次，不再依赖下一个用户轮次（`autoSummarize` 关闭时两条都不跑）。`memory_stats` 新增注入字节数、预算水位/高水位标记、最近一次被截断的合并、rollout 窗口状态。rollout 摘要、compaction/子代理摘录与合并结果在**写盘前脱敏**（此前只在注入时脱敏），密钥不再累积进 `rollout_summaries/`；旧版本已写入的文件保持原样，可用 `memory_review` + `memory_update` 人工清理。

**0.5.1 让记忆注入在插件被重新 apply 后仍然生效。** 装新文件并重启 DSH 即可，无需其他操作：注入改为经 `ctx.inject` 等待 `systemPrompt` 服务，而不是在启动时 `ctx.get`，因此插件被宿主重新 apply（保存设置触发的 loader 重载、插件关闭再启用）后不会再静默丢掉 `# DSH memory`。记忆数据与配置不受影响。

**0.5.0 放弃 DSH 0.1.5 旧线并修复密钥脱敏。** 对已有安装有两点影响：

- 插件现在要求 DSH **0.1.7+**（`peerDependencies` 为 `^0.1.7-rc.1 || ^0.2.0-rc.1`）。仍停留在 0.1.5 的部署请保持 0.4.x；在 0.1.7+/0.2.x 上除「独立设置卡片消失」外没有变化——插件页上的配置表单现在是唯一的设置入口。
- `embeddingApiKey` 是 schema 声明的 secret，因此 `GET /_dsh/memory/settings` 不再包含它，改为通过 `secrets` 侧车报告；**清除**密钥必须显式发送 `unset: ["embeddingApiKey"]`——字段缺省表示「保持不变」。（0.4.0 本意如此，但它的 schema 探测从未真正打上标记，密钥仍在端点里往返；0.5.0 修复该探测。）

**0.3.2 把 `maxBytes` 默认值由 `8000` 改为 `16000`。** user 层里保存过的 `maxBytes` 仍然优先，要拿到更大的预算需在卡片里清零/改写，或从 `$DSH_HOME/settings.yaml` 的 `memory:` 段删掉该键。新增的 `injectTokens`（默认 `0` = 关闭）是全新的键，不会被旧值钉住。

插件升级可能改动配置**默认值**，但已写入 user 层的旧值优先级更高（解析顺序：schema 默认 → `base` 组合层 → user 层，user 层胜出）。因此被旧版本固化的值会一直覆盖新默认值——这正是 `consolidateMaxTokens: 3000`（0.2.11 之前的默认值）在 0.2.11 把默认值提到 `8192` 之后仍然卡住合并的原因：每次合并都以 `dsh-memory: LLM output reached max tokens` 失败、摘要停止推进，而插件表面上一切正常（工具、注入、Web 卡片都照常工作）。

自 **0.2.12** 起有三道防护：

- **保存卡片不再固化默认值。** 卡片只提交你改动过的字段；把字段改回默认值时，会删除对应的 user 层条目而不是把默认值写死。端点对收到的任何载荷都会做同样的归一化，因此浏览器里缓存的旧卡片也无法固化默认值。
- **过小的合并预算会在运行时被提升**到 `maxBytes` 规模摘要所需的底线，并通过 `memory_stats.configAlerts` 与日志告警上报；显式设置的更大值仍被尊重。
- 输出超限导致的失败会带上具体键名与生效值，而不只是 `LLM output reached max tokens`。

查看三层实际生效值：

```sh
curl -s http://127.0.0.1:3080/_dsh/memory/settings   # 依次为 settings.value / .base / .user / .defaults
```

清除陈旧覆盖：在卡片里改回默认值，或删除 `$DSH_HOME/settings.yaml` 中 `memory:` 段里的该键——设置提供方会热加载该文件，无需重启 DSH。

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

它提供 **9 个**工具：`memory_read`、`memory_add`、`memory_search`、`memory_update`、`memory_delete`、`memory_merge`、`memory_review`、`memory_history`、`memory_stats`。宿主插件的另外 5 个**有意只做宿主侧**，因为它们由宿主界面而非存储定义：`memory_browse` 经宿主 Web 服务渲染交互式 HTML 浏览器；`memory_export`/`memory_import` 读写宿主侧路径；`memory_rollback` 在宿主合并记账中恢复某个摘要版本；`memory_sync` 需要与宿主的 AGENTS.md 指纹状态对齐。它们底层的存储原语（`lib/store.js`）在两个进程里是同一份文件，因此 MCP 宿主仍能访问全部条目——只是通过直接编辑 Markdown，而不是这些包装工具。

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

插件自带 Web 客户端 bundle，会在**插件页**（设置 → 插件 → 插件配置）为本插件自己的行注册配置表单，除部署同步外无需额外步骤。表单可编辑**全部可实时生效的配置项**，写入走宿主设置接缝；插件自己的同源端点（`/_dsh/memory/settings`，由 host 半部分注册）为程序化读者镜像同一份配置。文案中英双语，跟随 DSH 语言设置；`embeddingApiKey` 是只写密钥（见下），`memoryDir` 更改需重启 DSH。

**支持的 DSH 线：0.1.7 与 0.2.x。** 0.1.7-rc.1 把设置提供方换成 `SettingsForms`、以加载行 config 作为设置文档、只为 `meta.volatile` 字段生成表单；表单就是本 bundle 自己加载行（`dsh-memory`）的配置，注册进 keyed 槽位 `plugins.row.config` 并由 `configForms.whileServed` 把关。已在 **0.1.7-rc.1**、**0.2.0-rc.1**、**0.2.0-rc.2**、**0.2.2-rc.1** 实测：14 个工具全部注册、设置端点可用、写入 → 摘要 → 合并全链路零错误，rc.2 上另按 `includePrerelease` 复算了 peer 门禁。**自 0.5.0 起不再支持 0.1.5 线**——它依赖的提供方侧 `settings.register('memory', …)` 接缝与渲染进 `settings.plugin.item` 的独立卡片都已随之移除，`peerDependencies` 现为 `dsh-llm` / `dsh-settings` / `dsh-tools` `^0.1.7-rc.1 || ^0.2.0-rc.1`（另有 `cordis` `^4.0.1`、`schemastery` `^3.18.0`）。仍停留在 0.1.5 的部署请保持 0.4.x。

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

`npm test` 运行 101 项测试（node:test）：

- `test/store.test.js` —— 存储语义、journal、历史、归档、作用域，以及 `redactForStorage`（写盘前脱敏，开关可关闭）；
- `test/automation.test.js` —— auto-memory 技能定义、模型路由回退链（含 DSH 0.1.7 上经 `describe()` 的读取）、`extractMessageText`（user/assistant 事件结构）、有界的工具活动摘要（`formatToolCall`/`formatToolResult`）、子代理与 compaction 摘录格式化、注入预算使用的 token 估算/截断，以及新增可靠性路径背后的纯函数（`budgetState`、`rolloutWindowState`、`nextRetryDelay`、`summaryTargetBytes`、`summaryTargetChars`）；
- `test/browser.test.js` —— 交互式 HTML 浏览器的快照渲染；
- `test/web-settings.test.js` —— 设置端点生命周期（GET/POST、403/409、体积限制、密钥脱敏）、加载行命名空间解析，以及 VM 沙箱加载客户端 bundle 断言 `plugins.row.config` 表单注册、并确认已移除的 0.1.5 卡片不再存在；
- `test/volatile.test.js` —— DSH 0.1.7 的 volatile 接缝：仅在 schema 库支持时把字段标记为可实时编辑、按全局注册的写钩子识别 cosmokit Volatile 盒、以及把整份解析后的配置读回为普通值；
- `test/embedding.integration.test.js` —— fake `/embeddings` 服务 + 本地哈希向量；
- `test/mcp.integration.test.js` —— 真实 MCP 子进程往返；
- `test/host-wiring.test.js` —— 守卫 `lib/index.js` 的宿主对接面：裸字符串设置命名空间、`settingsNamespace` 辅助导出缺失、Surface 层 `snapshotEvents`（而非 `Session.events`）、`llm` 服务经 `inject(['llm'])` 等待（而非启动时 `ctx.get`）、`settings.mutate` 保存路径（不再全量 `replace`）与合并 token 底线、volatile 配置标记与 `loader/volatile-update` 镜像、14 个工具清单、`agent/turn-stopping`、`systemPrompt.context` 钩子、auto-memory 技能、三条写盘路径经 `redactForStorage`、`nextRetryDelay(` 与 dispose 定时器清理、`memory_stats` 的注入字节/预算水位/rollout 窗口字段、超目标时的 prune pass（第二次有界 LLM 调用，两个提示词都带字符预算，输出须先校验并重新限定预算才能替换合并结果，`lastPrune` 效果可见），以及两条经 fake cordis ctx 的 `apply()` 冒烟（0.1.5 带 `register()` 的提供方，与 0.1.7 无 `register()`、需解盒并响应 volatile 提交的服务），均断言低于底线的 `consolidateMaxTokens` 被提升并上报（零依赖 CI 中跳过）。

架构与机制说明见 [`docs/DESIGN.md`](docs/DESIGN.md)；部署状态见 [`docs/STATUS.md`](docs/STATUS.md)。

## License

MIT
