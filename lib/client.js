// dsh-memory Web client bundle: the "Memory" card on the DSH plugin settings
// page (settings.plugin.item slot). Loaded by the client module system via
// package.json's dsh.client declaration; speaks to the same-origin
// /_dsh/memory/settings endpoint registered by the host half.
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-memory',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')

    var ROUTE = '/_dsh/memory/settings'
    var NS = 'dsh-memory'

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

    function MemoryCard() {
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
            ? React.createElement('div', { className: 'dmm-load' }, 'Memory settings unavailable: ' + error)
            : React.createElement('div', { className: 'dmm-load' }, 'Loading\u2026')
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
          React.createElement('span', { className: 'dmm-name' }, 'Memory (dsh-memory)'),
          React.createElement('span', { className: 'dmm-desc' }, 'Global memory summary, auto-summarization, and consolidation.'),
          dirty ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'err' }, '\u25CF') : null,
          React.createElement('span', { className: 'dmm-chev', 'data-open': open ? 'true' : 'false' }, '\u25BC')
        ),
        open ? React.createElement('div', { className: 'dmm-body' },
          fieldRow('maxBytes', 'Injected summary byte budget (min 256).',
            React.createElement('input', {
              type: 'number', min: 256, value: value.maxBytes,
              onChange: function (event) { update('maxBytes', Number(event.target.value)) }
            })
          ),
          fieldRow('consolidateEvery', 'Rollout summaries written before the global summary is re-consolidated.',
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
            'autoSummarize \u2014 distill finished turns into rollout summaries.'
          ),
          React.createElement('label', { className: 'dmm-check' },
            React.createElement('input', {
              type: 'checkbox', checked: value.seedFromAgentsMd === true,
              onChange: function (event) { update('seedFromAgentsMd', event.target.checked) }
            }),
            'seedFromAgentsMd \u2014 seed the first summary from AGENTS.md.'
          ),
          writable === false ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'err' }, 'The settings provider is read-only.') : null,
          message === 'saved' ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'ok' }, 'Settings saved and applied.') : null,
          error !== null ? React.createElement('span', { className: 'dmm-msg', 'data-kind': 'err' }, error) : null,
          React.createElement('div', { className: 'dmm-row' },
            React.createElement('button', {
              type: 'button', className: 'dmm-btn', 'data-primary': true,
              disabled: busy || !writable || !dirty,
              onClick: save
            }, busy ? 'Saving\u2026' : 'Save'),
            React.createElement('button', {
              type: 'button', className: 'dmm-btn',
              disabled: busy || !dirty,
              onClick: function () { setDraft(snapshot.settings.value); setMessage(null); setError(null) }
            }, 'Discard')
          )
        ) : null
      )
    }

    exports.inject = ['slots']

    function apply(ctx) {
      ctx.effect(installStyles, 'dsh-memory: settings card styles')
      ctx.slots.inject('settings.plugin.item', function () {
        return ctx.slots.register(
          { name: 'settings.plugin.item', id: 'memory', order: 30, label: 'Memory' },
          MemoryCard
        )
      })
    }

    exports.apply = apply

    return module.exports
  }
})
