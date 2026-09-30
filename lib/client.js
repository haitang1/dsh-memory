// dsh-memory Web client bundle: the configuration form for this bundle's own
// row on the DSH Plugins page (`plugins.row.config`, keyed
// `<bundle>#<rowId>`), registered through the `configForms` service. Loaded by
// the client module system via package.json's dsh.client declaration; the form
// writes through the Host's settings seam, which the plugin's same-origin
// /_dsh/memory/settings endpoint mirrors for programmatic readers.
//
// DSH 0.1.7 removed both the `settings.plugin.item` slot and the provider-side
// settings namespace, so the standalone card the 0.1.5 line needed — its markup,
// styles, and whole-section save path — is gone with that line. Copy is
// localized via the client `locale` service (en/zh) and follows DSH's language
// setting.
window.__ModuleLoader__.load({
  id: '@dsh-external/dsh-memory',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    var React = require('react')
    var primitives = require('@deepseek-ai/dsh-client-ui-primitives')

    var NS = 'dsh-memory'

    var en = {
      title: 'Memory (dsh-memory)',
      desc: 'Global memory summary, auto-summarization, and consolidation.',
      expand: 'Expand',
      collapse: 'Collapse',
      unsaved: 'Unsaved',
      memoryDirLabel: 'memoryDir',
      memoryDirHint: 'Memory directory (empty = default). Restart DSH for changes to take effect.',
      maxBytesLabel: 'maxBytes',
      injectTokensLabel: 'injectTokens \u2014 token cap for the injected summary (0 = bytes only).',
      injectTokensHint: 'Estimated tokens allowed for the injected memory (0 = no token cap; CJK counts about one token per character).',
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
      captureSubagentsLabel: 'captureSubagents \u2014 keep a bounded excerpt of each subagent\u2019s final answer.',
      scopeMaxBytesLabel: 'scopeMaxBytes',
      scopeMaxBytesHint: 'Injected byte budget for a workspace scope (scopedMemory on).',
      redactSecretsLabel: 'redactSecrets \u2014 redact credential-looking text before injection.',
      readOnlyScopesLabel: 'readOnlyScopes',
      readOnlyScopesHint: 'Comma-separated scope keys with write access denied (global, ws-*, project-*, or *).',
      embeddingBaseURLLabel: 'embeddingBaseURL',
      embeddingBaseURLHint: 'OpenAI-compatible /embeddings endpoint for vector search (empty = local hashed vectors).',
      embeddingApiKeyLabel: 'embeddingApiKey',
      embeddingApiKeyHint: 'API key for the embeddings endpoint (shown masked; leave blank to keep the stored key).',
      secretSetHint: 'A key is stored; leave blank to keep it.',
      embeddingModelLabel: 'embeddingModel',
      embeddingModelHint: 'Embeddings model id (empty = local hashed vectors).',
      seedFromAgentsMdLabel: 'seedFromAgentsMd \u2014 seed the first summary from AGENTS.md.',
      save: 'Save',
      saving: 'Saving\u2026',
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
      title: '记忆 (dsh-memory)',
      desc: '全局记忆摘要、自动摘要与合并。',
      expand: '展开',
      collapse: '收起',
      unsaved: '未保存',
      memoryDirLabel: '记忆目录 (memoryDir)',
      memoryDirHint: '记忆存储目录（空 = 默认）。更改后需重启 DSH 生效。',
      maxBytesLabel: '注入字节上限 (maxBytes)',
      injectTokensLabel: '注入 token 上限 (injectTokens) —— 0 表示只按字节限制。',
      injectTokensHint: '注入记忆的估算 token 上限（0 = 不按 token 限制；中文约每个字符 1 token）。',
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
      captureSubagentsLabel: 'captureSubagents \u2014 保留每个子代理最终答复的有界摘录。',
      scopeMaxBytesLabel: '工作区摘要预算 (scopeMaxBytes)',
      scopeMaxBytesHint: 'scopedMemory 开启时工作区摘要的注入字节预算。',
      redactSecretsLabel: 'redactSecrets \u2014 注入前对疑似凭据文本脱敏。',
      readOnlyScopesLabel: '只读作用域 (readOnlyScopes)',
      readOnlyScopesHint: '禁止写入的作用域键，逗号分隔（global、ws-*、project-* 或 *）。',
      embeddingBaseURLLabel: '嵌入端点 (embeddingBaseURL)',
      embeddingBaseURLHint: 'vector 检索的 OpenAI 兼容 /embeddings 端点（空 = 本地哈希向量）。',
      embeddingApiKeyLabel: '嵌入 API 密钥 (embeddingApiKey)',
      embeddingApiKeyHint: '嵌入端点的 API 密钥（以掩码显示；留空表示保留已保存的密钥）。',
      secretSetHint: '已保存密钥；留空即保持不变。',
      embeddingModelLabel: '嵌入模型 (embeddingModel)',
      embeddingModelHint: '嵌入模型 id（空 = 本地哈希向量）。',
      seedFromAgentsMdLabel: 'seedFromAgentsMd \u2014 用 AGENTS.md 导入初始摘要。',
      save: '保存',
      saving: '保存中\u2026',
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


    // ---------------------------------------------------------------------
    // The settings form.
    //
    // DSH 0.1.7 removed both the `settings.plugin.item` slot and the
    // provider-side settings namespace: a plugin's form now lives on the
    // Plugins page as the configuration of the row its bundle patch declares,
    // registered by the plugin itself into `plugins.row.config` (keyed
    // `<bundle>#<rowId>`) and gated by `configForms.whileServed`. This bundle
    // supports that line and 0.2.x only, so the primitives it renders with
    // (SettingsForm / SettingsFormModel / SettingsValueField) are taken as
    // present.
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
      ['injectTokens', 'number'],
      ['consolidateMaxBytes', 'number'],
      ['keepSummaryVersions', 'number'],
      ['rawArchiveMaxBytes', 'number'],
      ['autoSummarize', 'bool'],
      ['captureSubagents', 'bool'],
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
      ctx.effect(function () { return ctx.locale.register(NS, { en: en, zh: zh }) }, 'dsh-memory: locale')
      // The Plugins-page form is the only settings surface: DSH 0.1.7 removed
      // both the `settings.plugin.item` slot and the provider-side namespace,
      // so the card the 0.1.5 line needed is gone with that line.
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
