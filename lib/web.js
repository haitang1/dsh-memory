// dsh-memory Web backend: the same-origin settings endpoint for the browser
// card. Kept dependency-free (node builtins only) so it can be unit-tested
// without the harness packages; the settings seam contract is structural.
// Conflicts are detected by the stable error code SETTINGS_CONFLICT, which
// the SettingsConflictError class carries.

/** Exact route used by the browser Settings card. */
export const MEMORY_SETTINGS_ROUTE = '/_dsh/memory/settings'

/**
 * Settings namespaces this card may address, in probe order.
 *
 * DSH <= 0.1.5 registered the namespace explicitly (`settings.register('memory', …)`).
 * DSH 0.1.7-rc.1 removed that seam: a plugin's settings namespace is derived from
 * its loader-row id, and this bundle's cordis.patch.yml declares that row as
 * `dsh-memory`. Probe instead of hard-coding one name so the same tree works on
 * both DSH lines (the live profile still runs 0.1.5-rc.3).
 */
export const MEMORY_SETTINGS_NAMESPACES = ['memory', 'dsh-memory']

/**
 * Locate this plugin's settings descriptor under whichever namespace the running
 * DSH line exposes.
 * @param settings - the settings service face (`describe`).
 * @param namespaces - candidate namespaces, in probe order.
 * @returns `{ ns, descriptor }`, or undefined when none is registered (yet).
 */
function memorySettingsRow(settings, namespaces = MEMORY_SETTINGS_NAMESPACES) {
  // Ask the seam for the redacted view: schema `role('secret')` fields are then
  // removed from value/base/user and reported through the `secrets` sidecar, so
  // this same-origin endpoint (which any local process can read) never returns
  // the embeddings API key. A seam that ignores the option returns the plain
  // descriptor, exactly as before.
  const rows = settings.describe({ redactSecrets: true })
  for (const ns of namespaces) {
    const descriptor = rows.find((row) => String(row.ns) === ns)
    if (descriptor !== undefined) return { ns, descriptor }
  }
  return undefined
}

const SETTINGS_CONFLICT_CODE = 'SETTINGS_CONFLICT'

function settingsIsRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function settingsJsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

/**
 * Reduce a save request to the minimal user-layer patch. A field is persisted
 * only when its submitted value differs from the composed fallback (the
 * composition `base` or the schema default); a field set back to that fallback
 * drops its user-layer entry instead of pinning the default.
 *
 * This is what keeps a settings save from freezing today's defaults into the
 * user layer. Such pins outrank every later release's defaults — a stale
 * `consolidateMaxTokens: 3000` written by an older card kept capping
 * consolidation after the plugin raised that default to 8192, so every merge
 * failed with 'LLM output reached max tokens' while the plugin still looked
 * healthy.
 * @param parsed - normalized save request (`{ set, unset }`).
 * @param snapshot - `{ value, base, user, defaults }` read from the settings seam.
 * @returns the `{ set, unset }` patch to apply through `settings.mutate`.
 */
function settingsUserLayerPatch(parsed, snapshot) {
  const current = settingsIsRecord(snapshot.value) ? snapshot.value : {}
  const base = settingsIsRecord(snapshot.base) ? snapshot.base : {}
  const user = settingsIsRecord(snapshot.user) ? snapshot.user : {}
  const defaults = settingsIsRecord(snapshot.defaults) ? snapshot.defaults : {}
  const target = { ...current }
  for (const key of Object.keys(parsed.set)) target[key] = parsed.set[key]
  for (const key of parsed.unset) delete target[key]
  const explicitUnset = new Set(parsed.unset)
  const set = {}
  const unset = []
  for (const key of new Set([...Object.keys(target), ...explicitUnset])) {
    const userOwns = Object.prototype.hasOwnProperty.call(user, key)
    if (!Object.prototype.hasOwnProperty.call(target, key)) {
      // An explicit clear always reaches the seam. A redacted read cannot show
      // user-layer ownership of a `role('secret')` field (its value is removed
      // from `user` too, with only the `secrets` sidecar left), and an unset
      // for an entry the user layer does not own is a no-op.
      if (userOwns || explicitUnset.has(key)) unset.push(key)
      continue
    }
    const fallback = Object.prototype.hasOwnProperty.call(base, key) ? base[key] : defaults[key]
    if (fallback !== undefined && settingsJsonEqual(target[key], fallback)) {
      if (userOwns) unset.push(key)
      continue
    }
    if (settingsJsonEqual(target[key], current[key]) && !explicitUnset.has(key)) continue
    set[key] = target[key]
  }
  return { set, unset }
}

/** Path-addressed edits for `settings.mutate`, ordered unset-then-set. */
function settingsPatchOps(patch) {
  const ops = []
  for (const key of patch.unset) ops.push({ op: 'unset', path: [key] })
  for (const key of Object.keys(patch.set)) ops.push({ op: 'set', path: [key], value: patch.set[key] })
  return ops
}

function settingsResponseJson(res, status, body) {
  const bytes = Buffer.from(JSON.stringify(body))
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
  res.writeHead(status)
  res.end(bytes)
}

function settingsRequestError(res, status, code, message) {
  settingsResponseJson(res, status, { ok: false, error: { code, message } })
}

