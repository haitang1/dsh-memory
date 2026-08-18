// dsh-memory Web client bundle: the "Memory" card on the DSH plugin settings
// page (settings.plugin.item slot). Loaded by the client module system via
// package.json's dsh.client declaration; speaks to the same-origin
// /_dsh/memory/settings endpoint registered by the host half.
//
// The card mirrors the built-in plugin cards (PluginCard) visual language:
// same theme tokens, header/headText/name/description/chevron structure,
// pending badge, and footer actions. Copy is localized via the client
// `locale` service (en/zh) and follows DSH's language setting.
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-memory',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    var IconChevronDownOutline14 = primitives.IconChevronDownOutline14

    var ROUTE = '/_dsh/memory/settings'
    var NS = 'dsh-memory'

    var en = {
      nav: 'Memory',
      title: 'Memory (dsh-memory)',
      desc: 'Global memory summary, auto-summarization, and consolidation.',
      expand: 'Expand',
      collapse: 'Collapse',
      unsaved: 'Unsaved',
      groupGeneral: 'General',
      groupAuto: 'Auto-summarization & consolidation',
      groupScopes: 'Scopes',
      groupSecurity: 'Security & embeddings',
      memoryDirLabel: 'memoryDir',
      memoryDirHint: 'Memory directory (empty = default). Restart DSH for changes to take effect.',
      maxBytesLabel: 'maxBytes',
      maxBytesHint: 'Injected summary byte budget (min 256).',
      consolidateMaxBytesLabel: 'consolidateMaxBytes',
      consolidateMaxBytesHint: 'Input byte budget for one consolidation run.',
      keepSummaryVersionsLabel: 'keepSummaryVersions',
      keepSummaryVersionsHint: 'Retained summary history versions for memory_rollback (0 = keep none).',
      rawArchiveMaxBytesLabel: 'rawArchiveMaxBytes',
      rawArchiveMaxBytesHint: 'Active raw-file byte budget; oldest entries move to archive/ beyond it.',
      autoSummarizeLabel: 'autoSummarize \u2014 distill finished turns into rollout summaries.',
      summarizeProviderLabel: 'summarizeProvider',
      summarizeProviderHint: 'Provider for summarization (empty = the selected agent model).',
      summarizeModelLabel: 'summarizeModel',
      summarizeModelHint: 'Model for summarization (empty = the selected agent model).',
      summarizeDebounceMsLabel: 'summarizeDebounceMs',
      summarizeDebounceMsHint: 'Minimum interval between two distillations of the same session (0 = no debounce).',
      consolidateEveryLabel: 'consolidateEvery',
      consolidateEveryHint: 'Rollout summaries written before the global summary is re-consolidated.',
      summaryMaxTokensLabel: 'summaryMaxTokens',
      summaryMaxTokensHint: 'Max output tokens for one turn summary.',
      consolidateMaxTokensLabel: 'consolidateMaxTokens',
      consolidateMaxTokensHint: 'Max output tokens for a consolidation.',
      llmRetriesLabel: 'llmRetries',
      llmRetriesHint: 'LLM retry count after transient failures.',
      maxActiveSummariesLabel: 'maxActiveSummaries',
      maxActiveSummariesHint: 'Concurrent turn-summarization jobs; beyond this new jobs are dropped.',
      scopedMemoryLabel: 'scopedMemory \u2014 isolate memory per workspace/project.',
      scopeMaxBytesLabel: 'scopeMaxBytes',
      scopeMaxBytesHint: 'Injected byte budget for a workspace scope (scopedMemory on).',
      redactSecretsLabel: 'redactSecrets \u2014 redact credential-looking text before injection.',
      readOnlyScopesLabel: 'readOnlyScopes',
      readOnlyScopesHint: 'Comma-separated scope keys with write access denied (global, ws-*, project-*, or *).',
      embeddingBaseURLLabel: 'embeddingBaseURL',
      embeddingBaseURLHint: 'OpenAI-compatible /embeddings endpoint for vector search (empty = local hashed vectors).',
      embeddingApiKeyLabel: 'embeddingApiKey',
      embeddingApiKeyHint: 'API key for the embeddings endpoint (shown masked).',
      embeddingModelLabel: 'embeddingModel',
      embeddingModelHint: 'Embeddings model id (empty = local hashed vectors).',
      seedFromAgentsMdLabel: 'seedFromAgentsMd \u2014 seed the first summary from AGENTS.md.',
      readOnly: 'The settings provider is read-only.',
      saved: 'Settings saved and applied.',
      save: 'Save',
      saving: 'Saving\u2026',
      discard: 'Discard',
      loading: 'Loading\u2026',
      unavailable: 'Memory settings unavailable: '
    }

    var zh = {
      nav: '记忆',
      title: '记忆 (dsh-memory)',
      desc: '全局记忆摘要、自动摘要与合并。',
      expand: '展开',
      collapse: '收起',
      unsaved: '未保存',
      groupGeneral: '通用',
      groupAuto: '自动摘要与合并',
      groupScopes: '作用域',
      groupSecurity: '安全与嵌入',
      memoryDirLabel: '记忆目录 (memoryDir)',
      memoryDirHint: '记忆存储目录（空 = 默认）。更改后需重启 DSH 生效。',
      maxBytesLabel: '注入字节上限 (maxBytes)',
      maxBytesHint: '注入摘要的字节预算（最小 256）。',
      consolidateMaxBytesLabel: '合并输入预算 (consolidateMaxBytes)',
      consolidateMaxBytesHint: '单次合并的输入字节预算。',
      keepSummaryVersionsLabel: '保留摘要版本数 (keepSummaryVersions)',
      keepSummaryVersionsHint: '供 memory_rollback 回滚保留的摘要历史版本数（0 = 不保留）。',
      rawArchiveMaxBytesLabel: '原始条目预算 (rawArchiveMaxBytes)',
      rawArchiveMaxBytesHint: '活动 raw 文件字节预算；超出后最旧条目移入 archive/。',
      autoSummarizeLabel: 'autoSummarize \u2014 把结束的轮次蒸馏为 rollout 摘要。',
      summarizeProviderLabel: '摘要提供方 (summarizeProvider)',
      summarizeProviderHint: '摘要使用的模型提供方（空 = 当前选择的代理模型）。',
      summarizeModelLabel: '摘要模型 (summarizeModel)',
      summarizeModelHint: '摘要使用的模型（空 = 当前选择的代理模型）。',
      summarizeDebounceMsLabel: '摘要防抖 (summarizeDebounceMs)',
      summarizeDebounceMsHint: '同一会话两次蒸馏的最小间隔毫秒数（0 = 关闭防抖）。',
      consolidateEveryLabel: '合并阈值 (consolidateEvery)',
      consolidateEveryHint: '累计多少份 rollout 摘要后重新合并全局摘要。',
      summaryMaxTokensLabel: '单轮摘要上限 (summaryMaxTokens)',
      summaryMaxTokensHint: '单轮摘要 LLM 的最大输出 token。',
      consolidateMaxTokensLabel: '合并输出上限 (consolidateMaxTokens)',
      consolidateMaxTokensHint: '摘要合并 LLM 的最大输出 token。',
      llmRetriesLabel: 'LLM 重试次数 (llmRetries)',
      llmRetriesHint: 'LLM 瞬时失败后的重试次数。',
      maxActiveSummariesLabel: '并发摘要上限 (maxActiveSummaries)',
      maxActiveSummariesHint: '同时进行的轮次摘要上限，超出后丢弃新任务。',
      scopedMemoryLabel: 'scopedMemory \u2014 按工作区/项目隔离记忆。',
      scopeMaxBytesLabel: '工作区摘要预算 (scopeMaxBytes)',
      scopeMaxBytesHint: 'scopedMemory 开启时工作区摘要的注入字节预算。',
      redactSecretsLabel: 'redactSecrets \u2014 注入前对疑似凭据文本脱敏。',
      readOnlyScopesLabel: '只读作用域 (readOnlyScopes)',
      readOnlyScopesHint: '禁止写入的作用域键，逗号分隔（global、ws-*、project-* 或 *）。',
      embeddingBaseURLLabel: '嵌入端点 (embeddingBaseURL)',
      embeddingBaseURLHint: 'vector 检索的 OpenAI 兼容 /embeddings 端点（空 = 本地哈希向量）。',
      embeddingApiKeyLabel: '嵌入 API 密钥 (embeddingApiKey)',
      embeddingApiKeyHint: '嵌入端点的 API 密钥（以掩码显示）。',
      embeddingModelLabel: '嵌入模型 (embeddingModel)',
      embeddingModelHint: '嵌入模型 id（空 = 本地哈希向量）。',
      seedFromAgentsMdLabel: 'seedFromAgentsMd \u2014 用 AGENTS.md 导入初始摘要。',
      readOnly: '设置提供方为只读。',
      saved: '设置已保存并生效。',
      save: '保存',
      saving: '保存中\u2026',
      discard: '放弃',
      loading: '加载中\u2026',
      unavailable: '记忆设置不可用：'
    }

    // Mirrors the built-in plugin card styles (PluginCard.module.css tokens).
    var CSS = '.dmm-card{list-style:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;transition:border-color .16s,background .16s}' +
      '.dmm-card:hover{border-color:var(--dsw-alias-label-dimmed)}' +
      '.dmm-open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}' +
      '.dmm-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}' +
      '.dmm-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}' +
      '.dmm-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}' +
      '.dmm-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}' +
      '.dmm-desc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}' +
      '.dmm-chev{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}' +
      '.dmm-chevOpen{transform:rotate(180deg)}' +
      '.dmm-pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}' +
      '.dmm-body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:12px 0 8px;display:grid;gap:12px}' +
      '.dmm-group{font-size:12px;font-weight:700;color:var(--dsw-alias-label-secondary);letter-spacing:.03em;margin-top:8px}' +
      '.dmm-group:first-child{margin-top:0}' +
      '.dmm-field{display:grid;gap:4px}' +
      '.dmm-field>label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}' +
      '.dmm-field>input[type=number]{width:140px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-subtle,#d9d5ce);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px;padding:5px 10px}' +
      '.dmm-field>input[type=text],.dmm-field>input[type=password]{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-subtle,#d9d5ce);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:inherit;font:inherit;font-size:13px;padding:5px 10px}' +
      '.dmm-check{display:flex;align-items:flex-start;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary);line-height:1.5}' +
      '.dmm-check>input{accent-color:var(--dsw-alias-brand-primary);margin-top:3px}' +
      '.dmm-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5}' +
      '.dmm-readonly{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}' +
      '.dmm-msg{font-size:12px;line-height:1.5;margin:0}' +
      '.dmm-msg[data-kind=ok]{color:#2e7d32}' +
      '.dmm-msg[data-kind=err]{color:var(--dsw-alias-label-error)}' +
      '.dmm-footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}' +
      '.dmm-btn{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}' +
      '.dmm-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}' +
      '.dmm-save{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-inverse)}' +
      '.dmm-btn:disabled{opacity:.5;cursor:default}' +
      '.dmm-load{font-size:13px;color:var(--dsw-alias-label-tertiary);padding:14px 16px}'

    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="' + NS + '"]')) return
      var tag = document.createElement('style')
      tag.dataset.pluginCss = NS
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    function apiRequest(options) {
      var init = { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }
      if (options && options.method) init.method = options.method
      if (options && options.body !== undefined) init.body = options.body
      return fetch(ROUTE, init).then(function (res) {
        return res.json().catch(function () { return null }).then(function (payload) {
          if (!res.ok) throw new Error(payload && payload.error ? payload.error.message : 'HTTP ' + res.status)
          if (!payload || payload.ok !== true) throw new Error(payload && payload.error ? payload.error.message : 'unexpected response')
          return payload.value
        })
      })
    }

    function fieldRow(label, hint, control) {
      return React.createElement('div', { className: 'dmm-field' },
        React.createElement('label', null, label),
        control,
        hint ? React.createElement('span', { className: 'dmm-hint' }, hint) : null
      )
    }

    function groupTitle(t, key) {
      return React.createElement('div', { className: 'dmm-group' }, t(key))
    }

    function MemoryCard(t) {
      return function Card() {
        var openState = React.useState(false)
        var open = openState[0]
        var setOpen = openState[1]
        var snapshotState = React.useState(null)
        var snapshot = snapshotState[0]
        var setSnapshot = snapshotState[1]
        var draftState = React.useState(null)
        var draft = draftState[0]
        var setDraft = draftState[1]
        var busyState = React.useState(false)
        var busy = busyState[0]
        var setBusy = busyState[1]
        var messageState = React.useState(null)
        var message = messageState[0]
        var setMessage = messageState[1]
        var errorState = React.useState(null)
        var error = errorState[0]
        var setError = errorState[1]

        React.useEffect(function () {
          var alive = true
          apiRequest({ method: 'GET' }).then(function (value) {
            if (!alive) return
            setSnapshot(value)
            setDraft(value.settings.value)
          }).catch(function (reason) {
            if (alive) setError(reason instanceof Error ? reason.message : String(reason))
          })
          return function () { alive = false }
        }, [])

        function update(key, next) {
          setDraft(function (current) {
            var copy = {}
            for (var k in current) copy[k] = current[k]
            copy[key] = next
            return copy
          })
          setMessage(null)
          setError(null)
        }

        function save() {
          if (!snapshot) return
          setBusy(true)
          setMessage(null)
          setError(null)
          apiRequest({
            method: 'POST',
            body: JSON.stringify({ action: 'save', expectedRevision: snapshot.settings.revision, value: draft })
          }).then(function (value) {
            setSnapshot(value)
            setDraft(value.settings.value)
            setMessage('saved')
          }).catch(function (reason) {
            setError(reason instanceof Error ? reason.message : String(reason))
          }).then(function () { setBusy(false) })
        }

        function discard() {
          setDraft(snapshot.settings.value)
          setMessage(null)
          setError(null)
        }

        if (snapshot === null) {
          return React.createElement('li', { className: 'dmm-card' },
            React.createElement('div', { className: 'dmm-load' },
              error !== null ? t('unavailable') + error : t('loading')
            )
          )
        }

        var value = draft || snapshot.settings.value
        var writable = snapshot.writable
        var dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(snapshot.settings.value)

        return React.createElement('li', { className: 'dmm-card' + (open ? ' dmm-open' : '') },
          React.createElement('button', {
            type: 'button',
            className: 'dmm-header',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': t(open ? 'collapse' : 'expand') + ': ' + t('title'),
            onClick: function () { setOpen(!open) }
          },
            React.createElement('span', { className: 'dmm-headText' },
              React.createElement('span', { className: 'dmm-name' }, t('title')),
              React.createElement('span', { className: 'dmm-desc' }, t('desc'))
            ),
            dirty ? React.createElement('span', { className: 'dmm-pending' }, t('unsaved')) : null,
            React.createElement(IconChevronDownOutline14, { size: 14, className: 'dmm-chev' + (open ? ' dmm-chevOpen' : '') })
          ),
          open ? React.createElement('div', { className: 'dmm-body' },
            groupTitle(t, 'groupGeneral'),
            fieldRow(t('memoryDirLabel'), t('memoryDirHint'),
              React.createElement('input', {
                type: 'text', value: value.memoryDir,
                onChange: function (event) { update('memoryDir', event.target.value) }
              })
            ),
            fieldRow(t('maxBytesLabel'), t('maxBytesHint'),
              React.createElement('input', {
                type: 'number', min: 256, max: 1048576, value: value.maxBytes,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('maxBytes', n)
                }
              })
            ),
            fieldRow(t('consolidateMaxBytesLabel'), t('consolidateMaxBytesHint'),
              React.createElement('input', {
                type: 'number', min: 1024, max: 1048576, value: value.consolidateMaxBytes,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('consolidateMaxBytes', n)
                }
              })
            ),
            fieldRow(t('keepSummaryVersionsLabel'), t('keepSummaryVersionsHint'),
              React.createElement('input', {
                type: 'number', min: 0, max: 100, value: value.keepSummaryVersions,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('keepSummaryVersions', n)
                }
              })
            ),
            fieldRow(t('rawArchiveMaxBytesLabel'), t('rawArchiveMaxBytesHint'),
              React.createElement('input', {
                type: 'number', min: 1024, max: 10485760, value: value.rawArchiveMaxBytes,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('rawArchiveMaxBytes', n)
                }
              })
            ),
            React.createElement('label', { className: 'dmm-check' },
              React.createElement('input', {
                type: 'checkbox', checked: value.seedFromAgentsMd === true,
                onChange: function (event) { update('seedFromAgentsMd', event.target.checked) }
              }),
              t('seedFromAgentsMdLabel')
            ),
            groupTitle(t, 'groupAuto'),
            React.createElement('label', { className: 'dmm-check' },
              React.createElement('input', {
                type: 'checkbox', checked: value.autoSummarize === true,
                onChange: function (event) { update('autoSummarize', event.target.checked) }
              }),
              t('autoSummarizeLabel')
            ),
            fieldRow(t('summarizeDebounceMsLabel'), t('summarizeDebounceMsHint'),
              React.createElement('input', {
                type: 'number', min: 0, value: value.summarizeDebounceMs,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('summarizeDebounceMs', n)
                }
              })
            ),
            fieldRow(t('summarizeProviderLabel'), t('summarizeProviderHint'),
              React.createElement('input', {
                type: 'text', value: value.summarizeProvider,
                onChange: function (event) { update('summarizeProvider', event.target.value) }
              })
            ),
            fieldRow(t('summarizeModelLabel'), t('summarizeModelHint'),
              React.createElement('input', {
                type: 'text', value: value.summarizeModel,
                onChange: function (event) { update('summarizeModel', event.target.value) }
              })
            ),
            fieldRow(t('summaryMaxTokensLabel'), t('summaryMaxTokensHint'),
              React.createElement('input', {
                type: 'number', min: 64, max: 8192, value: value.summaryMaxTokens,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('summaryMaxTokens', n)
                }
              })
            ),
            fieldRow(t('consolidateMaxTokensLabel'), t('consolidateMaxTokensHint'),
              React.createElement('input', {
                type: 'number', min: 128, max: 16384, value: value.consolidateMaxTokens,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('consolidateMaxTokens', n)
                }
              })
            ),
            fieldRow(t('consolidateEveryLabel'), t('consolidateEveryHint'),
              React.createElement('input', {
                type: 'number', min: 1, max: 64, value: value.consolidateEvery,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('consolidateEvery', n)
                }
              })
            ),
            fieldRow(t('llmRetriesLabel'), t('llmRetriesHint'),
              React.createElement('input', {
                type: 'number', min: 0, max: 3, value: value.llmRetries,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('llmRetries', n)
                }
              })
            ),
            fieldRow(t('maxActiveSummariesLabel'), t('maxActiveSummariesHint'),
              React.createElement('input', {
                type: 'number', min: 1, max: 32, value: value.maxActiveSummaries,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('maxActiveSummaries', n)
                }
              })
            ),
            groupTitle(t, 'groupScopes'),
            React.createElement('label', { className: 'dmm-check' },
              React.createElement('input', {
                type: 'checkbox', checked: value.scopedMemory === true,
                onChange: function (event) { update('scopedMemory', event.target.checked) }
              }),
              t('scopedMemoryLabel')
            ),
            fieldRow(t('scopeMaxBytesLabel'), t('scopeMaxBytesHint'),
              React.createElement('input', {
                type: 'number', min: 0, max: 1048576, value: value.scopeMaxBytes,
                onChange: function (event) {
                  var n = Number(event.target.value)
                  if (Number.isFinite(n)) update('scopeMaxBytes', n)
                }
              })
            ),
            fieldRow(t('readOnlyScopesLabel'), t('readOnlyScopesHint'),
              React.createElement('input', {
                type: 'text',
                value: Array.isArray(value.readOnlyScopes) ? value.readOnlyScopes.join(', ') : '',
                onChange: function (event) {
                  update('readOnlyScopes', event.target.value.split(',').map(function (item) { return item.trim() }).filter(Boolean))
                }
              })
            ),
            groupTitle(t, 'groupSecurity'),
            React.createElement('label', { className: 'dmm-check' },
              React.createElement('input', {
                type: 'checkbox', checked: value.redactSecrets === true,
                onChange: function (event) { update('redactSecrets', event.target.checked) }
              }),
              t('redactSecretsLabel')
            ),
            fieldRow(t('embeddingBaseURLLabel'), t('embeddingBaseURLHint'),
              React.createElement('input', {
                type: 'text', value: value.embeddingBaseURL,
                onChange: function (event) { update('embeddingBaseURL', event.target.value) }
              })
            ),
            fieldRow(t('embeddingApiKeyLabel'), t('embeddingApiKeyHint'),
              React.createElement('input', {
                type: 'password', autoComplete: 'off', value: value.embeddingApiKey,
                onChange: function (event) { update('embeddingApiKey', event.target.value) }
              })
            ),
            fieldRow(t('embeddingModelLabel'), t('embeddingModelHint'),
              React.createElement('input', {
                type: 'text', value: value.embeddingModel,
                onChange: function (event) { update('embeddingModel', event.target.value) }
              })
            ),
            writable === false ? React.createElement('p', { className: 'dmm-readonly' }, t('readOnly')) : null,
            message === 'saved' ? React.createElement('p', { className: 'dmm-msg', 'data-kind': 'ok' }, t('saved')) : null,
            error !== null ? React.createElement('p', { className: 'dmm-msg', 'data-kind': 'err' }, error) : null,
            React.createElement('div', { className: 'dmm-footer' },
              React.createElement('button', {
                type: 'button', className: 'dmm-btn dmm-discard',
                disabled: busy || !dirty,
                onClick: discard
              }, t('discard')),
              React.createElement('button', {
                type: 'button', className: 'dmm-btn dmm-save',
                disabled: busy || !writable || !dirty,
                onClick: save
              }, busy ? t('saving') : t('save'))
            )
          ) : null
        )
      }
    }

    exports.inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(installStyles, 'dsh-memory: settings card styles')
      ctx.effect(function () { return ctx.locale.register(NS, { en: en, zh: zh }) }, 'dsh-memory: locale')
      var t = ctx.locale.bind(NS)
      var Card = MemoryCard(t)
      ctx.slots.inject('settings.plugin.item', function () {
        return ctx.slots.register(
          { name: 'settings.plugin.item', key: 'memory', order: 30, label: function () { return t('nav') } },
          Card
        )
      })
    }

    exports.apply = apply

    return module.exports
  }
})
