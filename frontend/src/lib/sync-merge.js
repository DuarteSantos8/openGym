/* Two copies of the account state, one merged copy.
 *
 * The server refuses a push over a document the device never saw (PUT /api/data with a stale
 * `baseRev` answers 409 and hands back the current document). Before revisions the newer `_ts`
 * simply replaced the other copy wholesale — which is exactly how a desktop tab that sat open
 * all day dropped the workout the phone logged in the meantime. The merge keeps both sides'
 * entries and lets the newer copy decide everything that has no natural union.
 *
 * Rules, by field:
 *   - scalars and settings, `week`, `dayPlan`, `wc`, `reminder`, …: from the copy with the newer `_ts`
 *   - workouts, routines, customEx, equipProfiles, gymCards: union by id, the newer copy's version
 *     of an id that both have; workouts sorted by day and start like every other writer
 *   - bodyweight: union by day, the later-edited (`t`) entry of a day that both have
 *   - favEx: ordered set union, the newer copy first
 *   - exWeights: union by exercise, the larger `w` (the app itself only ever raises it — a PR
 *     logged on the other device must not be forgotten); exNotes, barWeights: key union
 *   - `_ts`: the later of the two; `_rev` dropped (the server sets it); `active` left to the caller
 *
 * Known limit: with no record of what each side deleted, an entry removed on one device inside
 * the conflict window comes back from the other. The window is a few seconds now (the store pulls
 * on resume and every push is conditional), and a resurrected entry beats a lost one. Tombstones
 * would close it.
 */
const clone = o => JSON.parse(JSON.stringify(o))
const list = v => (Array.isArray(v) ? v : [])

/** The copy with the later `_ts`; on a tie the first argument (callers pass local first). */
export const newerOf = (a, b) => ((b?._ts || 0) > (a?._ts || 0) ? b : a)

/**
 * Entries of `newer` in their order, then those of `older` whose key nothing in `newer` has.
 * Same key → `newer`'s entry. Duplicate keys within one list are dropped (first wins).
 */
export function unionById(newer = [], older = [], key = x => x?.id) {
  const seen = new Set()
  const out = []
  for (const x of [...list(newer), ...list(older)]) {
    const k = key(x)
    if (k == null) { out.push(x); continue }
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

const workoutKey = w => (w?.id != null ? w.id : `${w?.d}|${w?.start}`)
const byDayStart = (a, b) => (a.d === b.d ? (a.start || 0) - (b.start || 0) : a.d < b.d ? -1 : 1)

/** One entry per day; where both have a day, the one edited later (`t`); sorted by day. */
export function mergeBodyweight(a = [], b = []) {
  const byDay = new Map()
  for (const e of [...list(a), ...list(b)]) {
    if (!e || e.d == null) continue
    const cur = byDay.get(e.d)
    if (!cur || (e.t || 0) > (cur.t || 0)) byDay.set(e.d, e)
  }
  return [...byDay.values()].sort((x, y) => (x.d < y.d ? -1 : 1))
}

function mergeExWeights(n = {}, o = {}) {
  const out = { ...(o || {}), ...(n || {}) }
  for (const k of Object.keys(o || {})) {
    if (n && n[k] && o[k] && (o[k].w || 0) > (n[k].w || 0)) out[k] = o[k]
  }
  return out
}

// `prefer` names the side whose settings, plan and per-exercise config win regardless of `_ts`:
// on sign-in the server's profile is the truth and the device only contributes the entries it
// logged while signed out. Without it the newer copy decides, as for a conflict between devices.
export function mergeStates(a, b, { prefer } = {}) {
  if (!a) return b ? clone(b) : b
  if (!b) return clone(a)
  const n = prefer === 'a' ? a : prefer === 'b' ? b : newerOf(a, b)
  const o = n === a ? b : a
  const out = clone(n)
  out.workouts = unionById(n.workouts, o.workouts, workoutKey).map(clone).sort(byDayStart)
  for (const f of ['routines', 'customEx', 'equipProfiles', 'gymCards']) {
    if (list(n[f]).length || list(o[f]).length) out[f] = unionById(n[f], o[f]).map(clone)
  }
  out.bodyweight = mergeBodyweight(n.bodyweight, o.bodyweight).map(clone)
  if (list(n.favEx).length || list(o.favEx).length) out.favEx = [...new Set([...list(n.favEx), ...list(o.favEx)])]
  out.exWeights = clone(mergeExWeights(n.exWeights, o.exWeights))
  for (const f of ['exNotes', 'barWeights']) {
    if (n[f] || o[f]) out[f] = clone({ ...(o[f] || {}), ...(n[f] || {}) })
  }
  out._ts = Math.max(a._ts || 0, b._ts || 0)
  delete out._rev
  return out
}

// What `local` holds that `server` does not: the workouts and weigh-ins a device logged while it
// was signed out, and the custom exercises they use. Sign-in asks about these before the server's
// profile replaces the local copy; zero of each means there is nothing to ask about.
export function localExtras(local, server) {
  const have = new Set(list(server?.workouts).map(workoutKey))
  const days = new Set(list(server?.bodyweight).map(e => e?.d))
  const ex = new Set(list(server?.customEx).map(e => e?.id))
  return {
    workouts: list(local?.workouts).filter(w => !have.has(workoutKey(w))).length,
    bodyweight: list(local?.bodyweight).filter(e => e && e.d != null && !days.has(e.d)).length,
    customEx: list(local?.customEx).filter(e => e && !ex.has(e.id)).length
  }
}