function settingsSameOriginPost(req) {
  const fetchSite = req.headers['sec-fetch-site']
  if (fetchSite === 'cross-site') return false
  const origin = req.headers.origin
  if (origin === undefined) return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none'
  const host = req.headers.host
  if (host === undefined) return false
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

async function settingsReadJson(req, maxBytes = 64 * 1024) {
  const contentType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') throw new TypeError('Content-Type must be application/json')
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError(`request body exceeds ${maxBytes} bytes`)
    chunks.push(part)
  }
  if (chunks.length === 0) throw new TypeError('request body is empty')
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function parseSettingsRequest(value) {
  if (!settingsIsRecord(value) || typeof value.action !== 'string') throw new TypeError('request action is required')
  if (value.action === 'save') {
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) throw new TypeError('save.expectedRevision must be a non-negative integer')
    if (value.set !== undefined || value.unset !== undefined) {
      const set = value.set === undefined ? {} : value.set
      const unset = value.unset === undefined ? [] : value.unset
      if (!settingsIsRecord(set)) throw new TypeError('save.set must be an object')
      if (!Array.isArray(unset) || unset.some((key) => typeof key !== 'string' || key.length === 0)) throw new TypeError('save.unset must be an array of non-empty field names')
      return { action: 'save', expectedRevision: value.expectedRevision, set, unset }
    }
    // Legacy card payload: the whole desired section. Normalized into the same
    // minimal patch below, so an old client cannot pin defaults either.
    if (!settingsIsRecord(value.value)) throw new TypeError('save.value must be an object')
    return { action: 'save', expectedRevision: value.expectedRevision, set: value.value, unset: [] }
  }
  throw new TypeError(`unsupported action: ${value.action}`)
}

function settingsPublicMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Read the memory namespace descriptor straight from the settings seam (no secrets to redact).
 * @param settings - the settings provider face (`describe`, `mutate`, `writable`).
 * @param readDefaults - optional reader of the schema defaults, so the card can
 *   tell "unset this override" from "set this value" without guessing.
 * @param namespaces - candidate namespaces, in probe order.
 */
export function memorySettingsSnapshot(settings, readDefaults, namespaces = MEMORY_SETTINGS_NAMESPACES) {
  const found = memorySettingsRow(settings, namespaces)
  if (found === undefined) throw new Error('memory settings namespace is not registered')
  const descriptor = found.descriptor
  let defaults
  if (typeof readDefaults === 'function') {
    try {
      defaults = readDefaults()
    } catch {
      defaults = undefined
    }
  }
  return {
    schemaVersion: 1,
    writable: settings.writable,
    settings: {
      value: descriptor.value,
      ...descriptor.base === undefined ? {} : { base: descriptor.base },
      ...descriptor.user === undefined ? {} : { user: descriptor.user },
      ...defaults === undefined ? {} : { defaults },
      ...Array.isArray(descriptor.secrets) ? { secrets: descriptor.secrets } : {},
      revision: descriptor.revision,
      applies: 'live'
    }
  }
}

/**
 * Same-origin settings endpoint for the Web plugin card. GET returns the
 * current snapshot; POST accepts `{ action: 'save', expectedRevision, set, unset }`
 * (the legacy full-section `value` payload is still normalized) and persists a
 * minimal patch through the settings seam (conflict -> 409).
 * @param ctx - owning context; only `ctx.logger` is used.
 * @param settings - the settings provider face (`describe`, `mutate`, `writable`).
 * @param readDefaults - optional schema-defaults reader forwarded to the snapshot.
 * @param namespaces - candidate namespaces, in probe order.
 */
export function memorySettingsRouteHandler(ctx, settings, readDefaults, namespaces = MEMORY_SETTINGS_NAMESPACES) {
  return async function handleMemorySettings(req, res) {
    if (req.method === 'GET') {
      try {
        settingsResponseJson(res, 200, { ok: true, value: memorySettingsSnapshot(settings, readDefaults, namespaces) })
      } catch (error) {
        ctx.logger.warn('dsh-memory settings snapshot failed: %s', settingsPublicMessage(error))
        settingsRequestError(res, 503, 'settings-unavailable', 'Memory settings are unavailable')
      }
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      settingsRequestError(res, 405, 'method-not-allowed', 'Use GET or POST')
      return
    }
    if (!settingsSameOriginPost(req)) {
      settingsRequestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application')
      return
    }
    let parsed
    try {
      parsed = parseSettingsRequest(await settingsReadJson(req))
    } catch (error) {
      settingsRequestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', settingsPublicMessage(error))
      return
    }
    try {
      if (!settings.writable) throw new Error('settings provider is read-only')
      const found = memorySettingsRow(settings, namespaces)
      if (found === undefined) throw new Error('memory settings namespace is not registered')
      const before = memorySettingsSnapshot(settings, readDefaults, namespaces)
      const patch = settingsUserLayerPatch(parsed, before.settings)
      await settings.mutate(found.ns, settingsPatchOps(patch), parsed.expectedRevision)
      settingsResponseJson(res, 200, { ok: true, value: memorySettingsSnapshot(settings, readDefaults, namespaces) })
    } catch (error) {
      const conflict = typeof error === 'object' && error !== null && error.code === SETTINGS_CONFLICT_CODE
      ctx.logger.warn('dsh-memory settings save failed: %s', settingsPublicMessage(error))
      settingsRequestError(res, conflict ? 409 : 400, conflict ? 'settings-conflict' : 'settings-rejected', settingsPublicMessage(error))
    }
  }
}

/** Register the Web settings route once the optional Web server is available. */
export function installMemorySettingsWeb(ctx, settings, readDefaults, namespaces = MEMORY_SETTINGS_NAMESPACES) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: MEMORY_SETTINGS_ROUTE,
      handler: memorySettingsRouteHandler(ctx, settings, readDefaults, namespaces)
    }), 'dsh-memory: settings route')
  })
}
