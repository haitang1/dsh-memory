# AGENTS.md — dsh-memory 项目指南

本文件给在这个仓库上工作的所有 agent 使用。核心结论来自实际分析：架构分层、与 DSH 的兼容红线、测试与发布流程。**改动前先读；与本文件冲突的事实以（package.json / lib/ / README）为准，并顺手修正本文件。**

## 1. 项目概览

- **定位**：DeepSeek Harness（DSH）的类 Codex 持久记忆插件——全局摘要注入每次提示词、14 个 `memory_*` 工具读写、每轮自动蒸馏、定期合并、版本化回滚；另附独立 stdio MCP server 与 Web 设置卡片。
- **当前版本**：0.3.2（MIT，ESM，`engines: node >= 20.3`）。
- **零运行时第三方依赖**：`dependencies` 为空，只有 `peerDependencies`（见红线 3）。仓库无 lockfile、无构建步骤、无 lint/typecheck——保持可读可跑，防漂移靠 `npm run check`。

## 2. 架构与模块地图

| 模块 | 职责 | 依赖边界 |
| --- | --- | --- |
| `lib/store.js` | 存储原语：raw/journal/summary 解析、序列化、BM25+bigram 搜索、本地 256 维哈希向量、远程 `/embeddings` 合并、凭据检测、`MemoryStore`（锁/原子写/作用域/归档/backfill） | **零 harness 依赖**（node builtins only） |
| `lib/web.js` | 同源设置端点 `/_dsh/memory/settings`（GET/POST、同源校验、409 冲突、CSP） | 零 harness 依赖 |
| `lib/browser.js` | 自包含单文件 HTML 记忆浏览器 | 零 harness 依赖 |
| `lib/automation.js` | `AUTO_MEMORY_SKILL` 定义、`resolveSummarizeRoute` 路由回退链、`extractMessageText`（user/assistant 事件结构差异）、`formatToolCall`/`formatToolResult`（`tool/call`、`tool/result` 的有界单行摘要）、`formatSubagentResult`（子代理最终答复的有界摘录）、`estimateTokens`/`truncateToTokens`（无依赖的 token 估算与按 token 截断）、`readSettingsNamespace`（0.1.7 无 `get()` 时经 `describe()` 读取） | 零 harness 依赖 |
| `lib/volatile.js` | DSH 0.1.7 的 volatile 接缝：`volatileField`（仅在 schema 支持时标记字段）、`isVolatileValue`/`unboxConfigValue`/`plainConfig`（把 cosmokit Volatile 盒读回普通值） | 零 harness 依赖 |
| `lib/index.js` | 唯一宿主接线层：`apply()`（settings/tools/skills 注入、systemPrompt.context、turn-stopping）、`toolDefinitions()`（14 工具）、蒸馏/合并管线；`Config` 由 volatile 标记字段构建，配置一律经 `plainConfig` 解盒后使用 | **唯一允许 import `@deepseek-ai/*`**（dsh-llm / dsh-tools / schemastery） |
| `lib/client.js` | Web 客户端 bundle：0.1.5 的 `settings.plugin.item` 卡片（`key:'memory'`）与 0.1.7 的 `plugins.row.config` 表单，en/zh 双语 24 字段 | 仅 client 运行时（同源 `fetch` 到 `/_dsh/memory/settings`；无 eval / localStorage / 跨域请求） |
| `bin/dsh-memory-mcp.mjs` | 独立 stdio MCP server（9 工具），复用 `lib/store.js` | 仅 node builtins |
| `scripts/` | `check-release.mjs`（版本/测试数一致性）、`mcp-smoke.mjs`、Windows 部署/重启/校验 `.ps1` | — |
| `docs/`、`test/`、`.github/workflows/ci.yml`、`cordis.patch.yml`、`examples/mcp-config.json` | 见后文 | — |

**架构原则**：`store/web/browser/automation/volatile` 五个模块可脱离 harness 单测（纯 Node 直跑）；所有 DSH 服务面收敛在 `index.js`。新增逻辑优先放纯逻辑模块，并保持零 import。

## 3. 红线（违反会直接崩/被 CI/运行时抓）

