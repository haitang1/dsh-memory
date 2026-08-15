import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { memorySettingsRouteHandler } from '../lib/web.js'

/** Minimal server-response fake capturing the status, headers, and JSON body. */
function fakeResponse() {
  const res = {
    headers: {},
    status: 0,
    ended: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value },
    writeHead(status) { this.status = status },
    end(body) { this.ended = Buffer.isBuffer(body) ? body.toString('utf8') : String(body) }
  }
  return res
}

function fakeRequest(method, body, headers = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(body)])
  req.method = method
  req.headers = headers
  return req
}

function fakeSettings() {
  const calls = []
  const settings = {
    writable: true,
    value: { maxBytes: 8000, autoSummarize: true, consolidateEvery: 3, seedFromAgentsMd: true },
    revision: 7,
    describe() {
      return [{ ns: 'memory', value: settings.value, revision: settings.revision }]
    },
    async replace(ns, section, expectedRevision) {
      calls.push({ ns, section, expectedRevision })
      settings.value = section
      settings.revision += 1
    }
  }
  return { settings, calls }
}

const fakeCtx = { logger: { warn: () => {} } }

test('GET returns the memory settings snapshot', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('GET'), res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.settings.value.maxBytes, 8000)
  assert.equal(payload.value.settings.revision, 7)
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('POST saves the section and returns the updated snapshot', async () => {
  const { settings, calls } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  const body = JSON.stringify({ action: 'save', expectedRevision: 7, value: { maxBytes: 4000, autoSummarize: false, consolidateEvery: 5, seedFromAgentsMd: false } })
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 200)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, true)
  assert.equal(payload.value.settings.value.maxBytes, 4000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].ns, 'memory')
  assert.equal(calls[0].expectedRevision, 7)
})

test('POST rejects a cross-site origin', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('POST', '{}', { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }), res)
  assert.equal(res.status, 403)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'origin-rejected')
})

test('POST maps a settings conflict to 409', async () => {
  const { settings } = fakeSettings()
  const conflict = new Error('moved')
  conflict.code = 'SETTINGS_CONFLICT'
  settings.replace = async () => { throw conflict }
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  const body = JSON.stringify({ action: 'save', expectedRevision: 7, value: { maxBytes: 4000 } })
  await handler(fakeRequest('POST', body, { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 409)
  const payload = JSON.parse(res.ended)
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, 'settings-conflict')
})

test('unsupported POST actions are rejected', async () => {
  const { settings } = fakeSettings()
  const handler = memorySettingsRouteHandler(fakeCtx, settings)
  const res = fakeResponse()
  await handler(fakeRequest('POST', JSON.stringify({ action: 'explode' }), { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' }), res)
  assert.equal(res.status, 400)
  assert.equal(JSON.parse(res.ended).error.code, 'invalid-request')
})

test('client bundle registers the settings.plugin.item card', () => {
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.match(source, /__ModuleLoader__\.load\(\{\s*id: '@dsh-external\/dsh-memory'/)
  assert.match(source, /exports\.inject = \['slots'\]/)
  assert.match(source, /settings\.plugin\.item/)
  assert.match(source, /id: 'memory'/)
  assert.match(source, /function apply\(ctx\)/)
  assert.match(source, /_dsh\/memory\/settings/)
})
