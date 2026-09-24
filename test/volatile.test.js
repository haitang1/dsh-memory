import test from 'node:test'
import assert from 'node:assert/strict'
import { isVolatileValue, plainConfig, unboxConfigValue, volatileField } from '../lib/volatile.js'

/** A cosmokit-shaped Volatile box: `get()` plus the globally registered write hook. */
function volatileBox(value) {
  const box = { get: () => value }
  box[Symbol.for('cosmokit.volatile.write')] = () => {}
  return box
}

test('volatileField marks a field when the schema library supports it', () => {
  let marked = 0
  const field = { volatile: () => { marked += 1; return { volatile: true } } }
  assert.deepEqual(volatileField(field), { volatile: true })
  assert.equal(marked, 1, 'the field must be marked through Schema#volatile()')
})

test('volatileField leaves the field alone when Schema#volatile is absent (DSH 0.1.5 line)', () => {
  // schemastery 3.18.2 (the 0.1.5 line) has no Schema#volatile(): an unconditional
  // call would throw at module load and take the whole plugin down.
  const field = { type: 'string' }
  assert.equal(volatileField(field), field)
  assert.equal(volatileField(undefined), undefined)
})

test('isVolatileValue recognizes a box by its globally registered write hook', () => {
  assert.equal(isVolatileValue(volatileBox(1)), true)
  assert.equal(isVolatileValue(1), false)
  assert.equal(isVolatileValue('x'), false)
  assert.equal(isVolatileValue(null), false)
  assert.equal(isVolatileValue(undefined), false)
  assert.equal(isVolatileValue(['a']), false)
  assert.equal(isVolatileValue({ get: () => 1 }), false, 'a bare get() is not a Volatile box')
})

test('unboxConfigValue reads a box and passes plain values through', () => {
  assert.equal(unboxConfigValue(volatileBox(7)), 7)
  assert.deepEqual(unboxConfigValue(volatileBox(['a', 'b'])), ['a', 'b'])
  assert.equal(unboxConfigValue('plain'), 'plain')
  assert.equal(unboxConfigValue(0), 0)
  assert.equal(unboxConfigValue(false), false)
})

test('plainConfig unboxes a whole resolved config record', () => {
  const config = {
    maxBytes: volatileBox(4096),
    autoSummarize: volatileBox(false),
    readOnlyScopes: volatileBox(['/a']),
    summarizeModel: 'deepseek-v4' // a non-volatile field stays a plain value
  }
  assert.deepEqual(plainConfig(config), {
    maxBytes: 4096,
    autoSummarize: false,
    readOnlyScopes: ['/a'],
    summarizeModel: 'deepseek-v4'
  })
})

test('plainConfig tolerates a non-record config', () => {
  assert.deepEqual(plainConfig(undefined), {})
  assert.deepEqual(plainConfig(null), {})
  assert.deepEqual(plainConfig('nope'), {})
})

test('plainConfig re-reads a mutated box, which is how a 0.1.7 settings save lands', () => {
  // The Loader's volatile commit mutates the box in place rather than re-applying
  // the plugin, so a second read must see the new value.
  let current = 1000
  const box = { get: () => current }
  box[Symbol.for('cosmokit.volatile.write')] = () => {}
  const config = { maxBytes: box }
  assert.equal(plainConfig(config).maxBytes, 1000)
  current = 2000
  assert.equal(plainConfig(config).maxBytes, 2000)
})

test('volatileField + plainConfig round-trip a real schemastery schema', async (t) => {
  let z
  try {
    z = (await import('@deepseek-ai/schemastery')).default
  } catch {
    t.skip('schemastery not resolvable here')
    return
  }
  if (typeof z.string().volatile !== 'function') {
    t.skip('schemastery without Schema#volatile (the DSH 0.1.5 line)')
    return
  }
  const plain = z.object({ a: z.number().default(1), b: z.string().default('x') })
  const marked = z.object(Object.fromEntries(
    Object.entries(plain.dict).map(([key, field]) => [key, volatileField(field)])
  ))
  const resolved = marked({ a: 7 })
  assert.equal(isVolatileValue(resolved.a), true, 'a volatile field resolves to a box')
  assert.equal(isVolatileValue(resolved.b), true)
  assert.equal(plainConfig(resolved).a, 7)
  // Defaults must survive the marking, since the schema is also the settings form.
  assert.equal(plainConfig(marked({})).b, 'x')
})
