# dsh-memory 状态（2026-08-15）

## 结论

路线图 P0 / P1 / P2.1-P2.6 已全部实现，41 项自动化测试全绿。仓库 `master` 为
0.2.0 发布准备版本；唯一未执行的步骤是运行副本同步与 DSH 重启（需用户确认）。

## 已验证矩阵

| 层 | 结果 |
| --- | --- |
| `npm test`（store 单测 + browser 单测 + fake embedding server + MCP 子进程） | 41/41；核心依赖无关代码行覆盖 93.0%（store 93.07%、browser 92.31%） |
| DSH 工具注册 | 14 个（read/add/update/delete/search/review/merge/export/import/stats/browse/history/rollback/sync） |
| 独立 MCP | 9 个工具，stdio JSON-RPC 子进程集成通过 |
| 作用域 | global / workspace(cwd) / project(最近 git 根) 工具与自动管线隔离验证通过 |
| 自动管线 | summarize→rollout→consolidate、journal 游标、畸形输出拒绝、回滚/历史均端到端通过 |
| 安全 | 凭据拒绝、注入脱敏、readOnlyScopes 端到端通过 |
| 部署脚本 | 临时目标 DryRun/sync/篡改修复/Backup 全部通过 |


## 本轮复验（2026-08-15 19:10）

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
