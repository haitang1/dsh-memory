# dsh-memory 扩展方向与优化路线

> 基线：`@dsh-external/dsh-memory` v0.1.0，仓库 `E:\git\github\dsh-Plugin` @ `43cea35`。
> 安装副本 `C:\Users\llhht\.dsh\profiles\web\node_modules\@dsh-external\dsh-memory` 的
> `lib/index.js`、`lib/types/index.d.ts`、`package.json`、`cordis.patch.yml` 与仓库哈希一致
> （两份 README 因安装后仓库有文档修订而落后，功能代码无差异）。
>
> 本文是后续开发的路线图：先列实测现状与代码审计结论，再按 P0 / P1 / P2 给出优化项和
> 验收标准，最后给出版本里程碑与需要用户确认的决策点。

## 1. 结论摘要

- **立即可做（P0，正确性与硬化）**：修复种子摘要不遵守 `maxBytes`、消除双 `v1` 版本行、
  用变更日志解决「更新/删除的条目永远进不了或退不出摘要」、给合并过程加消费游标与输入
  预算、统一写入配额与参数校验、修正 peer dependency 与顶层 import 的矛盾，并补测试。
- **近期（P1，质量与观测）**：搜索升级、`AGENTS.md` 变更重同步、`memory_stats` 工具、
  LLM 预算与成本账本、并发与队列上限、raw 文件归档压缩。
- **远期（P2，功能扩展）**：项目级作用域记忆、可选向量检索、MCP 互操作与导入导出、
  设置界面 / 记忆浏览器、条目生命周期管理、敏感信息防护。
- **非目标**：不做云端记忆服务；不静默把记忆发往第三方；不替代 Codex 记忆；不试图覆盖
  system/developer/直接用户指令（摘要中的免责声明保持不变）。

## 实现状态（2026-08-15）

