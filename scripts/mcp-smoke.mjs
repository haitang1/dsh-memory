#!/usr/bin/env node
// Smoke-test an installed dsh-memory MCP server over stdio.
//
// Usage:
//   node scripts/mcp-smoke.mjs [binPath] [memoryDir]
//
// Defaults:
//   binPath  ~/.dsh/profiles/web/node_modules/@dsh-external/dsh-memory/bin/dsh-memory-mcp.mjs
//   memoryDir is a fresh temporary directory
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'

const bin = process.argv[2] || join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', '@dsh-external', 'dsh-memory', 'bin', 'dsh-memory-mcp.mjs')
const dir = process.argv[3] || await mkdtemp(join(tmpdir(), 'dsh-memory-mcp-smoke-'))
const child = spawn(process.execPath, [bin], {
  env: { ...process.env, DSH_MEMORY_DIR: dir },
  stdio: ['pipe', 'pipe', 'pipe']
})
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
    if (!line) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    const waiter = pending.get(message.id)
    if (waiter !== undefined) {
      pending.delete(message.id)
      message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result)
    }
  }
})
const rpc = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++
  pending.set(id, { resolve, reject })
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
})
try {
  const init = await rpc('initialize')
  const list = await rpc('tools/list')
  const add = await rpc('tools/call', { name: 'memory_add', arguments: { content: 'mcp smoke fact', tags: ['smoke'] } })
  const search = await rpc('tools/call', { name: 'memory_search', arguments: { query: 'smoke fact', mode: 'all' } })
  const addValue = JSON.parse(add.content[0].text)
  const searchValue = JSON.parse(search.content[0].text)
  console.log(`server=${init.serverInfo.name} version=${init.serverInfo.version} tools=${list.tools.length}`)
  console.log(`addDuplicate=${addValue.duplicate} searchHits=${searchValue.matches.length}`)
  if (init.serverInfo.name !== 'dsh-memory' || list.tools.length !== 9 || searchValue.matches.length !== 1) process.exitCode = 2
} finally {
  child.kill()
  await rm(dir, { recursive: true, force: true })
}
