// The session as the Zepp OS watch keeps it, and every change to it, as pure functions: a port of
// the Wear OS watch's SessionCore.kt (itself the Apple Watch's WatchCore), so all three watches
// read the phone's snapshot and send the phone the same events (frontend/src/lib/watch-sync.js).
// The pages only call these, save the state after each and queue the events they return.
// Plain JavaScript with no Zepp OS import, so node --test runs it (test/session.test.js).
//
// The sync, in short:
//   - a tick made here stays pending until a snapshot shows that set done at the tick's time or
//     later; until then the snapshot's copy of the set is replaced by the watch's;
//   - the same set changed on both sides: the later tick (`at`) wins, on both sides;
//   - finished here: gone at once, a stale snapshot that still shows it does not bring it back;
//   - started here: kept until the phone reports it back, a snapshot without it does not end it.

const num = v => (typeof v === 'number' && isFinite(v) ? v : null)
const str = v => (typeof v === 'string' ? v : v == null ? null : String(v))

/* ---------- reading the phone's JSON (Model.kt) ---------- */

function sideRow (v) { return { w: num(v && v.w), r: num(v && v.r), done: !!(v && v.done === true) } }
function setRow (v) {
  const o = v && typeof v === 'object' ? v : {}
  const row = { w: num(o.w), r: num(o.r), sec: num(o.sec), done: o.done === true, warmup: o.warmup === true }
  if (num(o.at) != null) row.at = num(o.at)
  if (o.sides && typeof o.sides === 'object') row.sides = { L: sideRow(o.sides.L), R: sideRow(o.sides.R) }
  return row
}
function entry (v) {
  if (!v || typeof v !== 'object' || v.id == null) return null
  const e = {
    id: String(v.id), name: str(v.name) || String(v.id),
    mode: v.mode === 'time' || v.mode === 'cardio' ? v.mode : 'reps',
    restSec: num(v.restSec), last: str(v.last),
    sets: Array.isArray(v.sets) ? v.sets.map(setRow) : [],
  }
  if (v.bodyweight === true) e.bodyweight = true
  if (v.perSide === true) e.perSide = true
  if (v.group != null) e.group = String(v.group)
  if (v.best && typeof v.best === 'object') e.best = { w: num(v.best.w), r: num(v.best.r), sec: num(v.best.sec) }
  if (v.assisted === true) e.assisted = true
  if (num(v.step) != null) e.step = num(v.step)
  if (v.unit === 'kg' || v.unit === 'lb') e.unit = v.unit
  return e
}
const entries = v => (Array.isArray(v) ? v.map(entry).filter(Boolean) : [])
function readySession (v) {
  if (!v || typeof v !== 'object') return null
  return {
    routineIds: Array.isArray(v.routineIds) ? v.routineIds.map(String) : [],
    name: str(v.name) || '',
    entries: entries(v.entries),
    ...(v.healthType ? { healthType: String(v.healthType) } : {}),
  }
}
function active (v, unit) {
  if (!v || typeof v !== 'object') return null
  const es = entries(v.entries)
  return {
    id: str(v.id), name: str(v.name) || '', unit: v.unit === 'lb' ? 'lb' : v.unit === 'kg' ? 'kg' : unit,
    cur: Math.max(0, Math.min(es.length - 1, Math.floor(num(v.cur) || 0))),
    restSec: num(v.restSec) || 0,
    rest: v.rest && num(v.rest.endsAt) ? { endsAt: num(v.rest.endsAt) } : null,
    entries: es,
    start: num(v.start),
    activeAt: num(v.activeAt),
  }
}

/** The phone's snapshot (its JSON text or the object), or null when it is not one. */
export function parseSnapshot (json) {
  let o = json
  if (typeof json === 'string') { try { o = JSON.parse(json) } catch (e) { return null } }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null
  const unit = o.unit === 'lb' ? 'lb' : 'kg'
  const ready = o.ready && typeof o.ready === 'object'
    ? { today: readySession(o.ready.today), others: Array.isArray(o.ready.others) ? o.ready.others.map(readySession).filter(Boolean) : [] }
    : null
  const s = o.settings && typeof o.settings === 'object' ? o.settings : {}
  return {
    v: num(o.v) || 1,
    unit,
    restSec: num(o.restSec),
    active: active(o.active, unit),
    ready,
    settings: {
      restHaptics: s.restHaptics !== false,
      lang: typeof s.lang === 'string' ? s.lang : null,
      show: { hr: !(s.show && s.show.hr === false), last: !(s.show && s.show.last === false), next: !(s.show && s.show.next === false) },
    },
    discarded: Array.isArray(o.discarded) ? o.discarded.map(String) : [],
    streak: o.streak && typeof o.streak === 'object' ? { weeks: Math.max(0, Math.floor(num(o.streak.weeks) || 0)), thisWeekDone: o.streak.thisWeekDone === true } : null,
  }
}

