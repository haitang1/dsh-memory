// dsh-memory Web client bundle: the "Memory" card on the DSH plugin settings
// page (settings.plugin.item slot). Loaded by the client module system via
// package.json's dsh.client declaration; speaks to the same-origin
// /_dsh/memory/settings endpoint registered by the host half.
//
// Card copy is localized via the client `locale` service (en/zh dictionaries)
// so it follows DSH's language setting.
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-memory',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var ROUTE = '/_dsh/memory/settings'
    var NS = 'dsh-memory'

    var en = {
      nav: 'Memory',
      title: 'Memory (dsh-memory)',
      desc: 'Global memory summary, auto-summarization, and consolidation.',
      maxBytesLabel: 'maxBytes',
      maxBytesHint: 'Injected summary byte budget (min 256).',
      consolidateEveryLabel: 'consolidateEvery',
      consolidateEveryHint: 'Rollout summaries written before the global summary is re-consolidated.',
      autoSummarizeLabel: 'autoSummarize \u2014 distill finished turns into rollout summaries.',
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
      maxBytesLabel: '注入字节上限 (maxBytes)',
      maxBytesHint: '注入摘要的字节预算（最小 256）。',
      consolidateEveryLabel: '合并阈值 (consolidateEvery)',
      consolidateEveryHint: '累计多少份 rollout 摘要后重新合并全局摘要。',
      autoSummarizeLabel: 'autoSummarize \u2014 把结束的轮次蒸馏为 rollout 摘要。',
      seedFromAgentsMdLabel: 'seedFromAgentsMd \u2014 用 AGENTS.md 导入初始摘要。',
      readOnly: '设置提供方为只读。',
      saved: '设置已保存并生效。',
      save: '保存',
      saving: '保存中\u2026',
      discard: '放弃',
      loading: '加载中\u2026',
      unavailable: '记忆设置不可用：'
    }

    var CSS = '.dmm-card{border:1px solid var(--dsw-alias-border-l2,#dedbd5);border-radius:12px;background:var(--dsw-alias-bg-layer-3,#fff)}' +
      '.dmm-head{width:100%;display:flex;align-items:center;gap:8px;padding:10px 12px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit}' +
      '.dmm-name{font-size:13px;font-weight:600}' +
      '.dmm-desc{font-size:12px;color:var(--dsw-alias-label-tertiary,#77736d)}' +
      '.dmm-chev{margin-left:auto;transition:transform .15s ease;color:var(--dsw-alias-label-tertiary,#77736d);font-size:10px}' +
      '.dmm-chev[data-open=true]{transform:rotate(180deg)}' +
      '.dmm-body{display:grid;gap:10px;padding:0 12px 12px}' +
      '.dmm-field{display:grid;gap:4px}' +
      '.dmm-field>label{font-size:11px;font-weight:600}' +
      '.dmm-field>input[type=number]{width:120px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-subtle,#d9d5ce);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px;padding:6px 8px}' +
      '.dmm-check{display:flex;align-items:center;gap:8px;font-size:12px}' +
      '.dmm-check>input{accent-color:#6758d4}' +
      '.dmm-hint{font-size:10px;color:var(--dsw-alias-label-tertiary,#77736d);line-height:1.4}' +
      '.dmm-row{display:flex;gap:8px;align-items:center}' +
      '.dmm-btn{border:1px solid var(--dsw-alias-border-subtle,#d9d5ce);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:12px;padding:6px 14px;cursor:pointer}' +
      '.dmm-btn[data-primary=true]{background:#6758d4;border-color:#6758d4;color:#fff}' +
      '.dmm-btn:disabled{opacity:.5;cursor:default}' +
      '.dmm-msg{font-size:12px}' +
      '.dmm-msg[data-kind=ok]{color:#267d52}' +
      '.dmm-msg[data-kind=err]{color:#aa3939}' +
      '.dmm-load{font-size:12px;color:var(--dsw-alias-label-tertiary,#77736d);padding:10px 12px}'

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

        if (snapshot === null) {
          return React.createElement('div', { className: 'dmm-card' },
            error !== null
              ? React.createElement('div', { className: 'dmm-load' }, t('unavailable') + error)
              : React.createElement('div', { className: 'dmm-load' }, t('loading'))
          )
        }

        var value = draft || snapshot.settings.value
        var writable = snapshot.writable
        var dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(snapshot.settings.value)

        return React.createElement('div', { className: 'dmm-card' },
          React.createElement('button', {
            type: 'button',
            className: 'dmm-head',
            'aria-expanded': open ? 'true' : 'false',
            onClick: function () { setOpen(!open) }
          },
            React.createElement('span', { className: 'dmm-name' }, t('title')),
            React.createElement('span', { className: 'dmm-desc' }, t('desc')),
            dirty ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'err' }, '\u25CF') : null,
            React.createElement('span', { className: 'dmm-chev', 'data-open': open ? 'true' : 'false' }, '\u25BC')
          ),
          open ? React.createElement('div', { className: 'dmm-body' },
            fieldRow(t('maxBytesLabel'), t('maxBytesHint'),
              React.createElement('input', {
                type: 'number', min: 256, value: value.maxBytes,
                onChange: function (event) { update('maxBytes', Number(event.target.value)) }
              })
            ),
            fieldRow(t('consolidateEveryLabel'), t('consolidateEveryHint'),
              React.createElement('input', {
                type: 'number', min: 1, value: value.consolidateEvery,
                onChange: function (event) { update('consolidateEvery', Number(event.target.value)) }
              })
            ),
            React.createElement('label', { className: 'dmm-check' },
              React.createElement('input', {
                type: 'checkbox', checked: value.autoSummarize === true,
                onChange: function (event) { update('autoSummarize', event.target.checked) }
              }),
              t('autoSummarizeLabel')
            ),
            React.createElement('label', { className: 'dmm-check' },
              React.createElement('input', {
                type: 'checkbox', checked: value.seedFromAgentsMd === true,
                onChange: function (event) { update('seedFromAgentsMd', event.target.checked) }
              }),
              t('seedFromAgentsMdLabel')
            ),
            writable === false ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'err' }, t('readOnly')) : null,
            message === 'saved' ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'ok' }, t('saved')) : null,
            error !== null ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'err' }, error) : null,
            React.createElement('div', { className: 'dmm-row' },
              React.createElement('button', {
                type: 'button', className: 'dmm-btn', 'data-primary': true,
                disabled: busy || !writable || !dirty,
                onClick: save
              }, busy ? t('saving') : t('save')),
              React.createElement('button', {
                type: 'button', className: 'dmm-btn',
                disabled: busy || !dirty,
                onClick: function () { setDraft(snapshot.settings.value); setMessage(null); setError(null) }
              }, t('discard'))
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
          { name: 'settings.plugin.item', id: 'memory', order: 30, label: function () { return t('nav') } },
          Card
        )
      })
    }

    exports.apply = apply

    return module.exports
  }
})
