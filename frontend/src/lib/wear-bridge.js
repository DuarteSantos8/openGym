// The phone's half of the Wear OS companion (frontend/android/wear). Two pure translations and one
// decision, so the training logic around the watch can be pinned by tests the way the rest of
// src/lib is. Nothing here talks to the watch: wear-link.js hands these to WearBridgePlugin.java.
//
// The watch is a recorder, not a second source of truth. It receives a routine already worked out
// the way a session start works it out (the progression applied, drops and bursts filled in), logs
// against it offline, and sends the finished session back under an id it made itself. The phone
// turns that into the `active` object the workout screen would have built and closes it through
// the same path as "Finish" (sheets.jsx doFinishWorkout), so PRs, progression and sync-merge see
// a workout like any other.
//
// Wire format, version 1 (JSON in a Wearable DataItem; keep wear/.../Wire.kt in step):
//
//   snapshot  { v, kind: 'snapshot', routineId, name, unit, ts, skipped: [{ id, name }],
//               exercises: [{ id, name, mode: 'reps' | 'time', perSide, step, ctx, sets: [Set] }] }
//   step      what one click of the crown changes the load by (the exercise's own increment)
//   Set       { w, r | sec, phase?: 'warmup', side?: 'L' | 'R', type?: 'dropset' | 'restpause',
//               failure?, max?, rest, drops?: [{ w, r }], clusters?: [{ r, restSec }] }
//   session   { v, id, routineId, name, unit, start, end,
//               exercises: [{ id, ctx, sets: [Set & { done, at? }] }] }
//
// `ctx` is the exercise's session bookkeeping (target, planned, rid, noProg, sg). The watch keeps
// it and echoes it back untouched, so a session is read back against the target it was built
// with even if the routine is edited while the watch is in the gym.
import { buildSessionEntries } from './session-start.js'
import { restSecFor, warmupRestSecFor } from './supersetFlow.js'
import { weightIncrement, DEFAULT_SEC_INCREMENT } from './progression.js'
import { modeOf, isPerSide } from './history.js'
import {
  isWarmupRow, isSideSet, isDropSet, isRestPauseSet, isFailureSet, dropsOf, clustersOf,
  makeSideSet, syncSideAggregate, hasCompletedWork,
} from './workout-model.js'
import { isoOf } from './format.js'

export const WEAR_SCHEMA = 1

// Bounds on what the watch may send. The watch is paired and signed with the same key, but its
// payload still becomes a saved workout, so nothing in it is trusted to be sane.
const MAX_EXERCISES = 100
const MAX_SETS = 100
const MAX_EXTRAS = 20
const MAX_WEIGHT = 2000
const MAX_REPS = 1000
const MAX_SEC = 24 * 3600
const MAX_CTX_CHARS = 8000
const ID_RE = /^[A-Za-z0-9._-]{8,64}$/

const LB_PER_KG = 2.2046226218

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const clampNum = (v, max) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0
}

// ------------------------------------------------------------------ phone -> watch

const unitOf = state => (state?.unit === 'lb' ? 'lb' : 'kg')

function wireSet(row, entry, idx, restSec, perSide) {
  const warm = isWarmupRow(row)
  const out = { w: clampNum(row.w, MAX_WEIGHT) }
  if (modeOf(entry.target) === 'time') out.sec = clampNum(row.sec, MAX_SEC)
  else out.r = clampNum(row.r, MAX_REPS)
  if (warm) out.phase = 'warmup'
  if (row.side === 'L' || row.side === 'R') out.side = row.side
  if (isFailureSet(row)) out.failure = true
  if (row.max === true) out.max = true
  // A per-side row logs one total on the watch; the phone splits it between the sides again
  // (sessionRow), so an intensifier planned per limb is not carried over.
  if (!perSide) {
    if (isDropSet(row)) {
      const drops = dropsOf(row).slice(0, MAX_EXTRAS).map(d => ({ w: clampNum(d?.w, MAX_WEIGHT), r: clampNum(d?.r, MAX_REPS) }))
      if (drops.length) { out.type = 'dropset'; out.drops = drops }
    } else if (isRestPauseSet(row)) {
      const clusters = clustersOf(row).slice(0, MAX_EXTRAS).map(c => ({ r: clampNum(c?.r, MAX_REPS), restSec: clampNum(c?.restSec, 600) }))
      if (clusters.length) { out.type = 'restpause'; out.clusters = clusters }
    }
  }
  // The rest this set earns, resolved here with the rules the workout screen uses, so the watch
  // has none of them to keep in step. Ramp sets rest as a ramp (warmupRestSecFor); a drop-set or
  // rest-pause row rests once, after all of it.
  out.rest = warmupRestSecFor(entry, idx, restSec)
  return out
}

/**
 * A routine as the watch records it: the session the phone would start for it, flattened to what
 * the watch can show. Cardio is left out (`skipped`); the watch is for lifting. Exercises run in
 * routine order on the watch, so a superset is done one exercise after the other there (its
 * pairing is kept in `ctx.sg` and survives into the saved workout).
 *
 * `nameOf(entry)` is the exercise's display name (the glue passes the catalogue's).
 */
