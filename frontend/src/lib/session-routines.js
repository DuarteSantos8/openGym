import { uid } from './format.js'
import { modeOf, defaultConfig, isPerSide, entryRoutineId, setsFromRows, cleanupSg } from './history.js'
import { routineSlotIndex, replaceSlotExercise } from './routines.js'
import { isSideSet, isWarmupRow, hasCompletedWork, modeForEntry } from './workout-model.js'

// A saved workout is evidence of what was logged, not a live routine. Copy only its flat
// exercise setup on this explicit action; finishing a workout never calls this helper.
const sessionEntries = session => Array.isArray(session?.entries) ? session.entries : []

function groupIds(ex) {
  const next = ex.map(entry => ({ ...entry }))
  let i = 0
  while (i < next.length) {
    const raw = next[i].sg
    if (raw == null || raw === '') { delete next[i].sg; i++; continue }
    const start = i
    while (i + 1 < next.length && next[i + 1].sg === raw) i++
    const end = i
    if (end === start) delete next[start].sg
    else {
      const mapped = `sg-${uid()}`
      for (let j = start; j <= end; j++) next[j].sg = mapped
    }
    i++
  }
  return next
}

const scalarGroup = value => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value)
  return text ? text : null
}

const finite = value => Number.isFinite(Number(value)) ? Number(value) : null
const positive = value => {
  const n = finite(value)
  return n != null && n > 0 ? n : null
}

// A flat per-side routine stores the total across both limbs. makeSideSet() then splits that
// total into two equal planned sides, so an odd/asymmetric logged total is rounded to the nearest
// representable even total. The copy keeps the target when only one limb was completed: a flat
// routine cannot encode partial completion or two different side prescriptions.
function perSideReps(row, target) {
  if (!isSideSet(row)) return positive(row?.r)
  const done = ['L', 'R'].filter(key => row.sides[key]?.done === true)
  if (done.length === 1) return evenTotal(target?.reps) ?? evenTotal(row.sides[done[0]]?.r)
  if (done.length < 2) return null
  return evenTotal(done.reduce((total, key) => total + (positive(row.sides[key]?.r) || 0), 0))
}

function evenTotal(value) {
  const n = positive(value)
  return n == null ? null : Math.max(2, 2 * Math.round(n / 2))
}

function perSideWeight(row) {
  if (!isSideSet(row)) return finite(row?.w)
  const done = ['L', 'R'].filter(key => row.sides[key]?.done === true)
  const weights = done.map(key => finite(row.sides[key]?.w)).filter(value => value != null)
  return weights.length ? Math.max(...weights) : null
}

