// "Start with the exercises you didn't get to" (#985): a planned session that ended early leaves
// the rest of its routine for next time. Read back from the last saved workout and its routines,
// nothing stored but which offer was answered (S.leftoverSeen, the workout's key), so a phone and
// a laptop agree and an answered offer never comes back.
//
//   leftoversOf(S, today)   { key, d, routines: [{ id, name }], ex: [{ rid, id }] } or null
//   leftoversBefore(S, today, ids)   the same, minus the routines `ids` (the session about to
//                           start) already holds: those exercises come with it anyway
//   leadEntries(S, lead)    the session entries for them, built like Start builds a routine's
import { buildCombinedEntries } from './session-merge.js'
import { canonicalExId } from './exercises.js'

// An offer older than this is a different week's plan, not a session to finish.
export const LEFTOVER_DAYS = 7
const DAY = 86400000
const isISO = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
const keyOf = w => String(w.id ?? `${w.d}|${w.start}`)
const days = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / DAY)

/** The most recent saved workout, newest date first, then the later start. */
function lastWorkout(S, today) {
  let best = null
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    if (!w || !isISO(w.d) || w.d > today) continue
    if (!best || w.d > best.d || (w.d === best.d && (Number(w.start) || 0) > (Number(best.start) || 0))) best = w
  }
  return best
}

export function leftoversOf(S, today) {
  const w = lastWorkout(S, today)
  if (!w || days(w.d, today) > LEFTOVER_DAYS || S?.leftoverSeen === keyOf(w)) return null
  const rids = [...new Set([].concat(w.routineIds || [], w.routineId || []).filter(Boolean))]
  // A session with nothing logged was ticked off as done (a day marked done, an import), not
  // cut short: there is nothing it "didn't get to".
  if (!rids.length || !(Array.isArray(w.entries) && w.entries.length)) return null
  const done = new Set((w.entries || []).map(e => canonicalExId(String(e?.id))))
  const routines = [], ex = []
  for (const rid of rids) {
    const r = (S.routines || []).find(x => x && x.id === rid)
    if (!r) continue
    const left = (r.ex || []).filter(e => e && e.id != null && !done.has(canonicalExId(String(e.id))))
    if (!left.length) continue
    routines.push({ id: r.id, name: r.name })
    for (const e of left) ex.push({ rid: r.id, id: String(e.id) })
  }
  return ex.length ? { key: keyOf(w), d: w.d, routines, ex } : null
}

export function leftoversBefore(S, today, ids = []) {
  const left = leftoversOf(S, today)
  if (!left) return null
  const skip = new Set([].concat(ids || []))
  const ex = left.ex.filter(x => !skip.has(x.rid))
  if (!ex.length) return null
  const keep = new Set(ex.map(x => x.rid))
  return { ...left, ex, routines: left.routines.filter(r => keep.has(r.id)) }
}

/** Session entries for the leftovers, in their routine's order, each with its routine's `rid`. */
export function leadEntries(S, lead) {
  if (!lead?.ex?.length) return []
  const want = new Set(lead.ex.map(x => `${x.rid}|${x.id}`))
  const rids = [...new Set(lead.ex.map(x => x.rid))]
  return buildCombinedEntries(S, rids).entries.filter(e => want.has(`${e.rid}|${e.id}`))
}