- **P0-1 种子预算与版本归一**：已实现（`seedSummary` 最终文件按 `maxBytes` 截断，种子正文移除独立 `vN` 行；`summaryVersion` 仅在 header 后取版本；合并输出用 `ensureVersionLine` 归一）。
- **P0-2 变更日志**：已实现（`journal.jsonl` 记录 add/update/delete，删除携带条目快照；合并改读 journal 净变更，工具变更后主动请求合并；旧 raw 条目启动时回填）。
- **P0-3 合并游标与输入预算**：已实现（`state.rolloutConsumed` 按文件/块推进；`consolidateMaxBytes` 默认 40000 控制输入总量）。
- **P0-4 写入配额**：已实现（content ≤ 2000 字节，tags ≤ 16 且单个 ≤ 48 字符，add/update 同一校验路径）。
- **P0-5 packaging**：已实现（移除 `dsh-llm`/`dsh-settings` 的 optional 声明，二者恢复为必需 peer）。
- **P0-6 测试**：已实现（`npm test`，25 项 node:test 用例全绿；另完成 fake-ctx 工具链路与 fake-LLM 自动摘要/合并端到端验证）。
- **P1-1 搜索升级**：已实现（raw 解析按 mtime+size 缓存；多关键词 `all`/`any` 模式；`tags` 过滤；全词/标签/新近度评分排序；命中窗口 snippet；`memory_search` 输出 `score`）。
- **P1-3 `memory_stats` 工具**：已实现（摘要大小/版本/超预算、raw 数量与字节、rollout 文件数、journal 事件与游标、上次合并、后台任务状态）。
- **P1-2 AGENTS.md 重同步**：已实现（state 记录源/种子摘要指纹；`memory_sync` 在源变化且摘要未被手改时重新导入并版本 +1，双方都变化时报告 conflict 不覆盖）。
- **P1-5 并发与队列硬化**：已实现（`maxActiveSummaries` 默认 4，超限丢弃并告警；`lastSummarized` 超时/超 64 条自动清理；`.memory.lock` 带 60s stale 检测，其他活跃进程持锁时本实例只读）。
- **P1-4 LLM 预算与成本**：已实现（`summaryMaxTokens`/`consolidateMaxTokens`/`llmRetries` 可配；瞬时失败重试一次；每次调用记录 provider/model/耗时/usage，`memory_stats` 输出 llmCalls/llmMs/llmFailures）。
- **P1-7 raw 归档压缩**：已实现（活动 `raw_memories.md` 超过 `rawArchiveMaxBytes`（默认 200000）时，最旧条目写入 `archive/raw-YYYY-MM.md`；归档条目仍可被 `memory_search` 搜索，`memory_read`/`memory_stats` 报告归档数量与字节）。
- **P1-6 摘要输出安全与回滚**：已实现（合并输出严格校验 `# DSH memory` + 独立 `vN` + `##` 节，畸形输出拒绝写入并保留旧版；行边界 + 代码围栏感知截断；每次合并前归档 `summary_history/`，`keepSummaryVersions` 默认 20；新增 `memory_rollback {version}` 工具）。
- **额外修复**：`BlockAssembler.finish` 总是返回 `{kind:'stop'}`，原 `if (assembler.finish) throw` 会让每次自动摘要必然失败；已改为按 `dsh-session-title-llm` 模式解析 finish，并把摘要任务从 `store.chain` 中解耦（原写法存在自锁）。
- **P2.1 项目级作用域**：已完成——作用域键/目录、`scopedMemory`+`scopeMaxBytes` 配置、工具 `scope` 参数（`global`/`workspace` 默认/`project`=最近 git 根）、注入 global+workspace 预算拆分、每作用域 rollout 与合并（独立 state/journal/rollout 游标与版本历史）。**迁移决策**：根目录即 canonical global 作用域，不迁移到 `scopes/global`（向后兼容，旧数据继续有效）。
- **P2.2 检索增强**：已实现 BM25（idf/tf 归一）+ 全词/标签/新近度 + 字符 bigram 模糊兜底（`fuzzy` 默认开启）+ 本地特征哈希向量（词 token + 2/3-gram、256 维、L2 归一）与余弦检索（`vector:true`，阈值 0.3）。**待办（可选）**：接入神经网络 embedding provider 替换本地哈希向量。
- **P2.3 互操作**：已实现 `memory_export`/`memory_import`（Codex 文件级）与独立 MCP 服务器 `bin/dsh-memory-mcp.mjs`（stdio JSON-RPC，9 个记忆工具，作用域参数，零 DSH 运行时依赖，含真实子进程集成测试）。**待办**：Codex 汇总文件（MEMORY.md/memory_summary.md）合并导入。
- **P2.4 生命周期管理**：已实现 `importance` 0-3 元数据（raw 持久化、搜索加权、add/update 参数）、`memory_add` 归一化重复拒绝（`allowDuplicate` 覆盖）、`memory_review`（最旧优先、`olderThanDays` 过滤、Dice 近重复组建议、永不自动删除）、`memory_merge`（保留 id、最长内容/标签并集/最高重要性，写 update+delete journal）。**待办**：TTL/accessedAt 字段。
- **P2.6 安全隐私**：已实现 `detectSecrets`（AWS/GitHub/OpenAI/私钥/credential 赋值/高熵 token）与 `redactSecrets`；注入摘要默认脱敏（`redactSecrets=true`），`memory_add` 对明显凭据拒绝并需 `allowSecret:true`；`readOnlyScopes` 可按 scope 阻止 add/update/delete/merge/import/rollback/sync。**待办**：云端同步审批 UI。
- **P2.5 可观测性（数据层）**：已实现 `memory_stats` 的 scope 库存（每作用域 rawCount/summaryVersion/journalCursor/consolidating）、errorCount/lastError 遥测，以及 `memory_history` 版本浏览。**待办**：设置界面可视化（Web UI 层）。
- **发布准备**：版本升至 `0.2.0`，新增 `CHANGELOG.md` 与 `examples/mcp-config.json`；`scripts/sync-install.ps1` 已包含全部发布文件并在临时目标验证。实际运行副本同步与 DSH 重启仍待用户确认。


## 2. 实测现状（2026-08-15）

