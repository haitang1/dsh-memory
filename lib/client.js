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
    // DSH 0.1.7-rc.1 renamed the icon family (IconXxxOutline14/16/20 ->
    // IconXxxOutline plus Medium/Regular size variants). Prefer the old name so
    // DSH 0.1.5 keeps its exact icon, and fall back on 0.1.7+.
    var IconChevronDownOutline14 = primitives.IconChevronDownOutline14 || primitives.IconChevronDownOutline

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
      unavailable: 'Memory settings unavailable: ',
      // Copy for the DSH 0.1.7 Plugins-page form (see MemoryFormCard below).
      formOverridden: 'Overridden',
      formReset: 'Reset to default',
      formInvalid: 'Enter a valid value, or leave blank to use the default.',
      formUnavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      formReadOnly: 'This deployment stores settings read-only.',
      formSaveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      formBoolHint: 'true or false (blank = default).',
      formListHint: 'Comma-separated list (blank = default).',
      formSecretSet: 'Configured',
      formSecretPending: 'Pending save',
      formSecretUnset: 'Not set'
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
      unavailable: '记忆设置不可用：',
      // DSH 0.1.7「插件」页表单的文案（见下方 MemoryFormCard）。
      formOverridden: '已覆盖',
      formReset: '恢复默认',
      formInvalid: '请输入有效值；留空表示使用默认值。',
      formUnavailable: '该插件当前未加载，暂时无法配置。',
      formReadOnly: '本部署的设置为只读。',
      formSaveFailed: '本部署没有接受这些值，已保留供你修改。',
      formBoolHint: 'true 或 false（留空 = 默认）。',
      formListHint: '逗号分隔的列表（留空 = 默认）。',
      formSecretSet: '已设置',
      formSecretPending: '待保存',
      formSecretUnset: '未设置'
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

        // Send only the fields the user actually changed. Persisting the whole
        // form would write today's defaults into the user layer, where they keep
        // outranking later releases' defaults (a pinned consolidateMaxTokens of
        // 3000 kept breaking consolidation after the plugin raised it to 8192).
        // A field edited back to its default is sent as an explicit unset so the
        // stale override disappears instead of being re-pinned.
        function jsonEqual(a, b) {
          return JSON.stringify(a) === JSON.stringify(b)
        }

        function savePatch() {
          var settings = snapshot.settings
          var base = settings.base || {}
          var user = settings.user || {}
          var defaults = settings.defaults || {}
          var current = settings.value || {}
          var set = {}
          var unset = []
          for (var key in draft) {
            if (jsonEqual(draft[key], current[key])) continue
            set[key] = draft[key]
          }
          for (var owned in user) {
            var fallback = Object.prototype.hasOwnProperty.call(base, owned) ? base[owned] : defaults[owned]
            if (fallback === undefined) continue
            if (!Object.prototype.hasOwnProperty.call(draft, owned) || jsonEqual(draft[owned], fallback)) {
              delete set[owned]
              if (unset.indexOf(owned) === -1) unset.push(owned)
            }
          }
          return { set: set, unset: unset }
        }

        function save() {
          if (!snapshot) return
          setBusy(true)
          setMessage(null)
          setError(null)
          var patch = savePatch()
          apiRequest({
            method: 'POST',
            body: JSON.stringify({ action: 'save', expectedRevision: snapshot.settings.revision, set: patch.set, unset: patch.unset })
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

    // ---------------------------------------------------------------------
    // DSH 0.1.7 settings page.
    //
    // 0.1.7 removed both the `settings.plugin.item` slot and the provider-side
    // settings namespace: a plugin's form now lives on the Plugins page as the
    // configuration of the row its bundle patch declares, registered by the
    // plugin itself into `plugins.row.config` (keyed `<bundle>#<rowId>`) and
    // gated by `configForms.whileServed`. The primitives it renders with
    // (SettingsForm / SettingsFormModel / SettingsValueField) do not exist on the
    // 0.1.5 line, so every reference is resolved inside the branch below, which
    // only runs once `configForms` appears — 0.1.5 therefore keeps its own card
    // and never evaluates a missing API.
    // ---------------------------------------------------------------------

    /** `plugins.row.config` key: the bundle name and the row id its patch declares. */
    var ROW_CONFIG_KEY = '@dsh-external/dsh-memory#dsh-memory'

    /**
     * The fields the 0.1.7 form offers, in page order, with the control each
     * needs. `memoryDir` and `seedFromAgentsMd` are deliberately absent: the Host
     * only serves fields its schema marks live-editable, and those two take effect
     * at apply time.
     */
    var FORM_FIELDS = [
      ['maxBytes', 'number'],
      ['consolidateMaxBytes', 'number'],
      ['keepSummaryVersions', 'number'],
      ['rawArchiveMaxBytes', 'number'],
      ['autoSummarize', 'bool'],
      ['summarizeProvider', 'text'],
      ['summarizeModel', 'text'],
      ['summarizeDebounceMs', 'number'],
      ['consolidateEvery', 'number'],
      ['summaryMaxTokens', 'number'],
      ['consolidateMaxTokens', 'number'],
      ['llmRetries', 'number'],
      ['maxActiveSummaries', 'number'],
      ['scopedMemory', 'bool'],
      ['scopeMaxBytes', 'number'],
      ['redactSecrets', 'bool'],
      ['readOnlyScopes', 'list'],
      ['embeddingBaseURL', 'text'],
      ['embeddingApiKey', 'secret'],
      ['embeddingModel', 'text']
    ]

    /**
     * Build the write spec for one form field.
     *
     * Only numbers and text have catalogue helpers; booleans and the scope list
     * are written here, in the same `{ field, format, parse }` shape. A parse that
     * returns undefined marks the draft invalid, which blocks the save instead of
     * dropping the edit.
     * @param kind - 'number' | 'text' | 'secret' | 'bool' | 'list'.
     * @param field - the config field name.
     * @returns the field spec.
     */
    function formFieldSpec(kind, field) {
      if (kind === 'number') return primitives.settingsNumberField(field)
      // A secret is still an ordinary section field here: it saves with the rest of
      // the form and its value round-trips. Only its control differs (masked).
      if (kind === 'text' || kind === 'secret') return primitives.settingsTextField(field)
      if (kind === 'bool') {
        return {
          field: field,
          format: function (value) { return value === true ? 'true' : value === false ? 'false' : '' },
          parse: function (text) {
            var raw = String(text).trim().toLowerCase()
            if (raw === '') return { kind: 'clear' }
            if (raw === 'true' || raw === '1' || raw === 'on' || raw === 'yes' || raw === '\u662f' || raw === '\u5f00') return { kind: 'set', value: true }
            if (raw === 'false' || raw === '0' || raw === 'off' || raw === 'no' || raw === '\u5426' || raw === '\u5173') return { kind: 'set', value: false }
            return undefined
          }
        }
      }
      return {
        field: field,
        format: function (value) { return Array.isArray(value) ? value.join(', ') : '' },
        parse: function (text) {
          var raw = String(text).trim()
          if (raw === '') return { kind: 'clear' }
          return {
            kind: 'set',
            value: raw.split(',').map(function (part) { return part.trim() }).filter(function (part) { return part.length > 0 })
          }
        }
      }
    }

    /** The form frame's copy, read from this plugin's dictionary. */
    function formLabels(t) {
      return {
        unavailable: t('formUnavailable'),
        readOnly: t('formReadOnly'),
        saveFailed: t('formSaveFailed'),
        save: t('save'),
        saving: t('saving')
      }
    }

    /** The row's one-liner, or its settings form — whichever the Plugins page asks for. */
    function MemoryFormCard(props) {
      var t = props.t
      var state = props.useMemoryForm(function (snapshot) { return snapshot })
      if (props.view === 'summary') return t('desc')
      var rows = FORM_FIELDS.map(function (spec) {
        var field = spec[0]
        var kind = spec[1]
        var fieldState = state[field] || {}
        var edit = function (text) { props.edit(field, text) }
        if (kind === 'secret') {
          // Masked control plus a badge that previews the save: a staged edit reads
          // as pending until the Host accepts it (the controller clears the pending
          // set once the form is no longer dirty). The value stays an ordinary
          // section field, so it stages through the same `edit` and saves with the
          // rest of the form (unlike a credential reference, which the page writes
          // out of band).
          var configured = typeof fieldState.text === 'string' && fieldState.text.length > 0
          var pendingSave = state.pendingEdits !== undefined && state.pendingEdits[field] === true
          return React.createElement(primitives.SettingsSecretField, {
            key: field,
            id: 'dsh-memory-' + field,
            label: t(field + 'Label'),
            hint: t(field + 'Hint'),
            text: fieldState.text,
            disabled: !state.writable,
            configured: configured,
            stateLabel: pendingSave ? t('formSecretPending') : configured ? t('formSecretSet') : t('formSecretUnset'),
            onEdit: edit
          })
        }
        var hint = kind === 'bool' ? t('formBoolHint') : kind === 'list' ? t('formListHint') : t(field + 'Hint')
        var controlProps = {
          key: field,
          id: 'dsh-memory-' + field,
          label: t(field + 'Label'),
          hint: hint,
          overriddenLabel: t('formOverridden'),
          resetLabel: t('formReset'),
          invalidLabel: t('formInvalid'),
          numeric: kind === 'number',
          disabled: !state.writable,
          onEdit: edit,
          onReset: function () { props.resetField(field) }
        }
        for (var key in fieldState) controlProps[key] = fieldState[key]
        return React.createElement(primitives.SettingsValueField, controlProps)
      })
      return React.createElement(primitives.SettingsForm, {
        labels: formLabels(t),
        state: state,
        onSave: props.save,
        onDiscard: props.discard
      }, rows)
    }

    /**
     * Bridge the `dsh-memory` settings scope onto the page's staged form.
     *
     * The form's field state carries no per-field "pending save" flag (only the
     * form-wide `dirty`), so this controller remembers which fields were edited in
     * the current save cycle and clears them as soon as the form is no longer
     * dirty — a save that landed, or a discard.
     * @param scope - the bound settings scope for the namespace.
     * @returns the face the slot registration injects, plus disposal.
     */
    function memoryFormController(scope) {
      var specs = FORM_FIELDS.map(function (spec) { return formFieldSpec(spec[1], spec[0]) })
      var form = new primitives.SettingsFormModel(scope, specs)
      var pendingEdits = {}
      var store = form.bind(function () {
        var projection = {}
        for (var i = 0; i < FORM_FIELDS.length; i++) {
          var field = FORM_FIELDS[i][0]
          projection[field] = form.field(field)
        }
        var shell = form.shell()
        if (shell.dirty !== true) pendingEdits = {}
        var pending = {}
        for (var name in pendingEdits) pending[name] = true
        projection.pendingEdits = pending
        for (var key in shell) projection[key] = shell[key]
        return projection
      })
      return {
        inject: function () {
          var actions = form.actions()
          var face = {
            hooks: { memoryForm: store },
            edit: function (field, text) {
              pendingEdits[field] = true
              actions.edit(field, text)
            },
            resetField: function (field) {
              pendingEdits[field] = true
              actions.resetField(field)
            },
            save: actions.save,
            discard: function () {
              pendingEdits = {}
              actions.discard()
            }
          }
          return face
        },
        dispose: function () { form.dispose() }
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
      // 0.1.7 path: waits for the settings-forms service, so a 0.1.5 deployment
      // (which has neither the service nor these primitives) never runs it.
      if (typeof ctx.inject === 'function') {
        ctx.inject(['configForms', 'slots'], function (formCtx) {
          var controller = memoryFormController(formCtx.configForms.get(NS))
          formCtx.effect(function () { return function () { controller.dispose() } }, 'dsh-memory: settings form subscription')
          formCtx.effect(function () {
            return formCtx.configForms.whileServed([NS], function () {
              return formCtx.slots.inject('plugins.row.config', function () {
                return formCtx.slots.register({
                  name: 'plugins.row.config',
                  key: ROW_CONFIG_KEY,
                  // A keyed slot dispatches by key only: `order`/`label` belong to
                  // list slots and are ignored (and type-invalid) here.
                  locale: NS,
                  inject: function () { return controller.inject() }
                }, MemoryFormCard)
              })
            })
          }, 'dsh-memory: settings page')
        })
      }
    }

    exports.apply = apply

    return module.exports
  }
})
