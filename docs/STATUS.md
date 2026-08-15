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
- settings 说明：memory 命名空间已随插件注册；Web `settings.describe` 仅返回 host-apiproxy 白名单命名空间，因此不列出 memory（属 DSH Web 原生设置页可选后续），不影响插件运行。

## 部署命令记录

```powershell
# 1. 预览差异（不改文件）
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\sync-install.ps1 -DryRun

# 2. 同步（自动备份当前安装副本，不碰记忆数据，不自动重启）
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\sync-install.ps1 -Backup

# 3. 重启 DeepSeek Harness（已于 2026-08-15 19:15 执行；脚本会自动停掉 @deepseek-ai/dsh 相关 node 进程并重新拉起）：
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\restart-dsh.ps1 -WhatIf
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\restart-dsh.ps1
#    或手动重启后仅验证（自动校验文件 + 安装副本 MCP 冒烟）：
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\verify-after-restart.ps1
#    - 手动确认 settings 命名空间出现 memory
#    - 新工具（memory_browse/memory_history/memory_merge 等）可用
#    - memory_stats.scopes / lastError 正常输出
```

## 可选后续

- DSH Web 原生设置页（当前有 `memory_browse` HTML 与完整 stats/history 数据接口）。
- 用户自选神经网络 embedding 端点（`embeddingBaseURL/apiKey/model`；未配置时本地哈希向量）。