1. **`settings.register('memory', …)` 用裸字符串；禁止 `settingsNamespace`**。dsh-settings@0.1.2-rc.1 已移除 `settingsNamespace` 导出，0.2.8 之前宿主在 0.1.2-rc.1 上直接报 `The requested module does not provide an export named 'settingsNamespace'`。**0.1.7 起 `register()` 本身也不存在**（`SettingsForms` 只有 `describe/update/replace/mutate`），所以 `register` 调用必须包在 `typeof … === 'function'` 探测里，0.2.x 上走无 register 分支（见红线 9）。
2. **`AUTO_MEMORY_SKILL` 必须带 `source: 'runtime'`**。注册期不校验、加载期校验——漏掉会导致技能出现在目录却加载报错（0.2.7 的教训）。
3. **peerDependencies 与已验证的 DSH 线对齐**：`dsh-llm / dsh-settings / dsh-tools` = `^0.1.2-rc.1 || ^0.2.0-rc.1`，`cordis` = `^4.0.1`，`schemastery` = `^3.18.0`。**DSH 是 pre-1.0，同 minor 内可出现破坏性变更，semver 满足 ≠ 运行时兼容**；升级 DSH 必须先验证再改范围（0.1.1→0.1.2、0.1.x→0.2.0 均已发生）。注意 caret 语义：`^0.1.2-rc.1` **不含** 0.2.0，故 0.2.0 线必须显式写进范围（v0.2.14）。
4. **新增配置键四同步**：`Config`（`lib/index.js` z.object）→ `lib/types/index.d.ts` → README 配置表（en/zh）→ `lib/client.js` 卡片（en+zh 标签/提示）。漏一处即出现文档漂移。
5. 五个纯逻辑模块（store/web/browser/automation/volatile）**禁止**新增任何 `@deepseek-ai/*` import——CI 零依赖直跑是它们换来的。
6. 宿主接线改动（`apply()`/`toolDefinitions()`）没有自动化运行时覆盖，改完必须同时更新/运行 `test/host-wiring.test.js` 且做一次真实部署验证，不能只靠"能 import"。
7. **设置保存只能走最小补丁：`settings.mutate` + `set`/`unset`，禁止整段 `settings.replace`**。配置解析顺序是 schema 默认 → 组合 `base` → **user 层（优先级最高）**，整段写入会把「保存当时的默认值」固化成用户覆盖，此后升级改默认值一律不生效。`lib/web.js` 对**任何**载荷（含旧卡片的整段 `value`）都归一化为最小补丁，`lib/client.js` 只提交改动字段；改这条协议时必须保留 host 端归一化（标签页里缓存的旧 client 会继续整段提交）。
8. **合并/摘要的输出 token 预算不得低于安全底线**（`consolidateTokenFloor(maxBytes)`，见 `lib/index.js`）。低于底线时提升而非照做，并通过 `memory_stats.configAlerts` + 日志 + `diagnostics.json` 上报——否则每次合并都报 `LLM output reached max tokens`，而插件表面上完全正常（0.2.11→0.2.12 的教训）。
9. **设置接缝必须多线兼容（0.1.5 / 0.1.7 / 0.2.0）**：0.1.7-rc.1 把提供方换成 `SettingsForms`（既无 `register()` 也无 `get()`），0.2.0-rc.1 沿用同一模型（2026-09 实测：本插件无需改动即通过）。插件命名空间变成**加载行 id**（本包 `cordis.patch.yml` 的 `dsh-memory`），且只为 `meta.volatile` 字段生成表单、保存时**直接改写运行中的 config**。因此四条都不能破：`Config` 字段须经 `volatileField()` 标记（结构性字段 `memoryDir`/`seedFromAgentsMd` 除外，它们需要重新 apply）、配置读取一律先 `plainConfig` 解盒、无 `register()` 时监听 `loader/volatile-update` 把提交镜像回 `resolved`、命名空间按探测顺序取（`memory` → `dsh-memory`）。`Schema#volatile` 在 0.1.5 线不存在，**必须特性探测**，无条件调用会让插件在该线加载即失败。

## 4. 存储格式与一致性

`$DSH_HOME/memories/`（默认）：

