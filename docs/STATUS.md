# dsh-memory 状态

## 当前状态（2026-09-30）

- 最新版本：**0.3.1**（main），88 项自动化测试（87 通过 / 1 跳过）。`npm run check` 通过。
- 0.3.1（迁移到 sessionQuery）：`agent.session.snapshotEvents()` 在 DSH 0.2.0-rc.2 上被标记 `@deprecated`（"new calls are prohibited"），而它是本插件唯一的按轮读取路径。现改为经 `ctx.inject(['sessionQuery'])` 拿到查询服务并用 `observeSession(sessionId, {projectionMode:'none'})` 取「不可变原始事件」，读完即 `dispose()`；**绝不使用 `deriveMessages()`**（它会删掉被 compaction 遮蔽的消息，正是尚未蒸馏进记忆的内容）。旧调用保留为兜底：组合里没有查询后端或更老的 DSH 线仍然照常蒸馏（失败只记一条日志）。读取因此变成异步，队列槽位改为先占后读（`too-short` 跳过改由任务内上报）。host-wiring 守卫同步升级：要求 `observeSession` + `inject(['sessionQuery'])`，并以「剥掉注释后不得出现 `deriveMessages(`」的方式守住红线。测试仍为 88 项。
- 0.3.0（子代理捕获）：蒸馏只由 `agent/turn-stopping` 驱动且仅对**根会话**生效，于是子代理（研究、探索、验证的产出）此前 100% 不进记忆。`subagent/end` 带 `lastAssistantMessage`，但载荷**不含父会话身份**——dsh-subagent 用「以委派父代理为 key 的 scope carrier」派发生命周期事件，所以父代理只能从派发接收者取到。插件因此把监听器注册到**该代理自己的作用域上下文 `agent.ctx`**（经 `agent/created` 获取；插件加载时已在运行的代理则由既有的 turn-stopping 处理器补挂），每个代理的作用域只收到自己子代理的事件，既不需要维护全局 run→parent 映射，销毁也跟随代理作用域。新增配置键 **`captureSubagents`（默认 true）**：用纯函数 `formatSubagentResult`（≤2000 字符、短于 80 字符忽略、带 `[subagent result (<stopReason>)]` 标记）把子代理最终答复作为 rollout 块追加到父会话，**不额外调用 LLM**（周期性合并本来就会读 rollout 并蒸馏）。同一子代理（continuable 子代理每个驻留周期都会 settle 一次）重复输出按最后正文去重（上限 64），跳过原因 `subagent-duplicate`/`subagent-empty` 计入 `memory_stats.skips`；无 `agent.ctx` 的组合（未给代理建作用域）自动降级为不可用，非持锁实例以 `no-lock` 跳过而非写入。测试 86 → 88，配置面 22 → 23 字段（四同步全部落地）。
- 0.2.16（蒸馏质量 + 词汇清理）：轮次蒸馏此前只读 `user/message` / `assistant/message` 的 text block，工具活动（`tool/call` / `tool/result` 是独立事件）被整体丢弃——于是「跑了什么命令、哪个测试失败、怎么修的」这类最耐久的知识进不了记忆。现由 `lib/automation.js` 新增的两个纯函数 `formatToolCall`（`[tool] <name> <arguments>`，空白折叠、参数截断 ≤240 字符）与 `formatToolResult`（`[tool result] ok|error: <reason 或首个 text block>`，优先取 harness 记录的 error.reason）生成单行摘要，`extractTurnText` 以独立预算（≤4000 字符、最多占 `MAX_TURN_INPUT_BYTES` 一半）追加在 `[tool activity]` 标记之后，故截断会话正文不会丢摘要。同时按 0.2.0-rc.2 审计清理三处退役词汇：合成 LLM 调用的来源改为生产者命名（`{kind:'dsh-memory'}`，与 `dsh-session-title-llm` 等一方临时调用一致；v3 的 `{kind:'plugin',plugin}` 已不在 v4 词表）、keyed `plugins.row.config` 注册去掉只属于 list 槽位的 `order`/`label`、`dsh.client.inject` 移除 0.2.0-rc.2 中并不存在的 `@deepseek-ai/dsh-client-runtime`。测试 84 → 86。
- 0.2.15 复核（DSH **0.2.0-rc.2**，2026-09-30）：线上 profile 当天从 0.2.0-rc.1 升到 0.2.0-rc.2（全局包 `/opt/node/lib/node_modules/@deepseek-ai/dsh`，`dsh --version` = 0.2.0-rc.2，web 进程 `node /opt/node/bin/dsh web --port 3080` 于 13:38:34Z 启动）。逐点复验结论：① `diagnostics.json` 列出 14 个 `memory_*` 工具、`skillRegistered: true`、`toolErrors`/`configAlerts` 皆空；② `GET /_dsh/memory/settings` → 200（`writable: true`，20 字段），`dsh-settings` 是 `SettingsForms`（`configure/describe/update/replace/mutate`，**无 `register()`/`get()`**），正是插件既有的无 register/volatile 分支；③ 蒸馏与合并**在 rc.2 进程内跑通**——13:44:47Z 完成合并（进程启动后 6 分钟），摘要推进到 v23，`memory_stats` 报 `llm calls: 2 (14299 ms, 0 failures)`、`errors: 0`、`skips {}`；④ API 在位：`dsh-llm` `createUserMessage` + `llm.stream`、`dsh-tools` `defineTool`、`dsh-session` `snapshotEvents`/`deriveMessages`、`dsh-system-prompt` `context()`、`agent/turn-stopping`（由 `dsh-agent-loop` 发射，`agent` 字段由 agent dispatcher 注入，故既有解构正确）、`loader/volatile-update`、`cordis` 4.0.4、`schemastery` 3.18.4（`Schema#volatile`）；⑤ peer 门禁按 `semver.satisfies(..., {includePrerelease:true})` 复算，`^0.1.2-rc.1 || ^0.2.0-rc.1` 接受 0.2.0-rc.2，**无需改范围**。同时记录两处后续 DSH 弃用（本版不改行为）：`session.snapshotEvents()` 已标 `@deprecated`（"new calls are prohibited"），迁移目标是 `ctx.sessionQuery.observeSession(...)` 且必须读**原始事件**（不可用会丢弃 compaction 遮蔽内容的 `deriveMessages()`）；客户端槽位 `settings.plugin.item` 在 0.2.x 已不存在（0.1.5 卡片在 0.2.x 上静默失效，活跃路径是 `plugins.row.config` + `configForms`）。
- 0.2.14 适配（DSH **0.2.0-rc.1** 实测通过 + peer 扩展）：0.1.x→0.2.x 是 minor 跳变，旧范围 `^0.1.2-rc.1` 按 caret 语义不含 0.2.0，故必须实测。实测结论：插件 **无需改动**即可运行——14 工具全注册、`/_dsh/memory/settings` 200 且 `defaults` 正常、同源保存走 `settings.mutate` 最小补丁路径、MCP 冒烟通过；`dsh-session` 的 `snapshotEvents`/`deriveMessages`、`dsh-llm` 的 `createUserMessage`、`dsh-tools` 的 `defineTool`、`dsh-settings` 的 `SettingsForms`/`describe()`/`mutate()` 全部在位（`settings.register()` 已不存在，正是插件按设计走的无 register 分支）；`agent/turn-stopping`（`dsh-agent-loop`）与 `loader/volatile-update`（`cordis-plugin-loader`）仍在；schemastery 3.18.4 提供 `Schema#volatile`，设置表单路径激活；端到端写入→摘要→合并零错误（`llm calls: 1 (10251ms)`、摘要 v168 → v169、游标追平）。`peerDependencies` 相应改为 `^0.1.2-rc.1 || ^0.2.0-rc.1`（`cordis ^4.0.1`、`schemastery ^3.18.0` 不变）。
- 0.2.13 适配（DSH **0.1.7** 设置接缝）：0.1.7-rc.1 把设置提供方由 `SettingsProvider` 换成 `SettingsForms`，仅对 `meta.volatile` 字段生成可编辑表单，且保存时直接写入运行中的 config（不再重新 apply 插件）。插件改为双线兼容：新增 `lib/volatile.js`（仅在 schemastery 支持时标记 `Schema#volatile`，0.1.5 线无该方法；按全局写钩子 `Symbol.for('cosmokit.volatile.write')` 识别 cosmokit Volatile 盒并把配置读回普通值）；`Config` 由标记字段构建，`memoryDir`/`seedFromAgentsMd` 保持非 volatile 以便保存触发重新 apply；无 `register()` 时把 `loader/volatile-update` 镜像回运行中的 resolved 配置；`lib/web.js` 改为探测命名空间（0.1.5 的 `memory` / 0.1.7 的加载行 id `dsh-memory`）并按实际找到的命名空间写入；`lib/automation.js` 在无 `get()` 时经 `describe()` 读取 `agent-default-model`；`lib/client.js` 额外在 `plugins.row.config` 注册 0.1.7 表单。测试 71 → 84。
- 0.2.12 修复（配置漂移）：升级改 schema 默认值不足以生效——user 层优先级高于 base 与 schema 默认，旧版本固化的值会继续覆盖新默认。实测：0.2.11 把 `consolidateMaxTokens` 提到 8192 后，曾保存过设置卡片的实例其 user 层仍是 3000，合并继续以 `LLM output reached max tokens` 失败，摘要 7 天停在 v52、journal 游标 13/42，而工具/注入/Web 端点全部正常。根因：卡片以**生效值**初始化表单，再经 `settings.replace` 整段写入，保存一次就把 22 个字段（含全部默认值）固化进 user 层。修复：① 卡片只提交改动字段（`set`/`unset` 差异），改回默认值即删除该 user 条目；② 端点把任何载荷（含旧卡片的整段 `value`）归一化为最小补丁，改用 `settings.mutate` 路径写入；③ `consolidateMaxTokens` 增加运行时底线 `min(16384, max(4096, ceil(maxBytes/2)))`，低于底线则提升而非照做，并写入 `memory_stats.configAlerts`、日志与 `diagnostics.json`；④ 超限失败信息带上键名与生效值。已在线实测：修改 `settings.yaml` 后热载生效，合并恢复（摘要 v52 → v53，游标追平 43/43）。
- 0.2.11 修复：`consolidateMaxTokens` 默认 3000 → **8192**（合并输出需容纳 ~8KB 有界摘要 ≈ 4-6K token，3000 触发 `LLM output reached max tokens`，摘要停在 v12 无法推进；已在线实测：蒸馏写入 rollout 后合并报此错）。
- 0.2.10 修复：`llm` 服务改为经 `ctx.inject(['llm'],…)` 等待，而非启动时 `ctx.get('llm')`（DSH 0.1.2-rc.1 下后者返回 undefined，自动摘要静默跳过：`llm calls: 0`、`skips {"disabled":1}`、摘要永不更新）；新增 host-wiring llm 守卫。已在线实测：蒸馏端到端恢复（rollout 14:39 写入）。
- 0.2.9 修复：适配 DSH **0.1.2-rc.1** 的 Surface 层 —— `Session.events` 被 `snapshotEvents`/`deriveMessages` 替换，`extractTurnText` 改为 `agent.session.snapshotEvents(fromSeq)`（此前每次轮次摘要都抛 `Cannot read properties of undefined (reading entries)`）；新增 host-wiring Surface 守卫。
- 0.2.8 修复：适配 DSH **0.1.2-rc.1** —— 该版 `dsh-settings` 移除了 `settingsNamespace` 辅助导出，`settings.register` 改为接受裸字符串命名空间；插件改用 `settings.register('memory', …)`，并将 peerDependencies 收紧到 `dsh-*` `^0.1.2-rc.1` / `cordis` `^4.0.1`。
- 0.2.7 修复：`auto-memory` 运行时技能补 `source: 'runtime'`（此前技能出现在目录但加载报错）。
- 另：新增 `.github/workflows/ci.yml`（node 20/22，零依赖直跑）、`scripts/check-release.mjs`（`npm run check` 防版本/测试数漂移）、`test/host-wiring.test.js`；标签 v0.2.5–v0.2.11。
- 以下为 2026-08-15 的部署历史快照；此后的进展见 [CHANGELOG.md](../CHANGELOG.md)，当前发布形态以 README 安装章节为准。

