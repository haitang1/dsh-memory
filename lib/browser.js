// Dependency-free memory browser renderer.
//
// `renderMemoryHtml` returns one self-contained HTML file with the snapshot
// embedded as JSON. No build step and no external assets; the page supports
// scope switching, keyword filtering, importance badges, and summary/history
// inspection in any modern browser.

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function renderMemoryHtml(snapshot) {
  const embedded = JSON.stringify(snapshot ?? { scopes: [] }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dsh-memory browser</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; background: #f6f7f9; color: #1f2328; }
  header { padding: 16px 24px; background: #24292f; color: #fff; }
  main { padding: 16px 24px; max-width: 1100px; margin: 0 auto; }
  .toolbar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  select, input { padding: 8px 10px; font-size: 14px; border: 1px solid #d0d7de; border-radius: 6px; background: #fff; }
  input { flex: 1; min-width: 220px; }
  section { background: #fff; border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; }
  h2 { margin: 8px 0; font-size: 18px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eaeef2; vertical-align: top; }
  th { position: sticky; top: 0; background: #fff; }
  code, pre { white-space: pre-wrap; word-break: break-word; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 12px; background: #ddf4ff; color: #0969da; }
  .muted { color: #57606a; font-size: 12px; }
  .history { list-style: none; padding: 0; }
  .history li { padding: 6px 0; border-bottom: 1px dashed #eaeef2; }
</style>
</head>
<body>
<header><h1>dsh-memory browser</h1><div class="muted" id="generated"></div></header>
<main>
  <div class="toolbar">
    <label>scope</label>
    <select id="scope"></select>
    <input id="filter" placeholder="filter raw entries (content, id, tags)">
  </div>
  <section><h2>summary</h2><pre id="summary"></pre></section>
  <section><h2>raw entries</h2><div id="raw"></div></section>
  <section><h2>history</h2><ul class="history" id="history"></ul></section>
</main>
<script>
const SNAPSHOT = ${embedded};
const state = { scope: SNAPSHOT.scopes && SNAPSHOT.scopes[0] ? SNAPSHOT.scopes[0].key : '' , filter: '' };
const $scope = document.getElementById('scope');
const $filter = document.getElementById('filter');
const $summary = document.getElementById('summary');
const $raw = document.getElementById('raw');
const $history = document.getElementById('history');
document.getElementById('generated').textContent = 'generated ' + (SNAPSHOT.generatedAt || '') + ' | ' + (SNAPSHOT.memoryDir || '');
function esc(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
function current() { return (SNAPSHOT.scopes || []).find((item) => item.key === state.scope); }
function render() {
  const scope = current();
  if (!scope) { $summary.textContent = 'no scopes'; $raw.innerHTML = ''; $history.innerHTML = ''; return; }
  $summary.textContent = scope.summary || '(empty)';
  const rows = (scope.raw || []).filter((entry) => {
    if (!state.filter) return true;
    const hay = (entry.content + ' ' + entry.id + ' ' + (entry.tags || []).join(' ')).toLowerCase();
    return hay.includes(state.filter.toLowerCase());
  });
  $raw.innerHTML = rows.length === 0
    ? '<p class="muted">no matching entries</p>'
    : '<table><thead><tr><th>id</th><th>ts</th><th>importance</th><th>tags</th><th>content</th></tr></thead><tbody>' +
      rows.map((entry) => '<tr><td><code>' + esc(entry.id) + '</code></td><td>' + esc(entry.ts) + '</td><td><span class="badge">' + esc(entry.importance) + '</span></td><td>' + esc((entry.tags || []).join(', ')) + '</td><td>' + esc(entry.content) + '</td></tr>').join('') +
      '</tbody></table>';
  $history.innerHTML = (scope.history || []).length === 0
    ? '<li class="muted">no retained versions</li>'
    : scope.history.map((item) => '<li>v' + esc(item.version) + ' <span class="muted">' + esc(item.file) + ' (' + esc(item.bytes) + ' bytes)</span></li>').join('');
}
for (const item of (SNAPSHOT.scopes || [])) {
  const option = document.createElement('option');
  option.value = item.key;
  option.textContent = item.key + ' (' + (item.raw || []).length + ' raw entries)';
  $scope.appendChild(option);
}
$scope.value = state.scope;
$scope.addEventListener('change', () => { state.scope = $scope.value; render(); });
$filter.addEventListener('input', () => { state.filter = $filter.value; render(); });
render();
</script>
</body>
</html>
`
}

export function buildBrowserSnapshot({ memoryDir, generatedAt, scopes }) {
  return { memoryDir, generatedAt, scopes: Array.isArray(scopes) ? scopes : [] }
}
