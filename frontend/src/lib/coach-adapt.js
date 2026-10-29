// Applying "Ask the Coach" mid-workout (the `adapt` job, api/coach/core/validate.js validateAdapt).
//
// The Coach answers with up to six changes to the unfinished part of the session running on this
// device; the lifter ticks the ones they want and they are applied here, to `S.active`, in one
// store update, the way the manual controls change a session (swap, add, remove, move, rest).
// One handler per change type and no default case: a type this file does not know does nothing.
//
// Two rules hold for every handler:
//   - A logged set is never touched. Only rows with `done` false change, and an exercise already
//     under way keeps its logged rows when it is swapped (the replacement goes in beside it).
//   - The routine behind the session does not change. These are today's numbers.
//
// A change names its exercise by the index it had when the question was asked, plus its id. By
// the time the answer is read the session may have moved on (a set ticked, an exercise added on
// the watch), so each change finds its exercise again first (resolveEntry) and is marked stale
// when it cannot: never applied to whatever now sits at that index.
import { isWarmupRow, isSideSet, syncSideAggregate, hasCompletedWork } from './workout-model.js'
import { supersetUnits, modeOf, barFloor, liveReramp } from './history.js'
import { insertionIndexAfterCurrentUnit } from './supersetFlow.js'
import { buildSessionEntry, plannedConfigOf, builtOutOfProgression } from './session-start.js'
import { swapActiveExercise } from './active-exercise-swap.js'
import { dropGrid } from './plates.js'
import { snapDown } from './warmup-snap.js'
import { exView, inEntryUnit } from './ex-unit.js'
import { isAssisted, EXIDX } from './exercises.js'
import { joinSessionNoProg } from './session-noprog.js'

export const ADAPT_TYPES = ['swap', 'sets', 'reps', 'weight', 'add', 'skip', 'move', 'rest']

const openWorkIdx = entry => (entry?.sets || []).map((s, i) => (!isWarmupRow(s) && !hasCompletedWork(s) ? i : -1)).filter(i => i >= 0)
const hasLogged = entry => (entry?.sets || []).some(s => hasCompletedWork(s))
const strip = row => {
  const { done, rir, rpe, effort, at, drops, clusters, video, weightOrigin, ...rest } = row || {}
  return { ...rest, done: false }
}

/** Whether a proposal was made for the session running now. */
export const adaptFor = (S, p) => !!p && p.kind === 'adapt' && !!S?.active && !S.active.editingWorkoutId && (!p.activeId || p.activeId === S.active.id)

/**
 * The entry a change is about, now: the one at its index when that is still the same exercise,
 * else the only one of that exercise in the session. -1 when neither holds.
 */
export function resolveEntry(active, c) {
  const list = active?.entries || []
  if (!Number.isInteger(c?.entry)) return -1
  if (list[c.entry]?.id === c.exId) return c.entry
  const same = list.map((e, i) => (e?.id === c.exId ? i : -1)).filter(i => i >= 0)
  return same.length === 1 ? same[0] : -1
}

/** Each change with `stale` set when it can no longer be applied to the session as it is. */
export function markAdaptStale(S, p) {
  const live = adaptFor(S, p)
  return (p?.changes || []).map(c => {
    if (!live || !ADAPT_TYPES.includes(c.type)) return { ...c, stale: true }
    if (c.type === 'add') return { ...c, stale: !!EXIDX[c.to] ? false : true }
    const at = resolveEntry(S.active, c)
    if (at < 0) return { ...c, stale: true }
    const entry = S.active.entries[at]
    if (!openWorkIdx(entry).length) return { ...c, stale: true }
    if (c.type === 'move' && (hasLogged(entry) || entry.sg)) return { ...c, stale: true }
    if (c.type === 'swap' && !EXIDX[c.to]) return { ...c, stale: true }
    return { ...c, stale: false }
  })
}

const routineOf = (s, entry) => (entry?.rid ? (s.routines || []).find(r => r.id === entry.rid) : null) || null

