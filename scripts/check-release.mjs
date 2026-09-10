#!/usr/bin/env node
// Release consistency check (zero dependencies; node builtins only).
//
// Verifies that the version and test-count claims in the prose stay in sync
// with the code:
//   1. package.json version
//   2. CHANGELOG.md newest "## <version>" heading
//   3. README.md "Current release: **<version>**" and README.zh.md "当前版本：**<version>**"
//   4. the test count declared in both READMEs ("runs N tests" / "运行 N 项测试")
//      vs the actual "# tests N" summary of the package.json test script
//
// The README test-count line format is a contract for this script; if either
// wording changes, update both the README and this script together.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// fileURLToPath, not URL.pathname: on Windows the latter yields "/E:/…", which
// path.join turns into a drive-relative "E:\E:\…" and the check cannot run.
const root = fileURLToPath(new URL('..', import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version

let failed = false
function fail(what, expected, actual) {
  failed = true
  console.error(`[check-release] ${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function read(name) {
  return readFileSync(join(root, name), 'utf8')
}

// 1. CHANGELOG newest heading.
const changelog = read('CHANGELOG.md')
const changelogMatch = changelog.match(/^##\s+(\S+)/m)
if (changelogMatch === null) {
  fail('CHANGELOG.md newest version heading', version, '(no "## <version>" heading found)')
} else if (changelogMatch[1] !== version) {
  fail('CHANGELOG.md newest version heading', version, changelogMatch[1])
}

// 2. README version claims.
const readmeEn = read('README.md')
const readmeZh = read('README.zh.md')
const enVersion = readmeEn.match(/Current release:\s*\*\*(\d+\.\d+\.\d+)\*\*/)
const zhVersion = readmeZh.match(/当前版本：\s*\*\*(\d+\.\d+\.\d+)\*\*/)
if (enVersion === null) {
  fail('README.md "Current release: **X**"', version, '(pattern not found)')
} else if (enVersion[1] !== version) {
  fail('README.md current release', version, enVersion[1])
}
if (zhVersion === null) {
  fail('README.zh.md "当前版本：**X**"', version, '(pattern not found)')
} else if (zhVersion[1] !== version) {
  fail('README.zh.md current release', version, zhVersion[1])
}

// 3. Test-count claims vs the actual suite summary.
const enCount = readmeEn.match(/runs\s+(\d+)\s+tests/)
const zhCount = readmeZh.match(/运行\s+(\d+)\s+项测试/)
if (enCount === null || zhCount === null) {
  fail('README test-count pattern', '"runs N tests" and "运行 N 项测试"', `${enCount === null ? 'en missing' : 'ok'} / ${zhCount === null ? 'zh missing' : 'ok'}`)
}
const declared = enCount !== null ? enCount[1] : zhCount !== null ? zhCount[1] : null
if (enCount !== null && zhCount !== null && enCount[1] !== zhCount[1]) {
  fail('README test counts agree', enCount[1], zhCount[1])
}

const testScript = pkg.scripts && pkg.scripts.test
if (typeof testScript !== 'string') {
  fail('package.json scripts.test', 'a "node --test ..." command', '(missing)')
} else {
  const files = testScript.replace(/^node\s+--test\s*/, '').trim().split(/\s+/).filter(Boolean)
  if (files.length === 0) {
    fail('scripts.test file list', 'at least one test file', '(none)')
  }
  const result = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8', cwd: root })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const summary = output.match(/#\s*tests\s+(\d+)/)
  if (summary === null) {
    fail('actual test summary ("# tests N")', 'a parseable summary', '(nothing matched; run npm test manually)')
  } else if (declared !== null && summary[1] !== declared) {
    fail('README declared test count', declared, summary[1])
  }
}

if (failed) {
  console.error('[check-release] FAILED: release docs are out of sync — fix the mismatch above (see scripts/check-release.mjs).')
  process.exit(1)
}
console.log(`[check-release] OK: version ${version}, ${declared} tests declared and verified.`)
