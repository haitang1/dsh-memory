import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { AUTO_MEMORY_SKILL, extractMessageText, resolveSummarizeRoute } from '../lib/automation.js'

function resolved(overrides = {}) {
  return {
    summarizeProvider: '',
    summarizeModel: '',
    ...overrides
  }
}

test('resolveSummarizeRoute prefers explicit provider/model config', () => {
  const route = resolveSummarizeRoute(resolved({ summarizeProvider: 'p', summarizeModel: 'm' }), {
    agentDefaultModel: { currentSelection: () => ({ provider: 'other', model: 'other' }) },
    settings: { get: () => ({ provider: 's', model: 's' }) }
  })
  assert.deepEqual(route, { provider: 'p', model: 'm' })
})

test('resolveSummarizeRoute falls back to the agentDefaultModel service', () => {
  const route = resolveSummarizeRoute(resolved(), {
    agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) },
    settings: { get: () => ({ provider: 's', model: 's' }) }
  })
  assert.deepEqual(route, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
})

test('resolveSummarizeRoute ignores a throwing agentDefaultModel service', () => {
  const route = resolveSummarizeRoute(resolved(), {
    agentDefaultModel: { currentSelection: () => { throw new Error('agent-scoped') } },
    settings: { get: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) }
  })
  assert.deepEqual(route, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
})

test('resolveSummarizeRoute falls back to the agent-default-model settings namespace', () => {
  const route = resolveSummarizeRoute(resolved(), {
    agentDefaultModel: undefined,
    settings: { get: (ns) => (ns === 'agent-default-model' ? { provider: 'deepseek-official', model: 'deepseek-v4-flash', reasoningEffort: 'max' } : undefined) }
  })
  assert.deepEqual(route, { provider: 'deepseek-official', model: 'deepseek-v4-flash' })
})

test('resolveSummarizeRoute returns undefined when no route is available', () => {
  assert.equal(resolveSummarizeRoute(resolved(), { agentDefaultModel: undefined, settings: undefined }), undefined)
  assert.equal(resolveSummarizeRoute(resolved(), { agentDefaultModel: { currentSelection: () => undefined }, settings: { get: () => undefined } }), undefined)
})

test('extractMessageText reads user/message data.content directly', () => {
  const data = { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }, { type: 'text', text: '世界' }] }
  assert.equal(extractMessageText(data), '你好\n世界\n')
})

test('extractMessageText unwraps assistant/message data.message nesting', () => {
  // Regression: assistant/message stores the message record at data.message;
  // reading data.content alone silently dropped every assistant reply.
  const data = {
    turn: 1,
    step: 2,
    message: { id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'text', text: '回复内容' }] }
  }
  assert.equal(extractMessageText(data), '回复内容\n')
})

test('extractMessageText ignores tool-call blocks and malformed data', () => {
  const data = {
    message: { id: 'a2', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [{ type: 'tool-call', id: 'c1' }, { type: 'text', text: 'only text' }] }
  }
  assert.equal(extractMessageText(data), 'only text\n')
  assert.equal(extractMessageText(undefined), '')
  assert.equal(extractMessageText(null), '')
  assert.equal(extractMessageText('not-an-object'), '')
  assert.equal(extractMessageText({ content: 'not-an-array' }), '')
})

test('AUTO_MEMORY_SKILL advertises proactive memory behavior', () => {
  assert.equal(AUTO_MEMORY_SKILL.name, 'auto-memory')
  assert.equal(typeof AUTO_MEMORY_SKILL.description, 'string')
  assert.ok(AUTO_MEMORY_SKILL.description.includes('自动'))
  assert.equal(typeof AUTO_MEMORY_SKILL.whenToUse, 'string')
  const content = AUTO_MEMORY_SKILL.content
  assert.ok(content.includes('memory_add'))
  assert.ok(content.includes('memory_search'))
  assert.ok(content.includes('memory_update'))
  assert.ok(content.includes('memory_delete'))
  assert.ok(content.includes('memory_read'))
  assert.ok(content.includes('何时写入'))
  assert.ok(content.includes('何时读取'))
  assert.ok(content.includes('tags'))
})

test('server entry retains the runtime definitions required by apply', async () => {
  const source = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')

  assert.match(source, /export const Config = z\.object\(/)
  assert.match(source, /summarizeDebounceMs: z\.number\(\)\.step\(1\)\.min\(0\)\.default\(DEFAULT_SUMMARIZE_DEBOUNCE_MS\)/)
  for (const name of ['resolveConfig', 'dshHome', 'isRootSession', 'extractTurnText', 'journalChangeText']) {
    assert.match(source, new RegExp(`function ${name}\\b`), `${name} must remain defined in the server entry`)
  }
  for (const name of ['MIN_TURN_BYTES', 'MAX_TURN_INPUT_BYTES', 'DEFAULT_SUMMARIZE_DEBOUNCE_MS', 'CONSOLIDATE_INTERVAL_MS', 'LLM_TIMEOUT_MS', 'MAX_ROLLOUT_FILES']) {
    assert.match(source, new RegExp(`const ${name}\\b`), `${name} must remain defined in the server entry`)
  }
})
