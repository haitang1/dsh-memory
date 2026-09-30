// dsh-memory: schemastery `meta.volatile` support.
//
// DSH 0.1.7 builds an editable settings form only for fields marked volatile
// (dsh-settings `volatileForm` returns undefined for an all-ordinary schema), and
// the Loader then commits later edits straight into the running config instead of
// re-applying the plugin. Both halves of that contract are handled here:
//
//   * `volatileField` marks a schema field live-editable where the schema library
//     supports it (schemastery grew `Schema#volatile()` on the DSH 0.1.7 line; the
//     0.1.5 line does not have it, and calling it unconditionally would break the
//     whole plugin at load time there).
//   * `plainConfig` reads the resolved config back as plain values, because a
//     volatile field resolves to a cosmokit Volatile *box* rather than the value.
//
// Kept dependency-free (node builtins only) so it can be unit-tested without the
// harness packages.

/**
 * The write hook every cosmokit Volatile box carries. Registered globally, so it
 * identifies a box across realms and package copies without importing cosmokit.
 */
const VOLATILE_WRITE = Symbol.for('cosmokit.volatile.write')

/**
 * Mark one schema field as live-editable when the schema library supports it.
 * @param field - a schemastery schema field.
 * @returns the volatile-marked field, or the field unchanged when it cannot be marked.
 */
export function volatileField(field) {
  return typeof field?.volatile === 'function' ? field.volatile() : field
}

/**
 * Whether a resolved config value is a cosmokit Volatile box.
 * @param value - a resolved config value.
 * @returns true when the value must be read through `get()`.
 */
export function isVolatileValue(value) {
  return typeof value === 'object' && value !== null && typeof value[VOLATILE_WRITE] === 'function'
}

/**
 * Read one resolved config value, unboxing a Volatile box.
 * @param value - a resolved config value.
 * @returns the plain value.
 */
export function unboxConfigValue(value) {
  return isVolatileValue(value) ? value.get() : value
}

/**
 * Read a whole resolved config record as plain values.
 *
 * Volatile boxes mutate in place when the Loader commits an edit, so calling this
 * again after such a commit yields the values the user just saved.
 * @param config - the resolved config record handed to `apply`.
 * @returns a plain-value copy.
 */
export function plainConfig(config) {
  if (config === null || typeof config !== 'object') return {}
  const plain = {}
  for (const key of Object.keys(config)) plain[key] = unboxConfigValue(config[key])
  return plain
}

/**
 * Mark a schema field as a secret where the schema library supports roles.
 *
 * `role('secret')` is what makes the Host's redaction (`SettingsForms.describe`
 * with `redactSecrets`) remove the field before a value crosses any wire
 * boundary, and what makes a settings form render it as a write-only slot.
 * The method only exists on newer schemastery lines, so a 0.1.5 deployment
 * keeps the plain field rather than failing to load.
 * @param field - the schema field to mark.
 * @returns the marked field, or the field unchanged where roles are unsupported.
 */
export function secretField(field) {
  return field !== null && typeof field === 'object' && typeof field.role === 'function'
    ? field.role('secret')
    : field
}