```
memory_summary.md         注入体：# DSH memory + vN 版本行 + ## 分节
raw_memories.md           追加式条目（### 时间 + **id:**/**tags:**/**importance:** + 正文）
rollout_summaries/<sid>.md 每会话轮次摘要块（## ISO 时间 + 文本；含工具活动摘要与子代理最终答复摘录）
journal.jsonl             {seq,op,id,ts,entry} 追加日志，合并游标按 seq 消费
summary_history/<v>.<ts>.<u8>.md  保留版本供 memory_rollback
archive/raw-YYYY-MM.md    超出 rawArchiveMaxBytes 后归档的最旧条目
scopes/ws-<hash>/ project-<hash>/  scopedMemory 开启时的作用域库
state.json                版本/游标/AGENTS.md 指纹
diagnostics.json          启动诊断（工具注册、技能注册、错误）
.memory.lock              跨进程锁（60s stale；非持锁实例只读）
```

- 写入全是 **tmp + rename 原子写**；journal 损坏行跳过（游标保持落后）；合并前**严格校验输出**（`# DSH memory`、独立 `vN`、至少一个 `##` 节），畸形拒绝并保留旧版；截断按完整行、不留下未闭合代码围栏。
- 合并只消费「新 rollout 块 + 游标之后的 journal 事件」，游标在写入成功后推进；每会话摘要防抖 5min、并发上限 4、rollout 文件上限 16、合并间隔 10min。
- 注入：`systemPrompt.context({name:'dsh-memory', order:2000, text})` 每次组装时同步重读，写入后下一步生效；读失败返回空串不阻塞会话。
- 安全：注入前 `redactSecrets`（默认开）、`memory_add` 默认拒绝明显凭据（`allowSecret:true` 放行）、`readOnlyScopes` 阻断写工具。

## 5. 工具与技能

14 个 `memory_*` 工具（`toolDefinitions`）：`read / add / update / delete / search / merge / review / export / import / stats / browse / history / rollback / sync`。

- 作用域：`global`（默认）/ `workspace`（`ws-<hash>`，会话 cwd）/ `project`（`project-<hash>`，最近 git 根）；`scopedMemory: true` 时启用后两者，注入预算 global+workspace 拆分。
- 搜索：BM25 + 全词/标签/新近度加权，bigram 模糊兜底；`vector:true` 时叠加本地 256 维哈希向量 cosine（阈值 0.3），配置 `embeddingBaseURL/apiKey/model` 时走 OpenAI 兼容 `/embeddings` 并与 BM25 合并。
- LLM 摘要：模型路由回退链 = `summarizeProvider/summarizeModel` → `agentDefaultModel.currentSelection()` → `agent-default-model` 设置命名空间；内部调用 `reasoningEffort:'off'`（不支持时自动降级重试）；60s 超时、失败按类重试（max tokens/工具调用/unsupported finish reason 不重试）。
- `auto-memory` 运行时技能：指导代理主动识别（偏好/决策/约定/修复/事实）并 `memory_add`（tags+去重）、依赖历史时 `memory_search/memory_read`、修正过时条目。**定义只在 `lib/automation.js`**。

## 6. 测试体系

