/* How much of this device's copy the server has not seen yet.
 *
 * Signing out and disconnecting refuse to wipe a copy that still owes the server something, and
 * say how much ("3 changes are not on your server"). The store keeps a small fingerprint of the
 * last copy this device and the server agreed on — one hash per workout, weigh-in, routine and
 * custom exercise, one for everything else (settings, the week plan, working weights, notes) —
 * and counts what differs from it. It is a count of things touched, not a diff: two edits to the
 * same workout are one change, and a changed setting and a changed plan are one change together.
 */

const list = v => (Array.isArray(v) ? v : [])

// FNV-1a over the JSON text: cheap, stable across runs, and plenty to tell an entry that is the
// same from one that was edited.
function hash(v) {
  const s = JSON.stringify(v) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

const workoutKey = w => (w?.id != null ? w.id : `${w?.d}|${w?.start}`)
// The lists counted entry by entry, keyed the way lib/sync-merge.js unions them.
const LISTS = {
  w: ['workouts', workoutKey],
  b: ['bodyweight', e => e?.d],
  r: ['routines', r => r?.id],
  c: ['customEx', e => e?.id],
}
// Not content: the stamp and the revision say when, not what; the running workout never syncs.
const NOT_CONTENT = new Set(['_ts', '_rev', 'active', ...Object.values(LISTS).map(([f]) => f)])

/** A fingerprint of `S`: per-entry hashes of the counted lists, one hash (`s`) for the rest. */
export function syncFingerprint(S) {
  const fp = {}
  for (const [k, [field, key]] of Object.entries(LISTS)) {
    fp[k] = {}
    for (const x of list(S?.[field])) {
      const id = key(x)
      if (id != null) fp[k][id] = hash(x)
    }
  }
  const rest = {}
  for (const f of Object.keys(S || {}).sort()) if (!NOT_CONTENT.has(f)) rest[f] = S[f]
  fp.s = hash(rest)
  return fp
}

/**
 * How many entries of `S` were added, edited or removed since the copy `fp` was taken of, plus
 * one when anything else changed. null when there is no fingerprint to compare with — the device
 * last agreed with the server before it kept one, so it cannot say how much is waiting.
 */
export function countChanges(S, fp) {
  if (!fp || typeof fp !== 'object') return null
  const now = syncFingerprint(S)
  let n = now.s !== fp.s ? 1 : 0
  for (const k of Object.keys(LISTS)) {
    const a = now[k] || {}
    const b = fp[k] || {}
    for (const id of Object.keys(a)) if (a[id] !== b[id]) n++
    for (const id of Object.keys(b)) if (!(id in a)) n++
  }
  return n
}
