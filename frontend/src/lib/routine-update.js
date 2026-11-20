import { uid } from './format.js'
import { modeOf, cleanupSg } from './history.js'
import { hasCompletedWork } from './workout-model.js'
import { plannedOf } from './progression.js'
import { replaceSlotExercise } from './routines.js'
import { backupSlotConfig } from './routine-backups.js'
import { copiedEntry } from './session-routines.js'

// "Update routine from this workout" on the finish summary. A machine taken, a lift dropped for
// a sore elbow, the order shuffled to fit a busy floor: a session drifts from its routine, and
// each of those changes used to last that session only. The routine would ask for the same
// thing next time, and making the session's version stick meant redoing every swap in the
// routine editor by hand.
//
// What a session did with each slot of its routine is only readable if the session knows its
// slots. A session built from a routine (lib/session-merge.js buildCombinedEntries) therefore
// stamps each entry with the slot it was built from (`slotAt`, an index into the routine as it
// was at the start) and keeps that routine's exercises as they were (`active.startSlots`,
// { routineId: [exercise ids] }, startSlotsOf). A swap keeps `slotAt` on the replacement (lib/active-exercise-
// swap.js), an exercise added in the session has none (it is `addedInSession`, #592), and an
// exercise removed from the session simply has no entry left for its slot. A session from before
// the stamps, or one the watch started, has no `startSlots` and is never offered an update.
//
// Nothing here touches the saved workout: the routine is the only thing an update writes, and
// only when the summary's button is tapped (sheets.jsx FinishSummary).

const done = entry => Array.isArray(entry?.sets) && entry.sets.some(hasCompletedWork)

// A plan as the session start reads it (its mode, sets, reps, the range, seconds, metres),
// without the weight: history decides the weight either way (replaceSlotExercise).
function planOf(cfg) {
  const { weight: _weight, ...plan } = plannedOf(cfg)
  return { mode: modeOf(cfg), ...plan }
}
const samePlan = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The plan a swap made in a running session set of its own, or null when it took one it was
 * offered: the slot's own carried over, a backup's, or the exercise's defaults that the swap
 * sheet opens with. Only a plan of its own outlives the session in an update; otherwise the
 * new exercise takes over the slot's sets, reps and range, the way the routine editor's Replace
 * does. The first of `offered` is the slot carried over: a swap into another mode than that one
 * (a row slot swapped for a plank) keeps its plan even when it was offered, since the slot's
 * settings have nowhere to hold seconds for reps.
 */
export function swapOwnPlan(cfg, offered = []) {
  if (!cfg || cfg.id == null) return null
  const mine = planOf(cfg)
  const list = (Array.isArray(offered) ? offered : []).filter(o => o && typeof o === 'object')
  if (list.length && planOf({ ...list[0], id: cfg.id }).mode !== mine.mode) return mine
  const took = list.some(o => samePlan(planOf({ ...o, id: cfg.id }), mine))
  return took ? null : mine
}

/**
 * What a finished session did with each routine it was built from, read before the session is
 * gone (finishing clears `active`). One plan per routine of `startSlots` that still exists and
 * that the session trained at all: a routine of a combined day left untouched is not a routine
 * to rewrite as empty.
 *
 * `slots[i]` is what became of the routine's i-th exercise at the start: `to` the exercise that
 * did its work, or null when nothing was done there (removed from the session, or skipped with
 * no set ticked), `pos` where that happened in the session. A slot swapped after some of its sets
 * were logged has two entries, the original and the replacement; the last one with work is what
 * the slot became. `added` are the exercises added in the session with work done, set up as Save
 * as routine copies them (copiedEntry), at their place in the session.
 */