| 编号 | 观察 | 证据 |
| --- | --- | --- |
| E1 | 注入摘要超过预算 | 运行中 `$DSH_HOME/memories/memory_summary.md` 为 **9369 字节**，配置 `maxBytes: 8000`；注入端（`lib/index.js:321`）虽会截断，但文件本身超限 |
| E2 | 种子导入产生双版本行 | `seedSummary`（`lib/index.js:230-238`）把 `AGENTS.md`（9183 字节）原样写入，而 `AGENTS.md` 自带 `v1` 行；实测摘要里有两个 `v1` 行，`summaryVersion` 取第一个匹配（`lib/index.js:43,122-125`），版本语义含糊 |
| E3 | 种子阶段未施加 `maxBytes` | 只有注入（`:321`）和合并（`:445`）调用 `truncateUtf8`；`seedSummary` 不调用 |
| E4 | 更新/删除难以正确反映到摘要 | 合并时 raw 条目按创建时间 `entry.ts > lastConsolidatedAt` 过滤（`lib/index.js:413`）；`memory_update`/`memory_delete` 不改时间戳、不留墓碑，因此「合并前创建、合并后修改/删除」的条目会被永久漏掉 |
| E5 | 合并重复消费、输入无上限 | `latestRolloutSummaries(MAX_ROLLOUT_FILES)`（`lib/index.js:402`）每次读取最多 16 个**完整文件**，`state.json` 只有 `lastConsolidatedAt/version`，没有消费游标；同一文件会被反复送进 LLM，16 个文件的体积也没有封顶 |
| E6 | 写入无配额 | `memory_add` 只校验非空；`memory_update` 的 tags 路径没有 `slice(0,16)` 和长度约束（`lib/index.js:555-565,591-597`）；`raw_memories.md` 只增不减 |
| E7 | 搜索每次全量解析且无相关性 | `memory_search` 每次 `parseRaw` 整个文件（`:201-210`），纯子串匹配，无解析缓存、标签过滤、多关键词、相关性排序 |
| E8 | packaging 声明与实现矛盾 | `package.json` 把 `dsh-llm`、`dsh-settings` 标为 optional，但 `lib/index.js:23-24` 顶层静态 import，二者缺一个模块加载即失败；`ctx.get` 的动态守卫（`:303-341`）因此不能兑现「缺服务也可降级」 |
| E9 | 自动记忆管线尚无运行证据 | 截至基线，`memories/` 只有种子生成的 `memory_summary.md` 和空 `rollout_summaries/`；尚无 `state.json`，说明「摘要→合并→再合并」链路还没有经过真实轮次验证 |
| E10 | 无测试/CI | 仓库只有源码与文档；解析、序列化、UTF-8 截断、版本推进、工具行为均无回归测试 |

## 3. P0 优化：正确性与硬化

| 编号 | 问题 | 方案 | 验收标准 |
| --- | --- | --- | --- |
| P0-1 | 种子摘要超预算、双版本行（E1-E3） | `seedSummary` 先按 `maxBytes` 减去头部字节数截断 seed；规范化正文里顶层 `vN` 行（移除或改写为普通文本）；`summaryVersion` 只解析 header 之后第一个独立版本行 | 用 >8KB 的 `AGENTS.md` 首次初始化后：摘要 ≤ `maxBytes`、UTF-8 不截断半个字符、全文件恰好一个 `vN` 版本行；对现有 E1/E2 状态提供一次性修复（下次合并时归位，或启动时自愈） |
| P0-2 | 更新/删除不进摘要（E4） | 条目增加 `updatedAt` 与 `deletedAt`（墓碑）；`memory_add/update/delete` 同时追加 `journal.jsonl` 变更事件；合并改读变更日志而不是 `entry.ts` 过滤；合并成功后推进 journal 游标 | 模拟「add→consolidate→update→consolidate」「add→consolidate→delete→consolidate」两条链路，最终摘要分别包含新内容、移除已删事实 |
| P0-3 | 合并重复消费/输入无界（E5） | `state.json` 增加 `rolloutCursor`（按 `sid + 块序号/内容哈希` 推进）；合并只送新块；对「新块总量」按字节/估算 token 封顶，超限时逐块取头部摘要；合并成功后推进游标并可归档旧块 | 连续两轮触发合并，同一 rollout 块不重复出现；合并输入字节 ≤ 可配置预算 |
| P0-4 | 写入无配额、参数不一致（E6） | 统一 `normalizeEntry`：`maxContentBytes`（建议默认 2000）、`maxTags=16`、单 tag ≤48 字符；`memory_update` 与 `memory_add` 走同一套校验；`raw_memories.md` 超过阈值触发归档压缩 | 超长 content/超量 tags 被明确拒绝或截断并提示；add/update 行为一致；raw 文件有界 |
| P0-5 | optional peer 与静态 import 矛盾（E8） | 二选一：a) 移除 optional 标记（插件依赖 dsh-llm/dsh-settings）；b) 改为顶层 `createRequire`/动态 import 并在缺包时降级为「仅注入+工具，无自动摘要」 | 在缺 `dsh-llm` 的环境加载插件不抛错（若选 b）；类型声明与实现同步 |
| P0-6 | 无回归保护（E10） | 引入 `node:test`：`parseRaw/serializeRaw` 往返、UTF-8 截断、版本解析、种子预算、journal 游标；用假 `ctx` 冒烟 `apply`；补 `npm test`、类型检查、最小 lint | `npm test` 全绿；每次合并/发布前 CI 可重跑 |

