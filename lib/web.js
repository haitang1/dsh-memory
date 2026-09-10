// dsh-memory Web backend: the same-origin settings endpoint for the browser
// card. Kept dependency-free (node builtins only) so it can be unit-tested
// without the harness packages; the settings seam contract is structural.
// Conflicts are detected by the stable error code SETTINGS_CONFLICT, which
// the SettingsConflictError class carries.

/** Exact route used by the browser Settings card. */
export const MEMORY_SETTINGS_ROUTE = '/_dsh/memory/settings'

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
      if (userOwns) unset.push(key)
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
 */
export function memorySettingsSnapshot(settings, readDefaults) {
  const descriptor = settings.describe().find((row) => String(row.ns) === 'memory')
  if (descriptor === undefined) throw new Error('memory settings namespace is not registered')
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
 */
export function memorySettingsRouteHandler(ctx, settings, readDefaults) {
  return async function handleMemorySettings(req, res) {
    if (req.method === 'GET') {
      try {
        settingsResponseJson(res, 200, { ok: true, value: memorySettingsSnapshot(settings, readDefaults) })
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
      const before = memorySettingsSnapshot(settings, readDefaults)
      const patch = settingsUserLayerPatch(parsed, before.settings)
      await settings.mutate('memory', settingsPatchOps(patch), parsed.expectedRevision)
      settingsResponseJson(res, 200, { ok: true, value: memorySettingsSnapshot(settings, readDefaults) })
    } catch (error) {
      const conflict = typeof error === 'object' && error !== null && error.code === SETTINGS_CONFLICT_CODE
      ctx.logger.warn('dsh-memory settings save failed: %s', settingsPublicMessage(error))
      settingsRequestError(res, conflict ? 409 : 400, conflict ? 'settings-conflict' : 'settings-rejected', settingsPublicMessage(error))
    }
  }
}

/** Register the Web settings route once the optional Web server is available. */
export function installMemorySettingsWeb(ctx, settings, readDefaults) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: MEMORY_SETTINGS_ROUTE,
      handler: memorySettingsRouteHandler(ctx, settings, readDefaults)
    }), 'dsh-memory: settings route')
  })
}
