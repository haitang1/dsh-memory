// dsh-memory automation support: the auto-memory skill definition and the
// summarization model-route resolver. Kept dependency-free (no harness
// imports) so both can be unit-tested without the deployment packages.

/** Runtime skill guiding agents to proactively maintain and query memory. */
export const AUTO_MEMORY_SKILL = {
  name: 'auto-memory',
  description: '自动识别对话中的关键信息并写入长期记忆，在需要时主动检索记忆。',
  whenToUse: '对话出现用户偏好、项目决策、命名约定、错误修复等可复用事实；或回答需要依赖之前会话的历史细节时。',
  source: 'runtime',
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

/** Per-entry character cap for one tool digest line. */
export const TOOL_DIGEST_ENTRY_CHARS = 240
/** Total character cap for the tool-activity block appended to one turn. */
export const TOOL_DIGEST_MAX_CHARS = 4000

/** Collapse whitespace so one digest entry stays a single readable line. */
function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim()
}

/** Truncate on characters, marking the cut. */
function clip(value, max) {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

/**
 * Whether one code point is written with roughly one token per character.
 *
 * CJK text is the reason a byte budget is route-dependent: a Chinese summary
 * of N bytes is ~N/3 tokens while an English one is ~N/4, and both differ from
 * the "1 token ≈ 4 chars" rule a Latin-only estimator assumes. This ranges over
 * the ideographic, kana, hangul, and fullwidth blocks.
 * @param codePoint - the code point to classify.
 * @returns whether it counts as one token per character.
 */
function isWideTokenChar(codePoint) {
  return (codePoint >= 0x2E80 && codePoint <= 0x303F) ||
    (codePoint >= 0x3040 && codePoint <= 0x30FF) ||
    (codePoint >= 0x3400 && codePoint <= 0x4DBF) ||
    (codePoint >= 0x4E00 && codePoint <= 0x9FFF) ||
    (codePoint >= 0xAC00 && codePoint <= 0xD7AF) ||
    (codePoint >= 0xF900 && codePoint <= 0xFAFF) ||
    (codePoint >= 0xFF00 && codePoint <= 0xFFEF) ||
    (codePoint >= 0x20000 && codePoint <= 0x2FA1F)
}

/**
 * Estimate the token cost of a memory blob without any provider call.
 *
 * This is deliberately the coarse "wide characters cost about one token, the
 * rest about a quarter" rule that tokenizers approximate, not a real BPE count:
 * it exists to bound an injected blob by tokens instead of bytes, and a cheap
 * deterministic estimate is enough for a budget.
 * @param text - the text to price.
 * @returns the estimated token count.
 */
export function estimateTokens(text) {
  let tokens = 0
  for (const character of String(text)) {
    tokens += isWideTokenChar(character.codePointAt(0)) ? 1 : 0.25
  }
  return Math.ceil(tokens)
}

/**
 * Trim text to an estimated token budget, preferring a line boundary.
 * @param text - the text to trim.
 * @param maxTokens - the budget; zero or less yields an empty string.
 * @returns the trimmed text.
 */
export function truncateToTokens(text, maxTokens) {
  const source = String(text)
  if (!(maxTokens > 0)) return ''
  const characters = [...source]
  let tokens = 0
  let end = 0
  for (let index = 0; index < characters.length; index += 1) {
    const cost = isWideTokenChar(characters[index].codePointAt(0)) ? 1 : 0.25
    if (tokens + cost > maxTokens) break
    tokens += cost
    end = index + 1
  }
  if (end >= characters.length) return source
  let cut = characters.slice(0, end).join('')
  // Cutting mid-line leaves a dangling fragment; back up to the previous
  // newline as long as that keeps most of the budget.
  const newline = cut.lastIndexOf('\n')
  if (newline > cut.length * 0.5) cut = cut.slice(0, newline)
  return cut
}

/**
 * One-line digest of a `tool/call` event (`{turn, step, callId, name, arguments}`).
 *
 * Tool calls carry what the agent actually did — the command, the path, the
 * query — and that is exactly the durable knowledge a distilled memory wants
 * ("how was this verified"). `arguments` is the raw JSON string the model
 * produced, so this only flattens and bounds it.
 * @param data - the event's `data` field.
 * @returns one digest line, or an empty string when there is nothing to report.
 */
export function formatToolCall(data) {
  if (data === null || typeof data !== 'object') return ''
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  if (name.length === 0) return ''
  const args = oneLine(data.arguments === undefined ? '' : data.arguments)
  return args.length === 0
    ? `[tool] ${name}`
    : `[tool] ${name} ${clip(args, TOOL_DIGEST_ENTRY_CHARS)}`
}

/**
 * One-line digest of a `tool/result` event (`{turn, step, message, error?}`).
 *
 * Failures name the reason the harness recorded outside the model-facing
 * content; successes report the first text block, which is where a test run or
 * a command's outcome lands.
 * @param data - the event's `data` field.
 * @returns one digest line, or an empty string when there is nothing to report.
 */
export function formatToolResult(data) {
  if (data === null || typeof data !== 'object') return ''
  const message = data.message !== null && typeof data.message === 'object' ? data.message : undefined
  const error = data.error !== null && typeof data.error === 'object' ? data.error : undefined
  const failed = error !== undefined || (message !== undefined && message.isError === true)
  const text = extractMessageText(message === undefined ? undefined : { message })
  const reason = error !== undefined && typeof error.reason === 'string' && error.reason.length > 0
    ? oneLine(error.reason)
    : oneLine(text)
  const status = failed ? 'error' : 'ok'
  return reason.length === 0
    ? `[tool result] ${status}`
    : `[tool result] ${status}: ${clip(reason, TOOL_DIGEST_ENTRY_CHARS)}`
}

/** Characters kept from one settled subagent's final answer. */
export const SUBAGENT_EXCERPT_CHARS = 2000/** Below this length a child's output carries no durable fact worth a block. */
export const SUBAGENT_EXCERPT_MIN_CHARS = 80

/**
 * Bound one settled subagent's final answer into a rollout block body.
 *
 * Delegated work is the densest durable content a session produces, and it
 * never reaches the summarizer today: distillation is driven by
 * `agent/turn-stopping` for root sessions only. This is deliberately a plain
 * bounded excerpt rather than another LLM call — the periodic consolidation
 * already reads rollout blocks and distills them, so capturing costs one file
 * append and no extra model call.
 * @param info - the `subagent/end` payload (or a subset).
 * @returns the excerpt body, or an empty string when nothing is worth keeping.
 */
export function formatSubagentResult(info) {
  if (info === null || typeof info !== 'object') return ''
  const blocks = info.lastAssistantMessage
  if (!Array.isArray(blocks) || blocks.length === 0) return ''
  const text = extractMessageText({ message: { content: blocks } }).trim()
  if (text.length < SUBAGENT_EXCERPT_MIN_CHARS) return ''
  const reason = typeof info.stopReason === 'string' && info.stopReason.length > 0 ? ` (${info.stopReason})` : ''
  return `[subagent result${reason}]\n${clip(text, SUBAGENT_EXCERPT_CHARS)}`
}

/**
 * Extract concatenated text-block content from one session message event.
 *
 * DSH stores the two message event types asymmetrically:
 * - `user/message`: `event.data` IS the message record (`{id, role, source, content}`)
 * - `assistant/message`: the message record nests at `event.data.message`
 * (`{message: {id, role, source, content}, turn, step}`)
 * Reading `event.data.content` alone silently drops every assistant reply.
 * This helper unwraps the nested record, so turn distillation sees the full
 * conversation instead of only the user prompts.
 * @param data - the event's `data` field.
 * @returns concatenated plain-text blocks, each followed by a newline.
 */
export function extractMessageText(data) {
  const record = data !== null && typeof data === 'object' && data.message !== null && typeof data.message === 'object'
    ? data.message
    : data
  const content = Array.isArray(record && record.content) ? record.content : []
  let text = ''
  for (const block of content) {
    if (block !== null && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string') {
      text += block.text + '\n'
    }
  }
  return text
}

/**
 * Read one settings namespace from whichever settings seam the host exposes.
 *
 * DSH <= 0.1.5 providers answer `get(ns)`. DSH 0.1.7-rc.1 replaced the provider
 * (SettingsProvider -> SettingsForms) and dropped `get()`: the current value is
 * only reachable through the descriptors returned by `describe()`.
 * @param settings - the settings service face.
 * @param ns - the namespace to read.
 * @returns the namespace value, or undefined when it is not registered.
 */
function readSettingsNamespace(settings, ns) {
  if (typeof settings.get === 'function') return settings.get(ns)
  const rows = typeof settings.describe === 'function' ? settings.describe() : []
  return rows.find((row) => String(row.ns) === ns)?.value
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
    const raw = deps.settings !== undefined ? readSettingsNamespace(deps.settings, 'agent-default-model') : undefined
    if (raw !== undefined && typeof raw.provider === 'string' && raw.provider.length > 0 && typeof raw.model === 'string' && raw.model.length > 0) {
      return { provider: raw.provider, model: raw.model }
    }
  } catch {
    // no settings-backed route either
  }
  return undefined
}