export function routineToWatchSnapshot(routine, state, { nameOf = e => e.id, now = Date.now() } = {}) {
  if (!isObj(routine) || !routine.id) return null
  const entries = buildSessionEntries(state, routine)
  const exercises = []
  const skipped = []
  entries.forEach(entry => {
    const mode = modeOf(entry.target)
    if (mode === 'cardio') { skipped.push({ id: entry.id, name: nameOf(entry) }); return }
    const perSide = isPerSide(entry.target) && mode === 'reps'
    const restSec = restSecFor([entry], [0], state?.restSec)
    const ctx = { target: entry.target }
    if (entry.planned) ctx.planned = entry.planned
    if (entry.sg) ctx.sg = entry.sg
    if (entry.noProg === true) ctx.noProg = true
    exercises.push({
      id: entry.id,
      name: nameOf(entry),
      mode,
      perSide,
      step: mode === 'time' ? DEFAULT_SEC_INCREMENT : weightIncrement(entry.target, unitOf(state)),
      ctx,
      sets: entry.sets.slice(0, MAX_SETS).map((row, i) => wireSet(row, entry, i, restSec, perSide)),
    })
  })
  return {
    v: WEAR_SCHEMA,
    kind: 'snapshot',
    routineId: routine.id,
    name: String(routine.name || ''),
    unit: unitOf(state),
    ts: now,
    skipped,
    exercises,
  }
}

/** The index the watch picks a routine from: ids and names, in the order the app lists them. */
export function routineIndexForWatch(state, { now = Date.now() } = {}) {
  return {
    v: WEAR_SCHEMA,
    kind: 'index',
    unit: unitOf(state),
    ts: now,
    routines: (state?.routines || []).filter(r => r?.id).map(r => ({
      id: r.id, name: String(r.name || ''), exercises: (r.ex || []).length,
    })),
  }
}

// ------------------------------------------------------------------ watch -> phone

const convertWeight = (w, from, to) => {
  if (!(w > 0) || from === to) return w
  const v = from === 'kg' ? w * LB_PER_KG : w / LB_PER_KG
  return Math.round(v * 2) / 2
}

// One logged row, in the shape the workout screen keeps it. A row not done is what the plan said,
// untouched, exactly as "finish early" leaves it.
function sessionRow(s, { mode, perSide, conv }) {
  const done = s.done === true
  const w = conv(clampNum(s.w, MAX_WEIGHT))
  const at = Number.isFinite(Number(s.at)) && Number(s.at) > 0 ? Number(s.at) : null

  if (mode === 'time') {
    const row = { sec: clampNum(s.sec, MAX_SEC), w, done }
    if (s.side === 'L' || s.side === 'R') row.side = s.side
    if (s.phase === 'warmup') row.phase = 'warmup'
    if (s.failure === true && s.phase !== 'warmup') row.failure = true
    if (done && at) row.at = at
    return row
  }

  const r = clampNum(s.r, MAX_REPS)
  const row = { w, r, done }
  if (s.phase === 'warmup') row.phase = 'warmup'
  if (s.failure === true && s.phase !== 'warmup') row.failure = true
  if (s.max === true) row.max = true
  if (done && at) row.at = at

  if (perSide) {
    // One total came back; the sides get it back as evenly as it divides (an odd rep goes left).
    const sided = makeSideSet({ ...row, done: false })
    const left = Math.ceil(r / 2)
    const next = {
      ...sided,
      sides: { L: { ...sided.sides.L, r: left, done }, R: { ...sided.sides.R, r: r - left, done } },
    }
    if (done && at) next.at = at
    return syncSideAggregate(next)
  }

  if (s.type === 'dropset' && Array.isArray(s.drops) && s.drops.length) {
    row.type = 'dropset'
    row.drops = s.drops.slice(0, MAX_EXTRAS).map(d => ({ w: conv(clampNum(d?.w, MAX_WEIGHT)), r: clampNum(d?.r, MAX_REPS) }))
  } else if (s.type === 'restpause' && Array.isArray(s.clusters) && s.clusters.length) {
    const clusters = s.clusters.slice(0, MAX_EXTRAS).map(c => ({ r: clampNum(c?.r, MAX_REPS), restSec: clampNum(c?.restSec, 600) }))
    // A rest-pause row's own reps are the total across every burst (docs/dev/SET_TYPES.md): the
    // clusters are how it breaks down, so what was logged is the sum, never a separate number.
    row.type = 'restpause'
    row.clusters = clusters
    row.r = clusters.reduce((n, c) => n + c.r, 0)
  }
  return row
}

const cleanCtx = value => {
  if (!isObj(value)) return null
  try { if (JSON.stringify(value).length > MAX_CTX_CHARS) return null } catch { return null }
  return value
}

