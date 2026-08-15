import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../lib/store.js'

async function startFakeEmbeddingServer(t) {
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const payload = JSON.parse(body)
      const data = payload.input.map((text, index) => {
        let embedding = [0, 0, 1]
        if (String(text).includes('restart') && String(text).includes('project')) embedding = [1, 0, 0]
        else if (String(text).includes('deployment') && String(text).includes('restart')) embedding = [0.8, 0.2, 0]
        return { index, embedding }
      })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data, model: payload.model }))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  return `http://127.0.0.1:${address.port}`
}

test('remote embedding search merges with lexical ranking', async (t) => {
  const baseURL = await startFakeEmbeddingServer(t)
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-embed-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const store = new MemoryStore(dir)
  await store.appendRawEntry({ content: 'deployment restart service', tags: [] })
  await store.appendRawEntry({ content: 'cooking pasta recipe', tags: [] })
  const hits = await store.searchRaw('restart project service', {
    mode: 'all',
    vector: true,
    fuzzy: false,
    embedding: { baseURL, model: 'fake-embed', apiKey: 'test-key' }
  })
  assert.equal(hits.length >= 1, true)
  assert.equal(hits[0].entry.content, 'deployment restart service')
})
