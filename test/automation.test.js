import test from 'node:test'
import assert from 'node:assert/strict'
import { AUTO_MEMORY_SKILL, resolveSummarizeRoute } from '../lib/automation.js'

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
