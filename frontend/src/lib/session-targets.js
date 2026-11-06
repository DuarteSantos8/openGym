// Session targets (#972, idea by soshiforehead-spec): the exact rows for ONE scheduled workout,
// written by a coach or an outside planner into the synced profile, while the routine and its
// progression stay exactly as they are.
//
//   S.sessionTargets = {
//     [id]: {
//       rid: 'routine id', d: 'YYYY-MM-DD',          // which routine, on which local day
//       unit: 'kg' | 'lb',                            // what the weights below are in (required)
//       by?: 'Coach Ana',                             // who set it, shown on the workout
//       ex: [{ id: 'exercise id', slot?: 0,           // slot: its position in the routine, for
//              rows: [{ w, r } | { w?, sec }          //   an exercise the routine holds twice
//                     + { rest?: seconds, warmup?: true }] }],
//       used?: 'workout id',                          // set when a workout with it is finished
//       _ts,                                          // edit time (a stamped map, synced per id)
//     }
//   }
//
// When that routine is started on that day (lib/session-start.js buildSessionEntries, so the
// phone, the watch's ready list and a past workout logged for that day all build the same), each
// exercise the target names opens at its rows instead of the prescription: the warm-ups first,
// typed as warm-ups, then the working rows, each with its own rest when it has one. Everything
// else about the entry is what the routine built, its target and plan included, so finishing it
// feeds the progression from what was actually lifted, held against the routine's own band.
// Nothing about the routine is written. A sync that brings a target later never touches a
// workout already running: targets are only read when a session is built.
//
// A target is used once (`used`, stamped when the workout is saved), so doing the routine twice
// that day gives the second session the plan's own rows. A target that does not fit is refused
// whole, never half applied: an exercise the routine does not have, a unit that is not kg or lb,
// a mode the rows cannot express (cardio, per-side), a row without its numbers. The start of the
// workout says so (refusalsFor), and the routine builds as it always does. A target for another
// day does nothing at all.
import { convertExact, EXACT_STORE } from './units.js'

// The longest rest a row may ask for: lib/duration.js REST_MAX (that file pulls in the locales,
// this one is read while a session is built; session-targets.test.js holds the two together).
export const REST_MAX = 15 * 60
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const TARGET_MAX_ROWS = 20
const MAX_W = 2000
const BY_MAX = 40

/** The targets for routine `rid` on day `d` not used yet, newest first, with their ids. */
export function targetsFor(S, rid, d) {
  const all = isMap(S?.sessionTargets) ? S.sessionTargets : {}
  return Object.entries(all)
    .filter(([, x]) => isMap(x) && x.rid === rid && x.d === d && !x.used && !x.off)
    .map(([id, x]) => ({ ...x, id }))
    .sort((a, b) => (b._ts || 0) - (a._ts || 0))
}

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi
const numIn = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi

/**
 * Checks a target against the routine it is for and the profile. `{ ok: true, slots }` with the
 * rows per routine position, or `{ ok: false, errors }` in plain words. `modeOf(cfg)` and
 * `isPerSide(cfg)` come from the caller (lib/history.js), so this file stays free of them.
 */