export function sessionRoutinePlans(active, routines) {
  const starts = active?.startSlots
  if (!starts || typeof starts !== 'object' || Array.isArray(starts)) return []
  const entries = Array.isArray(active.entries) ? active.entries : []
  const out = []
  for (const [rid, start] of Object.entries(starts)) {
    const routine = (Array.isArray(routines) ? routines : []).find(r => r?.id === rid)
    if (!routine || !Array.isArray(routine.ex) || !Array.isArray(start)) continue
    const claims = start.map(() => [])
    const added = []
    entries.forEach((e, pos) => {
      if (!e || e.rid !== rid || e.id == null) return
      if (Number.isInteger(e.slotAt) && e.slotAt >= 0 && e.slotAt < start.length) claims[e.slotAt].push(pos)
      else if (e.addedInSession === true && done(e) && !added.some(p => entries[p].id === e.id)) added.push(pos)
    })
    const slots = start.map((from, i) => {
      const worked = claims[i].filter(p => done(entries[p]))
      if (!worked.length) return { from, to: null }
      const pos = worked.at(-1)
      const e = entries[pos]
      const plan = e.id !== from && e.swapPlan && typeof e.swapPlan === 'object' ? { plan: { ...e.swapPlan } } : {}
      return { from, to: e.id, pos, ...plan }
    })
    // An exercise added and done counts too: every slot dropped for one new lift is a change.
    if (!slots.some(s => s.to != null) && !added.length) continue
    out.push({
      routineId: rid, name: routine.name, start: [...start], slots,
      added: added.map(pos => ({ pos, cfg: copiedEntry(entries[pos], routine) })),
    })
  }
  return out
}

// Where each exercise of the routine at the start sits in the routine now, or -1: the n-th bench
// press then is the n-th bench press now. An exercise the routine lost or swapped while the
// session ran has no place, and the edit made there stands. Nor has an exercise the routine has
// more or fewer of than at the start: which twin went or came can't be told by the id, and
// taking the wrong one would put the session's change on a slot it never trained.
function placesNow(start, ex) {
  const count = (list, id) => list.filter(x => (x && typeof x === 'object' ? x.id : x) === id).length
  const taken = new Set()
  return start.map(id => {
    if (count(start, id) !== count(ex, id)) return -1
    const j = ex.findIndex((x, k) => !taken.has(k) && x?.id === id)
    if (j >= 0) taken.add(j)
    return j
  })
}

// The plan a swap set of its own, on the slot that the new exercise took over. A swap into
// another mode brings it, and the old mode's numbers go with the old exercise (cardio is
// replaceSlotExercise's to switch).
function withPlan(cfg, plan) {
  const out = { ...cfg, sets: plan.sets ?? cfg.sets }
  if (plan.mode && plan.mode !== modeOf(out) && plan.mode !== 'cardio' && modeOf(out) !== 'cardio') {
    for (const key of ['reps', 'repsMin', 'repsMax', 'setsMax', 'sec', 'm']) delete out[key]
    out.mode = plan.mode
  }
  const mode = modeOf(out)
  for (const key of ['reps', 'repsMin', 'setsMax']) {
    if (mode !== 'reps') break
    if (plan[key] != null) out[key] = plan[key]
    // A plan with no range has no bottom to keep (plannedConfigOf).
    else if (key === 'repsMin') delete out.repsMin
  }
  if (mode === 'time' && plan.sec != null) out.sec = plan.sec
  if (mode === 'distance' && plan.m != null) out.m = plan.m
  return out
}

// A superset is the run of neighbours sharing a tag. After a reorder or an addition the same tag
// can turn up in two places; the later run gets a tag of its own, then a member left alone loses
// its tag (cleanupSg).
function tidyGroups(ex) {
  const used = new Set()
  let i = 0
  while (i < ex.length) {
    const tag = ex[i].sg
    if (tag == null || tag === '') { delete ex[i].sg; i++; continue }
    let end = i
    while (end + 1 < ex.length && ex[end + 1].sg === tag) end++
    if (used.has(tag)) {
      const fresh = `sg-${uid()}`
      for (let k = i; k <= end; k++) ex[k].sg = fresh
    } else used.add(tag)
    i = end + 1
  }
  cleanupSg(ex)
  return ex
}