/* ---------- the exercise ---------- */

export const isTimed = e => e.mode === 'time'
export const isCardio = e => e.mode === 'cardio'
export const weightUnit = (e, workoutUnit) => e.unit || workoutUnit
/** What one of its kilos or pounds is in `workoutUnit`, for a total that mixes exercises. */
export function factor (e, workoutUnit) {
  const own = weightUnit(e, workoutUnit)
  if (own === workoutUnit) return 1
  return own === 'lb' ? 0.45359237 : 1 / 0.45359237
}
/** The step the weight moves in: the phone's, else 2.5 kg / 5 lb. */
export const stepOf = (e, workoutUnit) => (e.step > 0 ? e.step : weightUnit(e, workoutUnit) === 'lb' ? 5 : 2.5)
/** The side up next on a per-side set ("L", then "R"), or null. */
export const sideUp = row => (row && row.sides ? (!row.sides.L.done ? 'L' : !row.sides.R.done ? 'R' : null) : null)

/* ---------- the state ---------- */

export function emptyState () {
  return {
    workout: null, ready: null, settings: { restHaptics: true, lang: null, show: { hr: true, last: true, next: true } },
    unit: 'kg', restSec: 90,
    startedHere: null, finishedHere: [], pending: {}, entryIndex: 0, skipped: [],
    streak: null, synced: false, syncedAt: 0,
  }
}

/** A saved state read back (or nothing): always the full shape. */
export function stateOf (raw) {
  const base = emptyState()
  if (!raw || typeof raw !== 'object') return base
  return { ...base, ...raw, pending: raw.pending && typeof raw.pending === 'object' ? raw.pending : {}, finishedHere: Array.isArray(raw.finishedHere) ? raw.finishedHere : [], skipped: Array.isArray(raw.skipped) ? raw.skipped : [] }
}

export const key = (exId, si, side) => (side ? exId + '#' + si + '#' + side : exId + '#' + si)

const copyRow = r => ({ ...r, ...(r.sides ? { sides: { L: { ...r.sides.L }, R: { ...r.sides.R } } } : {}) })

/** A snapshot from the phone (parsed), over what the watch has. */
export function applySnapshot (s0, snap, now = 0) {
  let s = { ...s0, ready: snap.ready, synced: true, syncedAt: now || s0.syncedAt }
  if (snap.unit) s.unit = snap.unit
  if (snap.restSec > 0) s.restSec = snap.restSec
  if (snap.settings) s.settings = snap.settings
  if (snap.streak) s.streak = snap.streak

  const wid = s.workout && s.workout.id
  const droppedThere = wid != null && (snap.discarded || []).includes(wid)
  if (droppedThere && wid === s.startedHere) s.startedHere = null
  const unconfirmed = wid != null && wid === s.startedHere
  const next0 = snap.active
  if (!next0 || (next0.id != null && s.finishedHere.includes(next0.id))) {
    // No workout on the phone, or one the watch has finished already.
    if (unconfirmed) return s
    return { ...s, workout: null, pending: {} }
  }
  const same = next0.id != null && next0.id === wid
  if (next0.id != null && next0.id === s.startedHere) s.startedHere = null
  // The phone runs a different workout than the one started here: the watch keeps its own.
  if (!same && unconfirmed) return s
  if (!same) s = { ...s, pending: {}, skipped: [], entryIndex: next0.cur }

  const pending = { ...s.pending }
  const es = next0.entries.map(e => ({
    ...e,
    sets: e.sets.map((row0, si) => {
      let row = copyRow(row0)
      const k = key(e.id, si)
      const p = pending[k]
      if (p) {
        if (row0.done && (row0.at == null ? Infinity : row0.at) >= p.at) delete pending[k]
        else row = { ...row, done: true, w: p.w != null ? p.w : row.w, r: p.r != null ? p.r : row.r, sec: p.sec != null ? p.sec : row.sec, at: p.at }
      }
      for (const side of ['L', 'R']) {
        const ks = key(e.id, si, side)
        const ps = pending[ks]
        if (!ps) continue
        if (row.sides && row.sides[side].done && (row0.at == null ? Infinity : row0.at) >= ps.at) delete pending[ks]
        else if (row.sides) row = markSide(row, side, ps.w, ps.r, ps.at)
        else delete pending[ks]
      }
      return row
    }),
  }))
  const workout = { ...next0, entries: es }
  return { ...s, workout, pending, entryIndex: Math.max(0, Math.min(es.length, s.entryIndex)) }
}

