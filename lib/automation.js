// dsh-memory automation support: the auto-memory skill definition and the
// summarization model-route resolver. Kept dependency-free (no harness
// imports) so both can be unit-tested without the deployment packages.

/** Runtime skill guiding agents to proactively maintain and query memory. */
export const AUTO_MEMORY_SKILL = {
  name: 'auto-memory',
  description: '自动识别对话中的关键信息并写入长期记忆，在需要时主动检索记忆。',
  whenToUse: '对话出现用户偏好、项目决策、命名约定、错误修复等可复用事实；或回答需要依赖之前会话的历史细节时。',
  content: [
    '# auto-memory（自动记忆）',
    '',
    '本技能指导你在对话中自动维护 dsh-memory 长期记忆：识别值得记住的内容并主动写入，在需要时主动检索。',
    '',
    '## 何时写入（识别关键信息）',
    '当对话中出现以下任何一类内容时，主动调用 memory_add 保存：',
    '- 用户的明确偏好、习惯或要求（回复语言、命名风格、工具选择等）',
    '- 项目/任务的决策及其原因（选择了某方案、放弃了某方案）',
    '- 命名与约定（目录结构、命名规范、端口、命令、流程）',
    '- 错误与修复（踩过的坑与解决办法）',
    '- 可复用的环境或项目事实（路径、依赖、配置）',
    '',
    '不要记忆：寒暄、临时任务指令、与长期知识无关的过程细节。',
    '',
    '## 如何写入',
    '- 每条 memory_add 只写一个事实，用具体、可复用的一句话陈述；不写提问句或寒暄句',
    '- 用 tags 归类：preference（偏好）、decision（决策）、convention（约定）、fix（修复）、fact（事实）、project（项目）',
    '- 写入前用 memory_search 查同一主题，避免重复；重复时用 memory_update 更新已有条目',
    '- 同一会话中同一主题只写一次，不要反复写入',
    '- 默认作用域 global；仅与当前工作区/项目相关的内容用 workspace/project 作用域',
    '',
    '## 何时读取（主动检索）',
    '- 任务涉及用户/项目的历史、偏好或之前会话的内容时，先 memory_search 按主题关键词检索相关条目',
    '- 需要全局背景时用 memory_read 查看记忆摘要（系统提示中通常已自动注入摘要）',
    '- 引用记忆内容时说明来源，例如「根据记忆：…」',
    '',
    '## 修正记忆',
    '- 记忆过时或错误时：memory_update 更新内容；memory_delete 删除无效条目',
    '- 记忆与当前事实冲突时，以用户最新确认为准，并更新记忆'
  ].join('\n')
}

/**
 * Resolve the model route for automatic summarization. Priority:
 * 1. explicit summarizeProvider/summarizeModel config;
 * 2. the agentDefaultModel service's current selection (agent-scoped, may be
 *    unavailable from a host-level context);
 * 3. the deployment's `agent-default-model` settings namespace directly.
 * @param resolved - resolved plugin config.
 * @param deps - optional service accessors (`agentDefaultModel`, `settings`).
 * @returns the route, or undefined when no model is resolvable.
 */
export function resolveSummarizeRoute(resolved, deps = {}) {
  if (resolved.summarizeProvider.length > 0 && resolved.summarizeModel.length > 0) {
    return { provider: resolved.summarizeProvider, model: resolved.summarizeModel }
  }
  try {
    const selection = deps.agentDefaultModel !== undefined ? deps.agentDefaultModel.currentSelection() : undefined
    if (selection !== undefined && selection.provider && selection.model) {
      return { provider: selection.provider, model: selection.model }
    }
  } catch {
    // fall through to the settings-backed route
  }
  try {
    const raw = deps.settings !== undefined ? deps.settings.get('agent-default-model') : undefined
    if (raw !== undefined && typeof raw.provider === 'string' && raw.provider.length > 0 && typeof raw.model === 'string' && raw.model.length > 0) {
      return { provider: raw.provider, model: raw.model }
    }
  } catch {
    // no settings-backed route either
  }
  return undefined
}
