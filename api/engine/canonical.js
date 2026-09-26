// Deterministic serialization and the deduplication key built on it. FNV-1a-64 rather than
// crypto.subtle.digest: the only hash in the tree today (update.js) is async and
// secure-context-only, and an async compile() would poison every caller (spec §8).
//
// Non-cryptographic by design — these are deduplication keys, not a security boundary.
// Nothing trusts a snapshot because of its key.

/** JSON with object keys in ascending code-unit order at every depth, undefined dropped, no whitespace. */
export function canonicalJSON(v) {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('ENGINE_NON_FINITE')
    return JSON.stringify(v)
  }
  if (Array.isArray(v)) return '[' + v.map(canonicalJSON).join(',') + ']'
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSON(v[k])).join(',') + '}'
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK64 = 0xffffffffffffffffn

/** 16 lowercase hex characters: FNV-1a-64 over the UTF-8 bytes of canonicalJSON(value). */
export function contentHash(value) {
  const bytes = new TextEncoder().encode(canonicalJSON(value))
  let h = FNV_OFFSET
  for (let i = 0; i < bytes.length; i++) h = ((h ^ BigInt(bytes[i])) * FNV_PRIME) & MASK64
  return h.toString(16).padStart(16, '0')
}

/** Recursively Object.freeze, returning the same reference. A snapshot is shared by every
 *  exposure that points at it, so an accidental mutation must throw in dev rather than
 *  silently rewrite history. */
export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const k of Object.keys(value)) deepFreeze(value[k])
  return value
}