- `npm test` = **90 项**（node:test，约 0.6s）：`store`（存储语义/journal/历史/归档/作用域）、`automation`（技能定义/路由回退链/事件文本提取/工具活动摘要/`describe()` 读取）、`browser`（HTML 快照）、`volatile`（volatile 标记、盒识别与解盒、配置读回）、`web-settings`（端点生命周期 + 最小补丁保存 + 命名空间探测 + 两种卡片注册）、`embedding.integration`（fake `/embeddings` + 本地向量）、`mcp.integration`（真实子进程往返）、`host-wiring`（见下）。
- **零依赖原则**：CI（`.github/workflows/ci.yml`，node 20/22，push main + PR）**不 install**，直接 `npm run check && npm test`。任何测试新增对第三方包的硬依赖都会让 CI 崩。
- `test/host-wiring.test.js`：①源码守卫——`settings.register('memory'…` 与 `settings.mutate(` 存在且无 `settings.replace(`、`settingsNamespace` 不存在、`snapshotEvents` 存在且 `session.events.entries()` 不存在、`inject(['llm'])` 存在且无启动时 `const llm = ctx.get('llm')`、`consolidateTokenFloor(` 与 `configAlerts` 存在、volatile 标记与 `loader/volatile-update` 存在、`lib/client.js` 无整段 `value: draft`、14 工具名齐全、`agent/turn-stopping`/`systemPrompt.context`/`AUTO_MEMORY_SKILL` 存在；②fake-ctx `apply()` 冒烟**两条**——0.1.5 形态（有 `register()`）与 0.1.7 形态（无 `register()`，盒装 config 需解盒并在 volatile 提交后重读），均断言 14 工具注册、技能、注入钩子、settings 路由，并执行 `memory_stats` 断言低于底线的 `consolidateMaxTokens` 被提升（3000 → 4096）且 `configAlerts` 非空。**当 harness 包不可解析时必须 `t.skip()` 而非报错**（CI 情形），且**不能改变 `# tests` 计数**（check-release 依赖该计数）。
- `npm run check`（`scripts/check-release.mjs`）契约：`package.json.version` == CHANGELOG 最新 `## <ver>` == README 两语版本行（`Current release: **X**` / `当前版本：**X**`）；README 声明的测试数（`runs N tests` / `运行 N 项测试`）== 实际 `node --test` 的 `# tests N`。**这些措辞是解析契约，改动措辞必须同步改脚本。**

## 7. 发布流程（0.2.8 起的标准动作）

1. 代码改动（含 `test/` 更新）；
2. `package.json` bump 版本 + `CHANGELOG.md` 顶部新条目（`## <ver> (YYYY-MM-DD)`，写清为何修/影响面）；
3. 同步文档：README 两语（版本、测试数、新测试文件、与 DSH 版本适配说明）、`docs/STATUS.md` 当前状态块、`lib/types/*.d.ts`（默认值注释）；
4. `npm run check` + `npm test` 全绿；
5. `git commit`（信息含 release: vX.Y.Z 摘要）→ `git tag -a v<ver> -m <摘要>` → `git push origin main` + 推送标签。
- 版本号/测试数/工具数任何一处与 README 不一致，`npm run check` 会红——这是特性，不是烦恼。
- **改 schema 默认值时必须评估 user 层覆盖**：user 层优先级最高，旧版本固化过的旧默认值会继续覆盖新默认，使这次「修复」对已装实例完全无效（0.2.11 的 8192 就是这样被 user 层的 3000 压住的）。改默认值必须配套：运行时底线或迁移、CHANGELOG 写明升级影响与手工清理方式、README 的 Upgrade notes / 升级须知同步。
- 历史版本标签：v0.2.5 / v0.2.6 / v0.2.7 / v0.2.8 / v0.2.9 / v0.2.10 / v0.2.11 / v0.2.12 / v0.2.13 / v0.2.14 / v0.2.15 / v0.2.16 / v0.3.0 / v0.3.1 / v0.3.2（更早版本未补标签）。
- **`npm run check` 必须在任意 reporter 下可解析**：Node 25 在 stdout 非 TTY 时默认 `spec`（`ℹ tests N`），脚本已固定 `--test-reporter=tap` 并保留 fallback 解析；改动该脚本时不要退回只认 TAP 的正则。

## 8. 部署（现状）