/** A new entry for exercise `id` built the way an exercise added to this session is built. */
function newEntry(s, id, cfg, slot) {
  const routine = routineOf(s, slot)
  const built = buildSessionEntry(s, id, cfg, routine, slot)
  return joinSessionNoProg(s.active, {
    id, ...built,
    ...(slot?.rid ? { rid: slot.rid, addedInSession: true } : {}),
    ...(routine && builtOutOfProgression(slot, routine) ? { noProg: true } : {}),
  })
}

const HANDLERS = {
  swap(s, entry, c) {
    const idx = s.active.entries.indexOf(entry)
    const open = openWorkIdx(entry).length
    const cfg = { ...plannedConfigOf(entry), id: c.to, sets: Math.max(1, open), ...(c.reps ? { reps: c.reps } : {}), ...(c.weight > 0 ? { weight: c.weight } : {}) }
    // A slot swapped means the sets you wanted to do of one exercise go to another; the routine
    // slot it stands in for stays the same (swapActiveExercise keeps `rid` and the superset).
    const replacement = newEntry(s, c.to, cfg, entry)
    if (!hasLogged(entry)) { swapActiveExercise(s.active, idx, replacement); return }
    // Under way: the logged rows stay where they are, the open ones go to the replacement.
    entry.sets = entry.sets.filter(row => hasCompletedWork(row))
    swapActiveExercise(s.active, idx, replacement, { loggedConfirmed: true, groupDisposition: 'detach' })
  },
  sets(s, entry, c) {
    const open = openWorkIdx(entry)
    const want = Math.max(0, Math.min(10, c.sets | 0))
    if (want < open.length) {
      const drop = new Set(open.slice(want))
      entry.sets = entry.sets.filter((_, i) => !drop.has(i))
      return
    }
    const work = entry.sets.filter(r => !isWarmupRow(r))
    const last = work[work.length - 1]
    if (!last) return
    for (let n = open.length; n < want; n++) entry.sets.push(isSideSet(last) ? syncSideAggregate({ ...strip(last), sides: { L: strip(last.sides.L), R: strip(last.sides.R) } }) : strip(last))
  },
  reps(s, entry, c) {
    for (const i of openWorkIdx(entry)) {
      const row = entry.sets[i]
      if (isSideSet(row)) {
        const half = Math.max(1, Math.round(c.reps / 2))
        entry.sets[i] = syncSideAggregate({ ...row, sides: { L: { ...row.sides.L, r: half }, R: { ...row.sides.R, r: half } } })
      } else if (row.r != null) entry.sets[i] = { ...row, r: c.reps }
    }
  },
  weight(s, entry, c) {
    const idx = s.active.entries.indexOf(entry)
    const factor = 1 + c.pct / 100
    // In the exercise's own unit (lib/ex-unit.js), so the rounding lands on its plates.
    inEntryUnit(s, idx, e => {
      const cfg = { ...(e.target || {}), id: e.id }
      const V = exView(s, e.id)
      const grid = dropGrid(V, cfg)
      const floor = barFloor(V, e.id)
      const move = w => (w > 0 ? Math.max(floor, snapDown(w * factor, grid)) : w)
      for (const i of openWorkIdx(e)) {
        const row = e.sets[i]
        e.sets[i] = isSideSet(row)
          ? syncSideAggregate({ ...row, sides: { L: { ...row.sides.L, w: move(row.sides.L.w) }, R: { ...row.sides.R, w: move(row.sides.R.w) } } })
          : { ...row, w: move(row.w) }
      }
      // The open warm-ups follow the new work weight.
      if (modeOf(cfg) === 'reps') e.sets = liveReramp(e.sets, grid, floor, isAssisted(cfg))
    })
  },
  add(s, entry, c) {
    const anchor = entry || s.active.entries[s.active.cur] || null
    const cfg = { id: c.to, sets: c.sets || 3, ...(c.sec ? { mode: 'time', sec: c.sec } : { reps: c.reps || 10 }), ...(c.weight > 0 ? { weight: c.weight } : {}) }
    const built = newEntry(s, c.to, cfg, anchor)
    const at = entry
      ? insertionIndexAfterCurrentUnit(supersetUnits(s.active.entries), s.active.entries.indexOf(entry), s.active.entries.length)
      : insertionIndexAfterCurrentUnit(supersetUnits(s.active.entries), s.active.cur, s.active.entries.length)
    s.active.entries.splice(at, 0, built)
  },
  skip(s, entry) {
    entry.sets = entry.sets.filter(row => hasCompletedWork(row))
    if (!entry.sets.length) s.active.entries.splice(s.active.entries.indexOf(entry), 1)
  },
  move(s, entry, c) {
    const list = s.active.entries
    list.splice(list.indexOf(entry), 1)
    if (c.place === 'last') { list.push(entry); return }
    const cur = list[s.active.cur] ? s.active.cur : list.length - 1
    // "Next": straight after the exercise you are on (its whole superset), or first when the one
    // you are on is done.
    list.splice(insertionIndexAfterCurrentUnit(supersetUnits(list), cur, list.length), 0, entry)
  },
  rest(s, entry, c) {
    const { restSec: _sec, restOff: _off, ...target } = entry.target || {}
    entry.target = c.rest > 0 ? { ...target, restSec: c.rest } : { ...target, restOff: true }
  },
}