## 4. P1 优化：质量、观测与成本

| 编号 | 优化 | 说明 | 验收标准 |
| --- | --- | --- | --- |
| P1-1 | 搜索升级 | 解析缓存（mtime+size 指纹）；多关键词 AND/OR；`tags` 过滤参数；命中片段窗口与简单相关性（全词匹配、标签命中、新近度加权） | `memory_search` 千条 raw 下 <50ms；多词与标签过滤返回符合预期 |
| P1-2 | `AGENTS.md` 重同步 | 记录种子来源的文件哈希；提供 `memory_sync` 工具或设置项按需重导入；用户手改摘要与上游都变化时给出冲突提示而不是覆盖 | 修改 `AGENTS.md` 后一次调用完成同步；本地手改内容不无故丢失 |
| P1-3 | `memory_stats` 工具 | 输出 raw 条数/字节、摘要版本与字节、rollout 文件数、上次合并时间、journal 游标、队列深度 | 工具输出与实际文件系统状态一致 |
| P1-4 | LLM 预算与成本 | `maxTokens` 摘要/合并可配（现硬编码 600/1500）；可选独立便宜模型策略；失败重试一次；记录每次 LLM 调用的 provider/model/tokens/耗时/结果 | 配置后生效；日志可核算每日记忆维护成本 |
| P1-5 | 并发与队列硬化 | 摘要队列设上限与丢弃策略；`lastSummarized` Map 加清理（弱引用/上限）；多进程场景提供 lockfile（带 stale 检测）或明确单写者断言 | 高频多会话下队列不无限增长；异常重启后无死锁残留 |
| P1-6 | 摘要输出安全 | 行感知截断（不切断代码块/句子）；合并输出校验必须含 `# DSH memory` 与独立 `vN` 行，否则拒绝写入并保留旧版；保留最近 N 个版本便于回滚 | 用畸形 LLM 输出测试：旧摘要不被破坏，日志给出原因 |
| P1-7 | raw 归档与压缩 | 超阈值把旧条目转存 `archive/raw-YYYY-MM.md`，活动文件只保留近期窗口；解析入口仍可索引归档（可选） | 长期使用 raw 文件大小稳定；旧条目仍可 search/read |

## 5. P2 扩展方向

### 5.1 项目级作用域记忆（v2.0，最高价值）

现状所有会话共享一份全局记忆（与 Codex 一致）。DSH 多项目混用后，AstrBot、dsh-Plugin、
迁移脚本等事实会互相挤占 8KB 预算。建议：

- **作用域键**：`global` + `workspace`（当前工作目录规范化）+ 可选 `project`（最近 git 根或
  `projectRoot` 设置）。身份解析复用 `dsh-workspace`/session header，避免自行发明路径规则。
- **存储布局**：
  `memories/scopes/global/...` 与 `memories/scopes/ws-<hash>/...`，每作用域独立
  `memory_summary.md / raw_memories.md / rollout_summaries / state.json`。
- **注入预算拆分**：`maxBytes` 拆成 `globalMaxBytes + scopeMaxBytes`（默认 70/30 或 6KB/2KB），
  每次组装先全局后项目，总量仍受 `maxBytes` 约束。
- **工具参数**：`memory_add/update/search` 增加 `scope?: 'global' | 'workspace' | 'project'`，
  缺省为当前工作区；`memory_read` 返回两级摘要。
- **自动摘要归属**：rollout 块记录会话 `workspace/project`，合并只写对应作用域。
- **兼容性**：无 scope 参数时保持 v1 全局语义；首次升级把现有目录整体迁移为 `scopes/global`。