- 线上 profile：`~/.dsh/profiles/web/`；`package.json` 中 `dependencies["@dsh-external/dsh-memory"] = "github:haitang1/dsh-memory#<commit-sha>"`，`dsh.profile.bundles` 含 `@dsh-external/dsh-memory`；安装副本为**无 .git 的纯文件拷贝**（`node_modules/@dsh-external/dsh-memory/`）。
- 升级 = ①用仓库发布文件覆盖安装副本（`lib bin examples scripts cordis.patch.yml CHANGELOG.md README*.md LICENSE package.json`）②更新 profile pin 到新 sha ③重启。
- **重启必须用 supervised setsid 模式**：监督进程 cmdline **不得包含 pkill 模式串**（否则自杀），写独立脚本文件再由 setsid 分离执行；参考模板 `/tmp/dshweb-restart-v028.sh`（trace `/tmp/dshweb-restart-v028.trace`）。健康检查注意：`curl /` 会被 token 守卫拦出非 2xx，属误报，以**端口监听 + 服务横幅**为准。
- **验证依据**：`$DSH_HOME/memories/diagnostics.json` 重启后更新，且 `toolsRegistered` 列出 14 工具、`skillRegistered: true`、无 `skillError`；或 `dsh pluginInventory` 显示 enable。本机（2026-09-30 实测）运行副本为 **DSH 0.2.0-rc.2**（全局安装 `/opt/node/lib/node_modules/@deepseek-ai/dsh`，`dsh --version` = 0.2.0-rc.2；web 进程 = `node /opt/node/bin/dsh web --port 3080`，同机 `/usr/local/bin/dsh` 亦为 0.2.0-rc.2）。0.1.5 走 `register(ns,…)` 裸字符串分支；0.1.7/0.2.0 走无 `register()` 的 `loader/volatile-update` 分支（见红线 9）。
- **本机网络坑**：到 github.com 的 git 传输走 HTTP/2 会连续超时（`git ls-remote`/`git fetch` 卡死）；加 `-c http.version=HTTP/1.1` 即可（仓库已写入 `git config http.version HTTP/1.1`）。`api.github.com`/`codeload.github.com` 正常，git 协议不可用时可 `gh api repos/haitang1/dsh-memory/tarball/<ref>` 兜底取源码。
- 独立 MCP：`DSH_MEMORY_DIR` + `DSH_MEMORY_REDACT=1`（默认），`bin/dsh-memory-mcp.mjs` 9 工具；AGENTS.md 种子来自 `$DSH_HOME/AGENTS.md`（`seedFromAgentsMd`，默认开；`memory_sync` 冲突检测）。

## 9. 已知坑与修复记录（教训）