/** One side of a per-side set done, the row following both sides (the phone's syncSideAggregate). */
export function markSide (row0, side, w, r, at) {
  if (!row0.sides) return row0
  const one = { ...row0.sides[side], done: true }
  if (w != null) one.w = w
  if (r != null) one.r = r
  const sides = { ...row0.sides, [side]: one }
  return {
    ...row0, sides,
    done: sides.L.done && sides.R.done,
    r: (sides.L.r || 0) + (sides.R.r || 0),
    w: Math.max(sides.L.w || 0, sides.R.w || 0),
    at: Math.max(row0.at || 0, at),
  }
}

function withRow (s0, ei, si, row) {
  const es = s0.workout.entries.slice()
  const sets = es[ei].sets.slice()
  sets[si] = row
  es[ei] = { ...es[ei], sets }
  return { ...s0.workout, entries: es }
}

/**
 * A set ticked here: [state with it done, the event for the phone (watch-sync.js setDone)].
 * `hr` is { avg, max } measured during the set, or null.
 */
export function tick (s0, { ei, si, side = null, w = null, r = null, sec = null, at, id, hr = null }) {
  const workout = s0.workout
  const e = workout && workout.entries[ei]
  const row = e && e.sets[si]
  if (!row) return [s0, null]
  const oneSide = side && row.sides ? side : null
  const newRow = oneSide ? markSide(row, oneSide, w, r, at)
    : { ...row, done: true, w: w != null ? w : row.w, r: r != null ? r : row.r, sec: sec != null ? sec : row.sec, at }
  const s = {
    ...s0,
    workout: withRow(s0, ei, si, newRow),
    pending: { ...s0.pending, [key(e.id, si, oneSide)]: { w, r, at, sec } },
  }
  const ev = { id, type: 'setDone', wid: workout.id || '', exId: e.id, entryIdx: ei, setIdx: si, at: Math.round(at) }
  if (w != null) ev.w = w
  if (r != null) ev.r = r
  if (sec != null) ev.sec = sec
  if (oneSide) ev.side = oneSide
  if (hr && hr.avg > 0 && hr.max > 0) ev.hr = { avg: Math.round(hr.avg), max: Math.round(hr.max) }
  return [s, ev]
}

/** A set passed over here: not done, the next one comes up. */
export function skip (s0, ei, si) {
  const e = s0.workout && s0.workout.entries[ei]
  if (!e || !e.sets[si]) return s0
  const k = key(e.id, si)
  return { ...s0, skipped: s0.skipped.includes(k) ? s0.skipped : s0.skipped.concat(k).sort() }
}

export const isSkipped = (s, exId, si) => s.skipped.includes(key(exId, si))

/** The set to do next in an exercise: the one picked, or the first not done and not skipped; null for none. */
export function setIndex (s, ei, picked = null) {
  const e = s.workout && s.workout.entries[ei]
  if (!e) return null
  if (picked != null && e.sets[picked] && !e.sets[picked].done) return picked
  for (let i = 0; i < e.sets.length; i++) if (!e.sets[i].done && !isSkipped(s, e.id, i)) return i
  return null
}

/**
 * Where to go after set `si` of exercise `ei`, and whether a rest comes first: [index, rest].
 *   per-side set with a side to go   the same exercise, no rest
 *   superset                          the next exercise of the group in turn; rest after a round
 *   otherwise                         this exercise while it has sets, then the next that has;
 *                                     after the last, the Finish page (index = count)
 */
export function next (s, ei, si) {
  const w = s.workout
  const e = w && w.entries[ei]
  if (!e) return [s.entryIndex, false]
  const count = w.entries.length
  if (sideUp(e.sets[si]) != null) return [ei, false]
  const open = i => setIndex(s, i) != null
  const firstOpen = (from, to) => { for (let i = from; i < to; i++) if (open(i)) return i; return null }
  const g = e.group
  if (g != null) {
    let lo = ei, hi = ei
    while (lo > 0 && w.entries[lo - 1].group === g) lo--
    while (hi + 1 < count && w.entries[hi + 1].group === g) hi++
    if (hi > lo) {
      const members = []
      for (let i = lo; i <= hi; i++) members.push(i)
      const inTurn = members.filter(i => i > ei).concat(members.filter(i => i <= ei))
      const m = inTurn.find(open)
      if (m != null) return [m, m <= ei]
      const o = firstOpen(hi + 1, count) ?? firstOpen(0, lo)
      if (o != null) return [o, true]
      return [count, true]
    }
  }
  if (open(ei)) return [ei, true]
  const o = firstOpen(ei + 1, count) ?? firstOpen(0, ei)
  if (o != null) return [o, true]
  return [count, true]
}