### 5.2 检索增强（v2.1）

- 先做零依赖 BM25/词项匹配；在 `memory_search` 输出 `score`、`scope`、`matchedOn`。
- 可选用 embedding provider（DSH 已有 pi-ai provider 体系），余弦检索 + 关键词兜底；索引放
  `$DSH_HOME/memories/index/`（SQLite 或 JSON），不引入服务端进程。
- 中文查询按现有 LLM 可用性可选「查询扩展」，但必须保留纯本地降级路径。

### 5.3 互操作与同步（v2.2）

- **Codex 互通**：读入 `~/.codex/memories/MEMORY.md + raw_memories.md + memory_summary.md`
  做首次迁移；导出 `memory_summary.md` 供 Codex 消费（保持 Markdown 可读格式）。
- **`AGENTS.md` 双向**：v1 只有 seed；后续支持差异化再导入与冲突提示（见 P1-2）。
- **MCP 服务器形态**：把同一套 MemoryStore 暴露为本地 MCP `memory_*` 工具，供 Codex/Claude
  等客户端共享；仅本地 stdio，默认不联网。
- **跨机同步**：可选 git 同步记忆目录。注意：任何远端推送都必须先向用户说明数据流向并取得
  明确同意（记忆内容含偏好与项目事实）。

### 5.4 记忆质量管理与生命周期（v2.3）

- 条目字段：`importance`、`sourceSession`、`contentHash`、`updatedAt`、`accessedAt`。
- 相似条目去重（先精确 hash，再按规范化文本做近重复合并）；合并提示词中给出去重候选。
- 长期未访问条目进入「待复核」，用 `memory_review` 工具批量确认保留/删除。
- TTL 与配额策略面向「机器可复用知识」设计，默认保守：不自动删，只提示。

### 5.5 界面与可观测性（v2.4）

- 设置命名空间已有，补 UI：浏览/编辑条目、标签视图、摘要版本 diff、合并历史、成本面板。
- 结构化事件日志：`memory.added/updated/deleted/summarized/consolidated`，失败带分类码。
- 摘要版本回滚：保留最近 N 版（如 20），界面一键回滚。

### 5.6 安全与隐私

- 注入前对疑似密钥/高熵串做提示（正则 + 熵检测），`memory_add` 拒绝或要求确认明显凭证。
- 记忆文件默认不离开本机；任何远端存储/同步需用户显式批准。
- 项目作用域配合权限预设：某些项目可设 `memoryReadOnly`。

## 6. 里程碑建议

| 版本 | 内容 | 完成判据 |
| --- | --- | --- |
| v1.1 硬化 | P0-1..P0-6 | 修复项有单测覆盖；E1/E2 现场状态被自愈或一次性修复；`npm test` 全绿；真实会话跑通 add→rollout→consolidate |
| v1.2 质量与观测 | P1-1..P1-7 | 搜索/统计工具可用；长期运行 raw 与队列有界；成本可观测 |
| v2.0 作用域 | 5.1 | 多工作区记忆互不污染；注入总量受控；升级迁移无损 |
| v2.1 检索 | 5.2 | 语义检索可用且有关键词兜底；索引重建安全 |
| v2.2 互操作 | 5.3 | Codex 迁移/导出、`AGENTS.md` 重同步、本地 MCP 形态可用 |
| v2.3/v2.4 | 5.4/5.5 | 生命周期管理与界面/回滚可用 |

## 7. 需要确认的决策点

1. **P0 完成后是否直接改运行中的安装副本并重启 DSH**（涉及当前会话记忆服务短暂中断）。
2. **项目作用域的注入比例**：全局/项目 70/30 是否合适，还是可配置 + 默认 80/20。
3. **embedding 提供商**：是否复用现有 Aliyun MaaS 视觉同款端点，还是纯本地关键词优先。
4. **MCP 暴露范围**：哪些客户端/项目允许访问 `memory_*` 工具。
5. **是否启用 git 或其他跨机同步**：涉及记忆内容外发，需要单独风险评估与批准。

## 8. 参考

- `docs/DESIGN.md`：机制对照、关键接口、并发与失败模式。
- `README.zh.md`：安装与配置。
- 行号引用基于仓库 `lib/index.js` @ `43cea35`。