## 历史快照（2026-08-15）

## 结论

路线图 P0 / P1 / P2.1-P2.6 已全部实现，49 项自动化测试全绿。仓库 `master` 为
0.2.1 已发布部署版本：运行副本已同步、DSH 已重启、插件加载与 Web 设置页卡片均已端到端验证。

## 已验证矩阵

| 层 | 结果 |
| --- | --- |
| `npm test`（store 单测 + browser 单测 + web-settings 单测 + fake embedding server + MCP 子进程） | 49/49；核心依赖无关代码行覆盖 93.0%（store 93.07%、browser 92.31%） |
| DSH 工具注册 | 14 个（read/add/update/delete/search/review/merge/export/import/stats/browse/history/rollback/sync） |
| 独立 MCP | 9 个工具，stdio JSON-RPC 子进程集成通过 |
| 作用域 | global / workspace(cwd) / project(最近 git 根) 工具与自动管线隔离验证通过 |
| 自动管线 | summarize→rollout→consolidate、journal 游标、畸形输出拒绝、回滚/历史均端到端通过 |
| 安全 | 凭据拒绝、注入脱敏、readOnlyScopes 端到端通过 |
| 部署脚本 | 临时目标 DryRun/sync/篡改修复/Backup 全部通过 |


## 本轮复验（2026-08-15 19:10）

