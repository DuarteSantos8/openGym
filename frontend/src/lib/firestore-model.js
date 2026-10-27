// The Firestore shape of a profile state S (lib/firestore-sync.js does the wiring; this file
// is the pure mapping, so it can be unit-tested without the Firebase SDK).
//
//   users/{uid}                      the "meta" doc: every field of S that is not one of the
//                                    lists below (profile, week, dayPlan, settings, exWeights,
//                                    the sync stamps `deleted`/`edited`, …)
//   users/{uid}/workouts/{id}       one doc per workout, keyed the way sync-merge keys it
//   users/{uid}/routines/{id}        one doc per routine
//   users/{uid}/exercises/{id}      one doc per custom exercise
//   users/{uid}/bodyweight/{date}   one doc per weigh-in (entries are keyed by day, `d`)
//   users/{uid}/measurements/{date}  one doc per measurement check-in (also keyed by `d`)
//
// `active` (the running workout) is never part of the split: upstream sync never syncs it
// either, and a workout in progress on one device must not appear on another.
//
// One doc per item keeps every doc far under Firestore's 1 MiB ceiling no matter how long
// the history grows, and lets a device write only the entries it actually changed.
export const FB_LISTS = [
  { field: 'workouts', coll: 'workouts', key: w => (w?.id != null ? String(w.id) : `${w?.d}|${w?.start}`) },
  { field: 'routines', coll: 'routines', key: r => String(r?.id) },
  { field: 'customEx', coll: 'exercises', key: e => String(e?.id) },
  { field: 'bodyweight', coll: 'bodyweight', key: e => String(e?.d) },
  { field: 'measurements', coll: 'measurements', key: e => String(e?.d) },
]

const LIST_FIELDS = new Set(FB_LISTS.map(l => l.field))

// Firestore document ids: any UTF-8 except '/', never '.'/'..' or '__…__'. Item keys are
// app-generated ids or dates, plus the workout fallback `${d}|${start}`, percent-encoding
// covers every case uniformly and decodes back to the exact key.
export const docIdFor = key => encodeURIComponent(String(key))
export const keyForDocId = id => { try { return decodeURIComponent(id) } catch { return id } }

// Firestore refuses `undefined` anywhere and arrays directly inside arrays. The state comes
// out of JSON storage (localStorage) so it is already JSON-shaped; this round-trip drops
// undefined leaves and detaches the copy from the live store object.
export const sanitize = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

// FNV-1a, the same hash lib/sync-changes.js fingerprints entries with, here per entry, so
// the sync layer can tell exactly which docs a change touched.
export function entryHash(v) {
  const s = JSON.stringify(v) ?? ''
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

/** S → { meta, lists: { [coll]: Map(key → entry) } }. Entries keep their original key. */
export function splitState(S) {
  const meta = {}
  for (const k of Object.keys(S || {})) {
    if (LIST_FIELDS.has(k) || k === 'active') continue
    const v = sanitize(S[k])
    if (v !== undefined) meta[k] = v
  }
  const lists = {}
  for (const { field, coll, key } of FB_LISTS) {
    const m = new Map()
    for (const x of Array.isArray(S?.[field]) ? S[field] : []) {
      if (!x || typeof x !== 'object') continue
      const k = key(x)
      if (k == null || k === 'undefined' || k === '') continue
      m.set(k, sanitize(x))
    }
    lists[coll] = m
  }
  return { meta, lists }
}

/** The reverse: { meta, lists } (as read back from Firestore) → a state-shaped object. */
export function joinDocs({ meta = {}, lists = {} } = {}) {
  const S = { ...sanitize(meta) }
  delete S._fbUpdatedAt // the meta doc's bookkeeping field, not profile data
  for (const { field, coll } of FB_LISTS) {
    const m = lists[coll]
    S[field] = m ? [...m.values()].map(sanitize) : []
  }
  return S
}

/** Per-doc hashes of a split state: { meta: hash, lists: { [coll]: Map(key → hash) } }. */
export function splitHashes(split) {
  const lists = {}
  for (const [coll, m] of Object.entries(split.lists || {})) {
    const hm = new Map()
    for (const [k, v] of m) hm.set(k, entryHash(v))
    lists[coll] = hm
  }
  return { meta: entryHash(split.meta || {}), lists }
}