function copiedEntry(entry, source) {
  const rows = Array.isArray(entry?.sets) ? entry.sets : []
  const work = rows.filter(row => !isWarmupRow(row))
  // A saved entry can retain planned rows after an early finish. Match history.js lastEntryFor:
  // only a fully completed work row may seed the copied target. A partially checked per-side row
  // is still retained by buildCompletedWorkout, but its two-limb state cannot fit a flat routine.
  const row = work.filter(candidate => candidate?.done === true).at(-1) || null
  const target = entry?.target && typeof entry.target === 'object'
    ? structuredClone(entry.target)
    : {}
  // Copy the mode that was logged, even if the catalogue's default has since changed (#678).
  const defaults = defaultConfig(entry?.id, modeForEntry(entry, modeOf({ ...target, id: entry?.id })))
  const cfg = { ...defaults, ...target, id: entry?.id, sets: Math.max(1, setsFromRows({ ...defaults, ...target }, work.length) || 1), warmupSets: rows.filter(isWarmupRow).length }
  const mode = modeOf(cfg)
  if (mode === 'time' && row) Object.assign(cfg, { sec: row.sec ?? cfg.sec, weight: row.w ?? cfg.weight ?? 0 })
  else if (mode === 'cardio' && row) Object.assign(cfg, { min: row.min ?? cfg.min, speed: row.speed ?? cfg.speed })
  else if (mode === 'reps') {
    const reps = row && isPerSide(cfg) ? perSideReps(row, cfg) : positive(row?.r)
    if (reps != null) cfg.reps = reps
    if (row) {
      const weight = perSideWeight(row)
      if (weight != null) cfg.weight = weight
    }
    if (isPerSide(cfg) && row == null) cfg.reps = evenTotal(cfg.reps) ?? cfg.reps
  }

  // A planned entry says what its routine asked for (`planned`, session-start.js), and the plan
  // owns a planned session's sets and reps. Today's target is the prescription and the rows are
  // what was done with it: a double-progression aim inside the range, a set the bodyweight
  // ceiling added, a bonus set, or reps carried over from last time. Copied as the new plan,
  // each of those reads as an edited plan on the copy's first session (nextPrescription):
  // "Plan changed", a range narrowed to the reps of one day, the climb started again. The copy
  // takes the plan's sets and reps instead, so it continues from where the source routine
  // stands. The weight is still the one lifted — history decides it either way.
  const planned = entry?.planned && typeof entry.planned === 'object' ? entry.planned : null
  if (planned) {
    cfg.sets = Math.max(1, positive(planned.sets) || 1)
    if (mode === 'reps' && positive(planned.reps) != null) {
      cfg.reps = planned.reps
      // A plan with no range has no bottom to keep, whatever the target carried.
      if (positive(planned.repsMin) != null) cfg.repsMin = planned.repsMin
      else delete cfg.repsMin
    }
    if (mode === 'time' && positive(planned.sec) != null) cfg.sec = planned.sec
    if (mode === 'distance' && positive(planned.m) != null) cfg.m = planned.m
  }
  // A rule set on the source routine rather than on the exercise decides how the plan is read:
  // a range is a double-progression aim there and a flat target under the default. A copy
  // without it would open 3 × 8–12 at 12. Each exercise keeps its own routine's rule, since a
  // combined session can hold routines that progress differently.
  if (!cfg.prog && typeof source?.prog === 'string' && source.prog) cfg.prog = source.prog

  // buildCompletedWorkout carries setup.sg inside target, while older records may carry it on
  // the entry. Keep either form, but never copy session-only ownership fields such as rid.
  const sg = scalarGroup(entry?.sg ?? target.sg)
  if (sg) cfg.sg = sg
  else delete cfg.sg
  // What a session stamps on its entries describes that session, not a plan. None of it belongs
  // in a routine: a copied `planned` or `rid` would tell the next session it had been built from
  // another plan or another routine.
  for (const key of SESSION_ONLY) delete cfg[key]
  return cfg
}

// `rowReps` is one session's per-set aim under triple progression (progression.js), not a plan.
const SESSION_ONLY = ['planned', 'plan', 'carried', 'rid', 'noProg', 'muscleSnapshot', 'rowReps']

// `routines` are the ones the session was built from, when they still exist: the rule each copied
// exercise is read under comes from there (see copiedEntry).
export function routineFromSession(session, name = session?.name, routines = []) {
  const byId = new Map((Array.isArray(routines) ? routines : []).filter(r => r?.id != null).map(r => [r.id, r]))
  const ex = groupIds(sessionEntries(session).filter(entry => entry?.sets?.length)
    .map(entry => copiedEntry(entry, byId.get(entryRoutineId(session, entry)))))
  if (!ex.length) throw new Error('no exercises')
  return { id: uid(), name: String(name || 'Workout').trim() || 'Workout', ex }
}

export function saveSessionAsRoutine(state, session, name) {
  const routine = routineFromSession(session, name, state.routines)
  state.routines.push(routine)
  return routine.id
}

// What a routine's session changed in the routine's exercise list, offered on the finish summary:
// exercises added (#592: stamped `addedInSession` by Add exercise, and copied the way Save as
// routine copies them, copiedEntry), taken out or swapped, and the order they were done in.
// Sets, reps, weight and rest stay as the routine has them (see routineChangesFromEntry).
// `active` is the session as it stood at Save: the saved record drops an exercise with no ticked
// set, and one left undone is not one taken out. Every slot of a routine is one entry when the
// session starts (session-start.js), so a slot with no entry left was removed. `S` is the store
// after the save, so a swapped-in exercise reads its weight from today (replaceSlotExercise).
// One result per routine the session came from (a combined day can change two), none when the
// session left it as it was or would leave it empty.
export function routineChanges(active, S) {
  const entries = sessionEntries(active)
  const ids = [...new Set(entries.map(e => e?.rid).filter(Boolean))]
  return ids.map(id => (Array.isArray(S?.routines) ? S.routines : []).find(r => r?.id === id))
    .filter(r => Array.isArray(r?.ex))
    .map(r => routineChange(entries.filter(e => e?.rid === r.id), r, S))
    .filter(Boolean)
}