> 本节为 2026-08-15 19:10 的复验快照（当时测试套件 41 项、DSH 尚未重启）；后续进展见下方「部署状态」——测试已扩展为 49 项，部署重启与 Web 设置页卡片均已验证。

- `npm test`：41/41 通过（388ms），与已验证矩阵一致。
- DSH 插件链路（fake ctx + 真实 @deepseek-ai 依赖）：settings 注册（namespace=memory, applies=live）；14 个 memory_* 工具全部注册；read/add/update/delete/search/review/merge/export/import/stats/browse/history 全链路通过。
- 作用域：global / workspace(cwd) / project(git root) 端到端读写与隔离通过。
- 自动管线：fake LLM 下 summarize→rollout→consolidate 通过；畸形合并输出被拒绝且旧摘要保持 v1，后续有效合并写入 v2。
- 回滚与同步：`memory_history`/`memory_rollback`（v1→v2→回滚 v1，历史双向归档）通过；`memory_sync` 的 up-to-date/imported/conflict 三分支通过。
- 安全：凭据写入默认拒绝、allowSecret 显式放行、注入摘要脱敏、readOnlyScopes 阻断写操作均通过。
- 安装副本：`verify-after-restart.ps1` 10/10 SHA-256 match；MCP smoke `server=dsh-memory version=0.2.0 tools=9`，add/search 通过。
- 同步脚本 `-DryRun`：14/14 match，无需复制。
- 结论：功能完成性复验通过（41 单测 + 14 工具全链路 + 自动管线 + 安全 + 部署副本），本测试目标完成。
- DSH 重启：本轮未执行（仍按约定待用户确认，不阻塞测试目标）。