/**
 * Why a payload cannot become a workout, or null when it can. Kept apart from the conversion so
 * the glue can tell "ack and drop" (a payload nobody can ever read) from "try again later".
 */
export function watchSessionProblem(payload) {
  if (!isObj(payload)) return 'not an object'
  if (payload.v !== WEAR_SCHEMA) return 'unknown version'
  if (typeof payload.id !== 'string' || !ID_RE.test(payload.id)) return 'bad id'
  if (!(Number(payload.start) > 0)) return 'no start'
  if (!Array.isArray(payload.exercises) || payload.exercises.length > MAX_EXERCISES) return 'no exercises'
  for (const ex of payload.exercises) {
    if (!isObj(ex) || typeof ex.id !== 'string' || !ex.id || !Array.isArray(ex.sets) || ex.sets.length > MAX_SETS) return 'bad exercise'
  }
  return null
}

/**
 * The `active` object a session logged on the watch stands for: the shape beginWorkout builds, with
 * every row the watch ticked already done and stamped. null for a payload that cannot be read
 * (watchSessionProblem says why). The id is the watch's, so the workout it becomes keeps it and a
 * second delivery of the same session is recognised (classifyWatchSession).
 */
export function watchSessionToActive(payload, state) {
  if (watchSessionProblem(payload)) return null
  const unit = unitOf(state)
  const from = payload.unit === 'lb' ? 'lb' : 'kg'
  const conv = w => convertWeight(w, from, unit)
  const routine = (state?.routines || []).find(r => r.id === payload.routineId) || null

  const entries = payload.exercises.map(ex => {
    const ctx = cleanCtx(ex.ctx)
    // Without its echo, fall back to what the routine says today; without a routine, to the bare id.
    const cfg = (routine?.ex || []).find(c => c.id === ex.id)
    const target = isObj(ctx?.target) ? { ...ctx.target } : cfg ? { ...cfg } : { id: ex.id }
    if (from !== unit && target.weight > 0) target.weight = conv(target.weight)
    const mode = modeOf({ ...target, id: ex.id })
    const perSide = isPerSide(target) && mode === 'reps'
    const sets = ex.sets.map(s => sessionRow(isObj(s) ? s : {}, { mode, perSide, conv }))
    const rid = typeof ctx?.rid === 'string' ? ctx.rid : routine?.id
    return {
      id: ex.id,
      ...(typeof ctx?.sg === 'string' || typeof ctx?.sg === 'number' ? { sg: ctx.sg } : {}),
      target,
      sets,
      ...(isObj(ctx?.planned) ? { planned: ctx.planned } : {}),
      ...(rid ? { rid } : {}),
      ...(ctx?.noProg === true ? { noProg: true } : {}),
    }
  })

  const start = Number(payload.start)
  return {
    id: payload.id,
    d: isoOf(new Date(start)),
    start,
    routineIds: routine ? [routine.id] : [],
    name: String(payload.name || routine?.name || '').trim() || 'Freestyle',
    bw: null,
    cur: 0,
    entries,
    workoutView: state?.workoutView || 'cards',
  }
}

/** When the session ended on the watch: its own end, else its last tick, else nothing known. */
export function watchSessionEnd(payload) {
  const end = Number(payload?.end)
  if (end > Number(payload?.start)) return end
  const ticks = (payload?.exercises || []).flatMap(e => e?.sets || []).map(s => Number(s?.at)).filter(n => n > 0)
  return ticks.length ? Math.max(...ticks) : null
}

/**
 * What to do with a session that has arrived, decided from the state alone:
 *   'invalid'    nothing can ever be made of it; the watch should drop it (ack) -- except when
 *                `reason` is 'unknown version': a newer watch app wrote it, so it waits
 *   'duplicate'  the phone already has that workout, or had it and it was deleted; ack, add nothing
 *   'empty'      the watch ticked nothing; ack and save nothing (a live session asks first, but
 *                there is nobody to ask a watch's leftover)
 *   'conflict'   the phone has a workout of its own going; nothing is touched, the user chooses
 *   'finish'     close it through the normal path
 * `active` comes with 'finish' and 'conflict'.
 */
export function classifyWatchSession(payload, state) {
  const problem = watchSessionProblem(payload)
  if (problem) return { action: 'invalid', reason: problem }
  const id = payload.id
  const have = (state?.workouts || []).some(w => w?.id === id)
  // A workout deleted since (it leaves a tombstone, sync-merge.js) must not come back when the
  // watch delivers the same session again.
  const gone = Number(state?.deleted?.workouts?.[id]) > 0
  if (have || gone) return { action: 'duplicate' }
  const active = watchSessionToActive(payload, state)
  if (!active) return { action: 'invalid', reason: 'unreadable' }
  if (!active.entries.some(e => e.sets.some(hasCompletedWork))) return { action: 'empty' }
  // Our own session going on, and not the very one: never overwritten.
  if (state?.active) return { action: 'conflict', active }
  return { action: 'finish', active }
}