export function checkTarget(target, routine, { modeOf, isPerSide }) {
  const errors = []
  if (!isMap(target)) return { ok: false, errors: ['not a target'] }
  if (!routine || target.rid !== routine.id) errors.push('it is for another routine')
  if (typeof target.d !== 'string' || !ISO.test(target.d)) errors.push('its day is not a date (YYYY-MM-DD)')
  if (target.unit !== 'kg' && target.unit !== 'lb') errors.push('it does not say whether its weights are kg or lb')
  const list = Array.isArray(target.ex) ? target.ex : []
  if (!list.length) errors.push('it names no exercises')
  const slots = new Map()
  const exs = routine?.ex || []
  list.forEach((t, k) => {
    const where = `exercise ${k + 1}`
    if (!isMap(t) || typeof t.id !== 'string') { errors.push(`${where} has no id`); return }
    const at = t.slot != null
      ? (intIn(t.slot, 0, exs.length - 1) && exs[t.slot]?.id === t.id ? t.slot : -1)
      : exs.findIndex(e => e && e.id === t.id)
    if (at < 0) { errors.push(`${t.id} is not in this routine${t.slot != null ? ' at that place' : ''}`); return }
    if (slots.has(at)) { errors.push(`${t.id} is named twice`); return }
    const cfg = exs[at]
    const mode = modeOf(cfg)
    if (mode === 'cardio') { errors.push(`${t.id} is cardio, which a target cannot set`); return }
    if (isPerSide(cfg)) { errors.push(`${t.id} is logged per side, which a target cannot set`); return }
    const rows = Array.isArray(t.rows) ? t.rows : []
    if (!rows.length || rows.length > TARGET_MAX_ROWS) { errors.push(`${t.id} needs 1 to ${TARGET_MAX_ROWS} rows`); return }
    let bad = ''
    rows.forEach((r, i) => {
      if (bad) return
      if (!isMap(r)) { bad = `row ${i + 1} is not a row`; return }
      if (r.w != null && !numIn(r.w, 0, MAX_W)) bad = `row ${i + 1} has a weight that is not a number from 0 to ${MAX_W}`
      else if (mode === 'time' ? !intIn(r.sec, 1, 3600) : !intIn(r.r, 1, 100)) bad = mode === 'time' ? `row ${i + 1} needs seconds (sec)` : `row ${i + 1} needs reps (r)`
      else if (mode !== 'time' && r.w == null) bad = `row ${i + 1} needs a weight (w, 0 for none)`
      else if (r.rest != null && !intIn(r.rest, 0, REST_MAX)) bad = `row ${i + 1} has a rest that is not 0 to ${REST_MAX} seconds`
      else if (r.warmup != null && typeof r.warmup !== 'boolean') bad = `row ${i + 1} has a warmup that is not true or false`
    })
    if (bad) { errors.push(`${t.id}: ${bad}`); return }
    if (!rows.some(r => r.warmup !== true)) { errors.push(`${t.id} has warm-ups but no working rows`); return }
    slots.set(at, { mode, rows })
  })
  return errors.length ? { ok: false, errors } : { ok: true, slots }
}

/** One prescribed row as a session row, its weight in the profile's unit. */
function rowOf(r, mode, from, to) {
  const w = r.w == null ? 0 : from === to ? r.w : convertExact(r.w, from, to, EXACT_STORE)
  const row = mode === 'time' ? { sec: r.sec, w, done: false } : { w, r: r.r, done: false }
  if (r.warmup === true) Object.assign(row, { phase: 'warmup', warmup: true, edited: true })
  if (r.rest != null) row.restSec = r.rest
  return row
}

/**
 * The session's entries for `routine` with today's target applied (see the top of the file).
 * `entries` are buildSessionEntries' own, in the routine's order. Returns them unchanged when
 * there is no target for the day or it was refused.
 */
export function withSessionTarget(S, routine, entries, d, helpers) {
  const [target] = routine ? targetsFor(S, routine.id, d) : []
  if (!target) return entries
  const checked = checkTarget(target, routine, helpers)
  if (!checked.ok) return entries
  const to = S?.unit === 'lb' ? 'lb' : 'kg'
  return entries.map((e, i) => {
    const slot = checked.slots.get(i)
    if (!slot) return e
    const warm = slot.rows.filter(r => r.warmup === true).map(r => rowOf(r, slot.mode, target.unit, to))
    const work = slot.rows.filter(r => r.warmup !== true).map(r => rowOf(r, slot.mode, target.unit, to))
    const { carried: _carried, ...rest } = e
    return { ...rest, sets: [...warm, ...work], sessionTarget: { id: target.id, ...(typeof target.by === 'string' && target.by.trim() ? { by: target.by.trim().slice(0, BY_MAX) } : {}) } }
  })
}

/**
 * Why today's targets for these routines were refused, `[{ id, routine, errors }]`, for the start
 * of a workout to say. Only today's: a target for another day is not a problem, just not today's.
 */
export function refusalsFor(S, routines, d, helpers) {
  const out = []
  for (const r of routines || []) {
    const [target] = r ? targetsFor(S, r.id, d) : []
    if (!target) continue
    const checked = checkTarget(target, r, helpers)
    if (!checked.ok) out.push({ id: target.id, routine: r.name || '', errors: checked.errors })
  }
  return out
}

/** S.sessionTargets with the targets a finished workout used marked as used by it, stamped. */
export function markUsed(map, entries, workoutId, now = Date.now()) {
  if (!isMap(map)) return map
  const ids = new Set((entries || []).map(e => e?.sessionTarget?.id).filter(id => typeof id === 'string' && isMap(map[id])))
  if (!ids.size) return map
  const out = { ...map }
  for (const id of ids) out[id] = { ...map[id], used: String(workoutId ?? true), _ts: now }
  return out
}