## 部署状态

- 文件同步：已完成（2026-08-15 18:17，`-Backup` 已创建）；10/10 文件 SHA-256 与仓库一致。
- 重启前校验：已直接用安装副本启动 MCP server（version 0.2.0，9 tools，add/search 全链路通过）。
- DSH 重启：已完成（2026-08-15 19:15，用户确认后执行；新 DSH 进程已拉起）。
- 重启后验证：`verify-after-restart.ps1` 10/10 SHA-256 match；MCP smoke v0.2.0/9 tools 通过；`pluginInventory/list` 显示 `include:dsh-memory` enabled=true、fiberPhase=active；记忆目录 `.memory.lock`/`state.json` 于 19:15:59 刷新。
- settings 说明：memory 命名空间已随插件注册；Web `settings.describe` 仅返回 host-apiproxy 白名单命名空间。两条路径均已落地：
  1. `scripts/patch-web-settings.ps1` 把 `memory` 加入 `WEB_SETTINGS_NAMESPACES` 白名单（已应用于本部署，备份 `index.js.bak-20260815`，`node --check` 通过），使 describe/update API 也覆盖 memory；
  2. **Web 设置页卡片（主路径）**：插件新增客户端 bundle（`lib/client.js`，`dsh.client` 声明 + `exports["./client"]`），在 `settings.plugin.item` Slot 注册 "Memory" 卡片（order 30），通过同源端点 `/_dsh/memory/settings`（host `lib/web.js` 注册）读写配置——不依赖 apiproxy 白名单。