const isBackupOf = (slot, id) => (Array.isArray(slot?.subs) && slot.subs.includes(id))
  || (slot?.subCfg && typeof slot.subCfg === 'object' && Object.prototype.hasOwnProperty.call(slot.subCfg, id))

function routineChange(own, routine, S) {
  // Only the routine's own entries match slots: an added second bench must not take the first's.
  const planned = own.filter(e => e.addedInSession !== true)
  const at = new Map(planned.map((e, k) => [e, routineSlotIndex(routine, planned, k)]))
  const kept = new Set([...at.values()].filter(a => a >= 0))
  const free = new Set(routine.ex.map((_, a) => a).filter(a => !kept.has(a)))
  const out = []
  const added = []
  let swapped = 0
  let moved = false
  let last = -1
  const take = (a, slot) => {
    if (a < last) moved = true
    last = a
    out.push(slot)
  }
  const add = entry => {
    if (!(entry.sets || []).some(hasCompletedWork) || routine.ex.some(x => x?.id === entry.id) || added.includes(entry.id)) return
    added.push(entry.id)
    out.push(copiedEntry(entry, routine))
  }
  own.forEach(entry => {
    if (entry.addedInSession === true) { add(entry); return }
    const a = at.get(entry)
    if (a >= 0) { take(a, { ...routine.ex[a] }); return }
    // Not the routine's exercise and not added: a swap. One of a slot's own backups (#649) is the
    // plan working as meant, so that slot stays as it is, wherever the backup went.
    const backup = [...free].find(b => isBackupOf(routine.ex[b], entry.id))
    if (backup != null) { free.delete(backup); take(backup, { ...routine.ex[backup] }); return }
    // Otherwise the slot it replaced is a removed one, best the one between its matched
    // neighbours, else one done elsewhere in the order. Swapped after a set was ticked, the
    // original stays beside it (active-exercise-swap.js), so there is no free slot and the new
    // one reads as added, or as nothing when it is a backup of that original.
    const next = planned.slice(planned.indexOf(entry) + 1).map(e => at.get(e)).find(b => b >= 0) ?? Infinity
    const ofKept = routine.ex.some(slot => isBackupOf(slot, entry.id))
    const slotAt = [...free].find(b => b > last && b < next) ?? (ofKept ? undefined : [...free][0])
    if (slotAt == null) { if (!ofKept) add(entry); return }
    free.delete(slotAt)
    // Swapped in but never done: the slot stays as the routine has it, as one left undone does.
    if (!(entry.sets || []).some(hasCompletedWork)) { take(slotAt, { ...routine.ex[slotAt] }); return }
    swapped++
    take(slotAt, replaceSlotExercise(routine.ex[slotAt], entry.id, S, routine.id))
  })
  const removed = free.size
  if (!out.length || (!added.length && !removed && !swapped && !moved)) return null
  // A session keeps its routine's superset tags (session-start.js), so a copy keeps a group it
  // joined there, and a group left with one member is dissolved.
  const ex = out.map(x => structuredClone(x))
  cleanupSg(ex)
  return { routineId: routine.id, name: routine.name, ex, added, removed, swapped, moved }
}

// "Routine from a past workout" on Plan (idea by @alexgrandasoto, #1010): someone who imported
// years of training, or just trains without routines, starts from what they really did. The
// newest workout of each name, so a history of two hundred "Push day"s offers one, newest first.
// Only workouts with an exercise that has sets: those are the ones Save as routine can copy.
export function routineSources(workouts, limit = 40) {
  const list = (Array.isArray(workouts) ? workouts : [])
    .filter(w => w && sessionEntries(w).some(e => e?.id && Array.isArray(e.sets) && e.sets.length))
    .map((w, i) => ({ w, i, at: Number(w.start) || Date.parse(w.d || '') || 0 }))
    .sort((a, b) => (b.at - a.at) || (b.i - a.i))
  const seen = new Set()
  const out = []
  for (const { w } of list) {
    const name = String(w.name || '').trim()
    const key = name ? 'n:' + name.toLowerCase() : 'd:' + (w.d || '') + ':' + (w.id || '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ w, exercises: sessionEntries(w).filter(e => e?.id && e.sets?.length).length })
    if (out.length >= limit) break
  }
  return out
}