| 版本 | 坑 | 修复 |
| --- | --- | --- |
| 0.2.7 | `AUTO_MEMORY_SKILL` 缺 `source`，技能目录可见但加载报错 | 补 `source:'runtime'` |
| 0.2.8 | DSH 0.1.2-rc.1 移除 `settingsNamespace`，宿主加载崩溃 | 改 `settings.register('memory',…)` + 收紧 peers + 新增 host-wiring 测试 |
| 0.1.2-rc.1 | `Session.events` 被 Surface 层替换（`snapshotEvents`/`deriveMessages`），`extractTurnText` 的 `.entries()` 在每次轮次摘要时抛 `Cannot read properties of undefined (reading entries)` | 迁移到 `agent.session.snapshotEvents(fromSeq)`（v0.2.9） |
| 0.1.2-rc.1 | 启动时 `ctx.get('llm')` 返回 undefined，自动摘要静默跳过（`skips {"disabled":1}`、`llm calls: 0`、摘要永不更新） | 用 `ctx.inject(['llm'],…)` 等待服务（v0.2.10） |
| 调优 | `consolidateMaxTokens` 默认 3000 装不下 ~8KB 有界摘要的输出，合并报 `LLM output reached max tokens`、摘要停更 | 默认提到 8192（schema 上限 16384；v0.2.11） |
| **配置漂移** | Web 卡片以生效值初始化表单并整段 `settings.replace` 保存，**保存一次即把 22 个字段（含全部默认值）固化进 user 层**；user 层优先级高于 schema 默认，于是升级改默认值对已保存过卡片的实例完全无效（实测：0.2.11 后 `lastConsolidatedAt` 停 7 天、journal 游标 13/42，而工具/注入/端点全部正常） | 卡片只提交改动字段（`set`/`unset`）；端点把任何载荷归一化为最小补丁并改用 `settings.mutate`；`consolidateMaxTokens` 加运行时底线并上报 `configAlerts`；截断错误带键名与生效值（v0.2.12） |
| **0.1.7 设置接缝** | 0.1.7-rc.1 换成 `SettingsForms`：`register()`/`get()` 双双消失、插件命名空间变成**加载行 id**、只有 `meta.volatile` 字段才出表单且保存**直接改写运行中的 config**（不再重新 apply）；`Schema#volatile` 在 0.1.5 线不存在，无条件调用会让插件在该线加载即失败 | 特性探测后再标记 volatile 字段；配置读取先 `plainConfig` 解盒；无 `register()` 时监听 `loader/volatile-update` 把提交镜像回 `resolved`；命名空间按 `memory` → `dsh-memory` 探测；`automation` 经 `describe()` 读命名空间（v0.2.13） |
| **0.2.0-rc.1** | 0.1.x→0.2.x 是 minor 跳变，旧范围 `^0.1.2-rc.1` 按 caret 语义**不含** 0.2.0；semver 不匹配不等于运行不兼容，但必须实测才知道 | 实测通过：14 工具注册、设置端点 + `settings.mutate` 保存路径可用、写入→摘要→合并零错误（`llm calls: 1`），`SettingsForms`/`describe`/`mutate`/`snapshotEvents`/`createUserMessage`/`defineTool`/`agent/turn-stopping`/`loader/volatile-update`/`Schema#volatile` 全部在位；peer 改为 `^0.1.2-rc.1 \|\| ^0.2.0-rc.1`（v0.2.14） |
| **0.2.0-rc.2** | 同一条 0.2.0 线上再进一步：`session.snapshotEvents()` 被标 `@deprecated`（"new calls are prohibited"），客户端槽位 `settings.plugin.item` 已彻底不存在，`createUserMessage` 的 `source.kind:'plugin'` 已从 v4 消息来源词表移除 | 复核通过、**无需改码**：14 工具 + `skillRegistered`、`/_dsh/memory/settings` 200、蒸馏/合并在本进程内跑通（v23、`llm calls: 2`、0 失败）；peer 门禁按 `includePrerelease` 复算仍接受。两处弃用记入待办：per-turn 读取迁移目标 `ctx.sessionQuery.observeSession(...)`（须读原始事件，禁用会丢 compaction 内容的 `deriveMessages()`）；0.1.5 卡片在 0.2.x 上静默失效（活跃路径 `plugins.row.config` + `configForms`）（v0.2.15 记录） |
| **注入预算只有字节** | `maxBytes` 默认 8000 只能表达字节量，而同样字节数的中英文 token 数相差数倍；且字节预算无法表达「这个模型上下文多大」。实测线上摘要 7848 B 已贴近 8000 B 上限 | 默认 `maxBytes` 提到 **16000**，并新增 `injectTokens`（默认 0 = 只按字节）用本地无依赖估算器按 token 再设上限（中文 ≈ 1 token/字符，拉丁 ≈ 1/4）（v0.3.2） |
| **子代理产出不入记忆** | 蒸馏只由 `agent/turn-stopping` 驱动且仅对根会话生效，子代理（研究/探索/验证的产出）此前 100% 被跳过；`subagent/end` 的载荷又没有父会话身份，只有「以委派父代理为 key 的 scope carrier」 | 把 `subagent/end` 监听器注册到**父代理自己的 `agent.ctx`**（`agent/created` + turn-stopping 补挂），用纯函数 `formatSubagentResult` 把最终答复作为 rollout 块追加（≤2000 字符、去重、无额外 LLM 调用），新增 `captureSubagents`（v0.3.0） |
| **蒸馏只读消息事件** | `extractTurnText` 只读 `user/message` / `assistant/message` 的 text block，而工具调用与结果是**独立事件**（`tool/call` / `tool/result`）——于是「跑了什么命令、哪个测试失败、怎么修的」全部进不了记忆，摘要里只剩寒暄式散文 | 新增 `formatToolCall`/`formatToolResult` 纯函数生成有界单行摘要，`extractTurnText` 以独立预算（≤4000 字符）追加在 `[tool activity]` 标记后，截断正文不影响它（v0.2.16） |
| 常态 | DSH pre-1.0，同一 `^0.1.x` 范围内 API 可破 | 升级前验证；用 host-wiring 守卫兜底 |

**维护提示**：本文件是与代码平行的文档，改版本/工具数/CI/部署方式时同步更新；若与仓库不一致，以 package.json / lib / README / CHANGELOG 为准（并修本文件）。