/**
 * Apply the ticked changes of `p` to the running session in the store draft `s`. Returns the
 * ids applied; changes that went stale are skipped and reported back as not applied. All the
 * entries are found before any is changed, so a skip or a move cannot shift a later change onto
 * the wrong exercise. The marker (`s.active.cur`) stays on the exercise you were on.
 */
export function applyAdapt(s, p, acceptedIds) {
  if (!adaptFor(s, p)) return { applied: [] }
  const accepted = new Set(acceptedIds || [])
  const marked = markAdaptStale(s, p)
  const jobs = marked.filter(c => accepted.has(c.id) && !c.stale)
    .map(c => ({ c, entry: c.type === 'add' && !Number.isInteger(c.entry) ? null : s.active.entries[c.type === 'add' ? c.entry : resolveEntry(s.active, c)] || null }))
  const wasIdx = Number.isInteger(s.active.cur) ? s.active.cur : 0
  const was = s.active.entries[wasIdx] || null
  const applied = []
  for (const { c, entry } of jobs) {
    const run = HANDLERS[c.type]
    if (!run || (c.type !== 'add' && !entry)) continue
    run(s, entry, c)
    applied.push(c.id)
  }
  // The exercise you were on stays the one you are on. Swapped in place, its replacement sits
  // where it was; skipped, the marker stays at that place, on whatever comes next.
  const at = was ? s.active.entries.indexOf(was) : -1
  s.active.cur = at >= 0 ? at : Math.max(0, Math.min(wasIdx, s.active.entries.length - 1))
  return { applied }
}

/** The log line an applied (or dismissed) workout proposal leaves in the Coach's history. */
export function adaptLogEntry(p, acceptedIds, { dismissed = false } = {}) {
  const accepted = new Set(acceptedIds || [])
  return {
    kind: 'adapt', at: Date.now(), proposalId: p.id, summary: String(p.summary || '').slice(0, 600),
    ...(p.focus ? { focus: { exId: p.focus.exId, reason: p.focus.reason } } : {}),
    ...(dismissed ? { dismissed: true } : {}),
    // Each change as it was shown (its numbers too), so the history can show it again.
    decisions: (p.changes || []).map(c => ({
      id: c.id, type: c.type, why: String(c.why || '').slice(0, 300), exId: c.exId || null, to: c.to || null,
      ...Object.fromEntries(['sets', 'before', 'reps', 'sec', 'pct', 'rest', 'place'].filter(k => c[k] != null).map(k => [k, c[k]])),
      status: accepted.has(c.id) ? 'accepted' : 'rejected',
    })),
  }
}
