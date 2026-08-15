import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBrowserSnapshot, renderMemoryHtml } from '../lib/browser.js'

test('renderMemoryHtml embeds a scope snapshot and escapes HTML', () => {
  const snapshot = buildBrowserSnapshot({
    memoryDir: 'C:/memories',
    generatedAt: '2026-08-15T10:00:00.000Z',
    scopes: [{
      key: 'global',
      summary: '# DSH memory\n\nv2\n\n## Facts\n\n- <script>alert(1)</script>\n',
      raw: [{ id: 'mem-1', ts: '2026-08-15 10:00', content: 'fact <b>one</b>', tags: ['a'], importance: 2 }],
      history: [{ version: 1, file: '1.123.md', mtime: 0, bytes: 10 }]
    }]
  })
  const html = renderMemoryHtml(snapshot)
  assert.equal(html.includes('const SNAPSHOT = '), true)
  assert.equal(html.includes('fact <b>one</b>'), false)
  assert.equal(html.includes('\\u003cb>one\\u003c/b>'), true)
  assert.equal(html.includes('dsh-memory browser'), true)
})
