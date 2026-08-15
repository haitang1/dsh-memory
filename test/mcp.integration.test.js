import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

async function startServer(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-memory-mcp-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const child = spawn(process.execPath, [join(repoRoot, 'bin', 'dsh-memory-mcp.mjs')], {
    env: { ...process.env, DSH_MEMORY_DIR: dir, DSH_MEMORY_REDACT: '1' },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  t.after(() => child.kill())
  const pending = new Map()
  let buffer = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line.length === 0) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const waiter = pending.get(message.id)
      if (waiter !== undefined) {
        pending.delete(message.id)
        message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result)
      }
    }
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
  return { dir, child, rpc, getStderr: () => stderr }
}

test('standalone MCP server exposes memory tools over stdio', async (t) => {
  const server = await startServer(t)
  const init = await server.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {} })
  assert.equal(init.serverInfo.name, 'dsh-memory')
  server.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  const list = await server.rpc('tools/list')
  assert.equal(list.tools.length, 9)
  assert.equal(list.tools.some((tool) => tool.name === 'memory_add'), true)
  const added = await server.rpc('tools/call', { name: 'memory_add', arguments: { content: 'mcp fact alpha', tags: ['mcp'] } })
  assert.equal(added.content[0].type, 'text')
  const addValue = JSON.parse(added.content[0].text)
  assert.equal(addValue.duplicate, false)
  const search = await server.rpc('tools/call', { name: 'memory_search', arguments: { query: 'alpha', mode: 'all' } })
  const searchValue = JSON.parse(search.content[0].text)
  assert.equal(searchValue.matches.length, 1)
  assert.equal(searchValue.matches[0].content, 'mcp fact alpha')
})