- 本部署同步状态（2026-08-15 20:45）：18/18 文件 SHA-256 一致（含 `lib/client.js`、`lib/web.js`、`lib/types/client.d.ts`）；`verify-after-restart.ps1` 全绿；`npm test` 49/49（`test/web-settings.test.js` 覆盖 GET 快照、POST 保存、403/409、非法 action、client bundle 静态断言、VM 沙箱加载与卡片注册、webServer 等待注册）。
- **GUI 验证完成（2026-08-15 20:48，DSH 重启后）**：
  1. 设置 → 插件 → 插件配置 出现 "Memory (dsh-memory)" 卡片（与终端/Agent 循环/网页搜索并列）；
  2. 展开卡片，表单正确加载当前值（maxBytes=8000 等）；
  3. 编辑 maxBytes → Save → 页面显示 "Settings saved and applied."，Save/Discard 复位为禁用；
  4. 宿主落盘确认：`settings.yaml` 出现 `memory:` 段（maxBytes 往返测试后恢复 8000，autoSummarize=true 等）——Web 卡片 → 同源端点 `/_dsh/memory/settings` → settings.replace → 落盘 → `applies: live` 即时生效，全链路闭环。
- 目标「让 DSH Web 设置页面出现 memory」已达成。

## 部署命令记录

```powershell
# 1. 预览差异（不改文件）
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\sync-install.ps1 -DryRun

# 2. 同步（自动备份当前安装副本，不碰记忆数据，不自动重启）
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\sync-install.ps1 -Backup

# 3. 重启 DeepSeek Harness（已于 2026-08-15 19:15 执行；脚本会自动停掉 @deepseek-ai/dsh 相关 node 进程并重新拉起）：
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\restart-dsh.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\restart-dsh.ps1

# 4. 让 Web 设置页显示 memory（两条互补路径）：
#    a) 白名单补丁（可选，让 settings.describe/update API 覆盖 memory；幂等、自动备份）：
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\patch-web-settings.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\patch-web-settings.ps1
#    b) 设置页卡片（主路径，随插件 client bundle 自动注册 settings.plugin.item）
#       重启一次 DSH 后，设置 → 插件 → 插件配置 应出现 "Memory (dsh-memory)" 卡片

#   或手动重启后仅验证（自动校验文件 + 白名单 + 安装副本 MCP 冒烟）：
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\verify-after-restart.ps1
#    - 手动确认 settings 命名空间出现 memory
#    - 新工具（memory_browse/memory_history/memory_merge 等）可用
#    - memory_stats.scopes / lastError 正常输出
```

## 可选后续

- 用户自选神经网络 embedding 端点（`embeddingBaseURL/apiKey/model`；未配置时本地哈希向量）。
- Web 设置页验证：白名单补丁已应用，DSH 重启后用 GUI 确认 memory 表单渲染（设置 → 插件 → 插件配置）。