/**
 * The routine as `plan` would leave it, read against the routine as it is now, or null when it
 * would change nothing. `{ ex, changes }`: the new exercise list and what differs, in the order
 * the summary lists them — `{ kind: 'swap', from, to }`, `{ kind: 'remove', id }`,
 * `{ kind: 'add', id }`, `{ kind: 'order' }`.
 *
 * - A swapped exercise takes over its slot's settings: rest, note, warm-ups, progression, its
 *   superset, and its sets and reps unless the swap set its own (swapOwnPlan). A planned backup
 *   takes over the way it does in a session, the old exercise becoming its first backup
 *   (backupSlotConfig); anything else the way the routine editor's Replace does
 *   (replaceSlotExercise, with `S` for the weight its own history gives it).
 * - A slot with nothing done goes.
 * - The exercises follow the session's order; an added one goes where it was done.
 * - The routine edited while the session ran keeps those edits: a slot's new note or rest is
 *   read from the slot as it is now, an exercise added to the routine stays after the one it
 *   followed, and one taken out or replaced there is not brought back.
 *
 * Sets and reps of an exercise that stayed are left alone: the progression engine moves those
 * every session, and the routine is the plan it reads them against (routineChangesFromEntry).
 */
export function rewriteRoutine(routine, plan, S, { known } = {}) {
  if (!routine || !Array.isArray(routine.ex) || !plan || !Array.isArray(plan.start) || !Array.isArray(plan.slots)) return null
  const live = routine.ex
  const at = placesNow(plan.start, live)
  const items = []
  const changes = []
  const removed = []
  plan.slots.forEach((s, i) => {
    const j = at[i]
    if (j == null || j < 0) return
    const slot = live[j]
    if (s.to == null) { removed.push({ kind: 'remove', id: slot.id }); return }
    if (s.to === slot.id) { items.push({ pos: s.pos, j, cfg: slot }); return }
    let cfg = Array.isArray(slot.subs) && slot.subs.includes(s.to)
      ? backupSlotConfig(slot, s.to, S, routine.id, typeof known === 'function' ? known : () => true)
      : replaceSlotExercise(slot, s.to, S, routine.id)
    if (s.plan) cfg = withPlan(cfg, s.plan)
    items.push({ pos: s.pos, j, cfg })
    changes.push({ kind: 'swap', from: slot.id, to: s.to })
  })
  changes.push(...removed)
  // In the session's order. Kept exercises in an order other than the routine's is a reorder.
  items.sort((a, b) => a.pos - b.pos)
  const kept = items.map(x => x.j)
  const reordered = kept.some((j, k) => k > 0 && j < kept[k - 1])
  for (const a of Array.isArray(plan.added) ? plan.added : []) {
    const id = a?.cfg?.id
    if (id == null || live.some(x => x?.id === id) || items.some(x => x.cfg.id === id)) continue
    const k = items.findIndex(x => x.pos > a.pos)
    items.splice(k < 0 ? items.length : k, 0, { pos: a.pos, cfg: a.cfg })
    changes.push({ kind: 'add', id })
  }
  if (reordered) changes.push({ kind: 'order' })
  if (!changes.length) return null
  // What the routine has that the start did not: after the exercise it follows there.
  const placed = new Set(at.filter(j => j >= 0))
  live.forEach((slot, j) => {
    if (placed.has(j)) return
    let k = -1
    items.forEach((x, n) => { if (x.j != null && x.j < j) k = n })
    items.splice(k + 1, 0, { j, cfg: slot })
  })
  const ex = tidyGroups(items.map(x => structuredClone(x.cfg)))
  if (!ex.length) return null
  return { ex, changes }
}

/** Whether a rewrite is more than the additions the summary already offers on their own (#592). */
export const rewritesRoutine = result => !!result?.changes?.some(c => c.kind !== 'add')

/** rewriteRoutine written into the routine, a store draft. Returns the changes, or null. */
export function applyRoutineUpdate(routine, plan, S, opts) {
  const result = rewriteRoutine(routine, plan, S, opts)
  if (!result) return null
  routine.ex = result.ex
  return result.changes
}