/** A ready session started here (watch-sync.js start): [state, event]. */
export function start (s0, session, { wid, at, id }) {
  const workout = { id: wid, name: session.name, unit: s0.unit, cur: 0, restSec: s0.restSec, rest: null, entries: session.entries, start: at, activeAt: null }
  const s = { ...s0, workout, startedHere: wid, pending: {}, skipped: [], entryIndex: 0 }
  return [s, { id, type: 'start', routineIds: session.routineIds.slice(), wid, at: Math.round(at) }]
}

/** The session finished here, or discarded here (the phone drops it unsaved): [state, event]. */
export function finish (s0, { at, id, discard = false }) {
  const w = s0.workout
  if (!w) return [s0, null]
  const s = {
    ...s0, workout: null, pending: {}, skipped: [], startedHere: null,
    finishedHere: w.id != null ? s0.finishedHere.concat(w.id).slice(-5) : s0.finishedHere,
  }
  return [s, { id, type: discard ? 'discard' : 'finish', wid: w.id || '', at: Math.round(at) }]
}

/** Work sets done and in all, for the shortcut card's ring: [done, all]. */
export function progress (s) {
  if (!s.workout) return [0, 0]
  let done = 0, all = 0
  for (const e of s.workout.entries) for (const r of e.sets) if (!r.warmup) { all++; if (r.done) done++ }
  return [done, all]
}

/** A heavier weight (lighter when assisted), or more reps at the same; a longer hold. */
export function beatsBest (e, done, best) {
  if (isTimed(e)) {
    const b = best.sec
    if (b == null || b <= 0) return false
    return done.some(row => (row.sec || 0) > b)
  }
  const bw = best.w, br = best.r
  if (isCardio(e) || bw == null || br == null || (bw <= 0 && br <= 0)) return false
  return done.some(row => {
    const w = row.w || 0, r = row.r || 0
    if (w !== bw) return w > 0 && (e.assisted ? w < bw : w > bw)
    return r > br
  })
}

/** The workout as the summary shows it at its end. */
export function summary (w, end, { endedOnPhone = false, hr = null } = {}) {
  let sets = 0, volume = 0
  const prs = []
  for (const e of w.entries) {
    const work = e.sets.filter(r => !r.warmup)
    const f = factor(e, w.unit)
    for (const row of work) {
      if (row.sides) {
        for (const one of [row.sides.L, row.sides.R]) if (one.done) volume += (one.w || 0) * (one.r || 0) * f
        if (row.done) sets++
      } else if (row.done) {
        sets++
        if (!isTimed(e) && !isCardio(e)) volume += (row.w || 0) * (row.r || 0) * f
      }
    }
    if (e.best && beatsBest(e, work.filter(r => r.done), e.best)) prs.push(e.name)
  }
  return {
    name: w.name, unit: w.unit, duration: w.start ? Math.max(0, (end - w.start) / 1000) : null,
    sets, volume, prs, hrAvg: hr ? hr.avg : null, hrMax: hr ? hr.max : null, endedOnPhone,
  }
}

/** A weight moved by `steps` on the exercise's grid (an off-grid weight lands on it first), never below zero. */
export function stepWeight (w, step, steps) {
  const base = w || 0
  if (steps === 0 || !(step > 0)) return base
  const k = base / step
  const idx = steps > 0 ? Math.floor(k + 1e-9) + steps : Math.ceil(k - 1e-9) + steps
  return Math.max(0, Math.round(idx * step * 100) / 100)
}

export const stepReps = (r, steps) => Math.min(999, Math.max(0, (r || 0) + steps))

/* ---------- heart rate during a set ---------- */

/** Readings of one set: avg and max over what the sensor gave since it began, or null. */
export function hrOf (samples) {
  const ok = (samples || []).filter(v => v > 30 && v < 240)
  if (!ok.length) return null
  return { avg: Math.round(ok.reduce((a, b) => a + b, 0) / ok.length), max: Math.max(...ok) }
}

/* ---------- the outbox: events until the server took them ---------- */

export const OUTBOX_MAX = 300

/** Events queued, in order, newest kept when full. */
export const enqueue = (outbox, ev) => (ev ? outbox.concat(ev).slice(-OUTBOX_MAX) : outbox)
/** The server took these (`accepted` ids): out of the outbox. */
export const settle = (outbox, accepted) => {
  const gone = new Set(accepted || [])
  return outbox.filter(e => !gone.has(e.id))
}

/** An id for an event or a workout, unique enough on one watch. */
export function makeId (prefix, now, rand = Math.random) {
  return prefix + '-' + Math.round(now).toString(36) + '-' + Math.floor(rand() * 2176782336).toString(36)
}
