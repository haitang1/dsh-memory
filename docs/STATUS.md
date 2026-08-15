# dsh-memory 状态（2026-08-15）

## 结论

路线图 P0 / P1 / P2.1-P2.6 已全部实现，41 项自动化测试全绿。仓库 `master` 为
0.2.0 发布准备版本；唯一未执行的步骤是运行副本同步与 DSH 重启（需用户确认）。

## 已验证矩阵

| 层 | 结果 |
| --- | --- |
| `npm test`（store 单测 + browser 单测 + fake embedding server + MCP 子进程） | 41/41 |
| DSH 工具注册 | 14 个（read/add/update/delete/search/review/merge/export/import/stats/browse/history/rollback/sync） |
| 独立 MCP | 9 个工具，stdio JSON-RPC 子进程集成通过 |
| 作用域 | global / workspace(cwd) / project(最近 git 根) 工具与自动管线隔离验证通过 |
| 自动管线 | summarize→rollout→consolidate、journal 游标、畸形输出拒绝、回滚/历史均端到端通过 |
| 安全 | 凭据拒绝、注入脱敏、readOnlyScopes 端到端通过 |
| 部署脚本 | 临时目标 DryRun/sync/篡改修复/Backup 全部通过 |

## 部署待办（需确认）

```powershell
# 1. 预览差异（不改文件）
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\sync-install.ps1 -DryRun

# 2. 同步（自动备份当前安装副本，不碰记忆数据，不自动重启）
powershell -ExecutionPolicy Bypass -File E:\git\github\dsh-Plugin\scripts\sync-install.ps1 -Backup

# 3. 重启 DeepSeek Harness 后验证：
#    - settings 命名空间出现 memory
#    - 新工具（memory_browse/memory_history/memory_merge 等）可用
#    - memory_stats.scopes / lastError 正常输出
```

## 可选后续

- DSH Web 原生设置页（当前有 `memory_browse` HTML 与完整 stats/history 数据接口）。
- 用户自选神经网络 embedding 端点（`embeddingBaseURL/apiKey/model`；未配置时本地哈希向量）。
