// A routine described rather than built in the editor ("squat 3 × 8 at 60 kg, plank 3 × 45 s,
// Mondays and Thursdays"), for the MCP server's create_routine, update_routine and delete_routine
// tools. Pure and beside its test, like log-workout.js, because it decides what lands in the plan.
//
// It builds what the routine editor would have built: an exercise starts the way picking it in the
// editor starts it (pickedExerciseConfig: the profile's own defaults, a hold as a hold, per side
// for a one-arm lift), and only what the description says is set on top. An edit keeps everything
// a slot already had that the description does not mention (rest, warm-ups, progression, notes),
// slot by slot, and a routine's place on the weekdays is changed only when weekdays are given.
// Names resolve like log_workout's (resolveExercise): a name the library spells twice, or one it
// does not have, comes back as a problem with candidates instead of a guess.
import { resolveExercise } from './log-workout.js'
import { pickedExerciseConfig, cleanupSg, modeOf } from './history.js'
import { deleteRoutine } from './routines.js'
import { exerciseOf, isCardio } from './exercises.js'
import { fromSpeed, speedUnitOf } from './speed.js'
import { clampIncline, inclineFits } from './incline.js'
import { POLICIES_FOR, policyFor, profileRule } from './progression.js'
import { normalizeRepRange } from './rep-range.js'
import { bandsOf, usesBands, MAX_SET_BANDS } from './bands.js'

const LB_TO_KG = 0.45359237
export const ROUTINE_LIMITS = { maxExercises: 40, maxSets: 20, maxReps: 100, maxSec: 3600, maxRestSec: 900, maxKg: 2000, maxName: 80, maxNote: 280 }
// JS getDay() order, the state's own (S.week is keyed 0 Sunday … 6 Saturday).
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// The rules whose reps climb a range (`repsMin` .. `reps`), the ones the editor shows "Reps from"
// and "Reps up to" for (sheets.jsx climbsRange).
export const RANGE_POLICIES = ['double', 'steady', 'triple']
// A rule given as `policy`: one of the app's, or 'default' to take the override away (the slot
// follows its routine, the routine follows the profile).
export const POLICY_INPUTS = [...POLICIES_FOR.reps, 'time', 'default']
const SG_LABEL_MAX = 20

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clean = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '')

/** The weekday indexes a description names ('monday' or 1), or a problem. */
export function weekdaysOf(list) {
  if (!Array.isArray(list)) return { problem: 'weekdays must be a list' }
  const out = new Set()
  for (const d of list) {
    const i = typeof d === 'number' ? d : WEEKDAYS.indexOf(String(d).toLowerCase().trim())
    if (!Number.isInteger(i) || i < 0 || i > 6) return { problem: `not a weekday: ${JSON.stringify(d)}` }
    out.add(i)
  }
  return { days: [...out].sort() }
}

// One described exercise as a slot. `base` is the slot it edits (its settings stay), else a fresh
// pick. Weight is in `unit` and stored in the profile's.
function slotOf(S, ex, base, unit, speedUnit, at, problems, routine = null) {
  const want = ex?.exercise
  let hit
  if (base && (want == null || want === base.id)) hit = { id: base.id }
  else {
    hit = resolveExercise(S, want)
    if (hit.problem) { problems.push({ field: at + '.exercise', input: want ?? null, problem: hit.problem, ...(hit.candidates ? { candidates: hit.candidates } : {}) }); return null }
  }
  const cardioEx = (S.customEx || []).find(item => item?.id === hit.id) || exerciseOf(hit.id)
  const cardio = isCardio(cardioEx)
  const timed = ex?.seconds != null
  if (timed && ex?.reps != null) { problems.push({ field: at, problem: 'give reps or seconds, not both' }); return null }
  if (cardio && (ex?.reps != null || timed)) { problems.push({ field: at, problem: 'a cardio exercise is planned in minutes in the app; leave reps and seconds out' }); return null }
  if (!cardio && ['minutes', 'speed', 'incline'].some(k => ex?.[k] != null)) {
    for (const k of ['minutes', 'speed', 'incline']) if (ex?.[k] != null) problems.push({ field: `${at}.${k}`, problem: 'cardio targets can only be set on a cardio exercise' })
    return null
  }
  if (cardio && base?.mode === 'distance' && ['minutes', 'speed', 'incline'].some(k => ex?.[k] != null)) {
    problems.push({ field: at, problem: 'this cardio exercise is configured in distance mode; change it to cardio mode in the app before setting minutes, speed, or incline' })
    return null
  }
  const slot = base && base.id === hit.id ? { ...base } : { id: hit.id, ...pickedExerciseConfig(hit.id, timed ? 'time' : undefined, S) }
  if (timed && slot.mode !== 'time') { slot.mode = 'time'; delete slot.reps; delete slot.repsMin }
  if (ex?.reps != null && slot.mode === 'time') { slot.mode = 'reps'; delete slot.sec }
  const check = (k, v, lo, hi) => {
    if (v == null) return undefined
    const n = num(v)
    if (n == null || n < lo || n > hi) { problems.push({ field: `${at}.${k}`, problem: `must be ${lo} to ${hi}` }); return undefined }
    return n
  }
  const sets = check('sets', ex?.sets, 1, ROUTINE_LIMITS.maxSets)
  if (sets != null) slot.sets = Math.round(sets)
  const reps = check('reps', ex?.reps, 1, ROUTINE_LIMITS.maxReps)
  if (reps != null) { slot.reps = Math.round(reps); if (slot.repsMin >= slot.reps) delete slot.repsMin }
  const sec = check('seconds', ex?.seconds, 1, ROUTINE_LIMITS.maxSec)
  if (sec != null) slot.sec = Math.round(sec)
  // The slot's own rule (#1258), what get_routine reads back as policy_override.
  const mode = modeOf(slot)
  if (ex?.policy != null) {
    const allowed = POLICIES_FOR[mode] || ['off']
    if (ex.policy === 'default') delete slot.prog
    else if (!allowed.includes(ex.policy)) problems.push({ field: `${at}.policy`, problem: `not a rule for a ${mode} exercise; one of ${allowed.join(', ')}, or default` })
    else slot.prog = ex.policy
  }
  // A rep range, the editor's "Reps from" (reps is "Reps up to"): only where the rule climbs one.
  if (ex?.reps_min != null) {
    const low = check('reps_min', ex.reps_min, 1, ROUTINE_LIMITS.maxReps)
    const policy = policyFor(slot, routine, mode, profileRule(S))
    if (low == null) { /* said above */ }
    else if (mode !== 'reps') problems.push({ field: `${at}.reps_min`, problem: 'a rep range is for an exercise done in reps' })
    else if (!RANGE_POLICIES.includes(policy)) problems.push({ field: `${at}.reps_min`, problem: `a rep range only climbs under double, steady or triple progression and this exercise follows ${policy}; pass policy (on the exercise or the routine) as well` })
    else if (!(Math.round(low) < (slot.reps || 0))) problems.push({ field: `${at}.reps_min`, problem: 'must be below reps, which is the top of the range' })
    else {
      const range = normalizeRepRange(slot.reps, Math.round(low), slot.side ? 2 : 1)
      slot.reps = range.reps
      slot.repsMin = range.repsMin
    }
  }
  // The bands each set starts with (#1371, lib/bands.js), by id or by name from the profile's own.
  if (ex?.bands != null) {
    const list = bandsOf(S)
    const ids = []
    for (const [k, want] of (Array.isArray(ex.bands) ? ex.bands : [ex.bands]).entries()) {
      const key = String(want ?? '').trim().toLowerCase()
      const hitBand = list.find(b => b.id.toLowerCase() === key) || list.find(b => b.name.toLowerCase() === key)
      if (!hitBand) { problems.push({ field: `${at}.bands[${k}]`, input: want ?? null, problem: list.length ? 'not one of the profile\'s bands' : 'this profile has no bands yet; add them in the app (Settings, Bands) first', ...(list.length ? { candidates: list.map(b => ({ id: b.id, name: b.name, ...(b.kg ? { kg: b.kg } : {}) })) } : {}) }); continue }
      if (!ids.includes(hitBand.id)) ids.push(hitBand.id)
    }
    if (mode !== 'reps') problems.push({ field: `${at}.bands`, problem: 'bands are for an exercise done in reps' })
    else if (S?.bandEx?.[hit.id] === false) problems.push({ field: `${at}.bands`, problem: 'bands are switched off for this exercise in the app' })
    else if (ids.length > MAX_SET_BANDS) problems.push({ field: `${at}.bands`, problem: `at most ${MAX_SET_BANDS} bands on one set` })
    else if (ids.length) slot.bands = ids
    else if (!(Array.isArray(ex.bands) && ex.bands.length)) delete slot.bands
  }
  const rest = check('rest_sec', ex?.rest_sec, 0, ROUTINE_LIMITS.maxRestSec)
  if (rest != null) { if (rest > 0) slot.restSec = Math.round(rest); else delete slot.restSec }
  if (cardio) {
    const minutes = check('minutes', ex?.minutes, 1, 360)
    if (minutes != null) {
      if (!Number.isInteger(minutes)) problems.push({ field: `${at}.minutes`, problem: 'must be a whole number of minutes' })
      else slot.min = minutes
    }
    if (ex?.speed != null) {
      const value = num(ex.speed)
      const kmh = value == null || value < 0 ? null : fromSpeed(value, speedUnit)
      if (kmh == null || kmh <= 0 || kmh > 60) problems.push({ field: `${at}.speed`, problem: 'must be more than 0 and at most 60 km/h after converting speed_unit; omit it to keep the existing/default speed' })
      else slot.speed = kmh
    }
    if (ex?.incline != null) {
      const value = num(ex.incline)
      const incline = clampIncline(value)
      if (!inclineFits(cardioEx)) problems.push({ field: `${at}.incline`, problem: 'this cardio exercise has no incline' })
      else if (value == null || value < 0 || value > 40) problems.push({ field: `${at}.incline`, problem: 'percent, 0–40' })
      else if (incline > 0) slot.incline = incline
      else delete slot.incline
    }
  }
  // A weight on a band-loaded slot stops its bands from ever moving up (history.js bandSeed): a
  // band's resistance is not a load to add. Said, instead of the slot quietly losing its climb.
  if (num(ex?.weight) > 0 && mode === 'reps' && usesBands(S, hit.id, slot)) {
    problems.push({ field: `${at}.weight`, problem: 'this exercise is loaded with bands: a weight here would stop its bands from moving up. Leave weight out and set bands; an exercise with both bands and a weight is set up in the app' })
  } else if (ex?.weight != null) {
    const w = num(ex.weight)
    const kg = w == null ? null : unit === 'lb' ? w * LB_TO_KG : w
    if (w == null || w < 0 || kg > ROUTINE_LIMITS.maxKg) problems.push({ field: `${at}.weight`, problem: `must be 0 to ${ROUTINE_LIMITS.maxKg} kg` })
    else {
      const profileUnit = S.unit === 'lb' ? 'lb' : 'kg'
      slot.weight = unit === profileUnit ? w : Math.round((unit === 'lb' ? w * LB_TO_KG : w / LB_TO_KG) * 10) / 10
    }
  }
  if (ex?.note != null) { const n = clean(ex.note, ROUTINE_LIMITS.maxNote); if (n) slot.note = n; else delete slot.note }
  return slot
}

// The slots a list of described exercises stands for. With `old` (an edit), each exercise named
// again takes the next unused slot of that exercise, so repeated slots keep their own settings.
function slotsOf(S, list, old, unit, speedUnit, field, problems, routine = null) {
  if (!Array.isArray(list) || !list.length) { problems.push({ field, problem: 'at least one exercise' }); return [] }
  if (list.length > ROUTINE_LIMITS.maxExercises) { problems.push({ field, problem: `at most ${ROUTINE_LIMITS.maxExercises}` }); return [] }
  const used = new Set()
  const slots = list.map((ex, i) => {
    let base = null
    if (old) {
      const ref = ex?.exercise
      const id = ref == null ? null : (old.find((s, j) => !used.has(j) && s.id === ref) ? ref : resolveExercise(S, ref).id)
      const j = old.findIndex((s, k) => !used.has(k) && s.id === id)
      if (j >= 0) { used.add(j); base = old[j] }
    }
    return slotOf(S, ex, base, unit, speedUnit, `${field}[${i}]`, problems, routine)
  })
  groupSupersets(list, slots, field, problems)
  return slots.filter(Boolean)
}

// Superset labels (#1257): consecutive exercises with the same `superset` ("A", "B") are one
// group, a pair, a tri-set or a whole circuit. An empty label takes the exercise out of its group;
// no label at all keeps whatever group the slot had. A group whose members already shared one
// group keeps it, its name and its rest between rounds; a new one gets a fresh id (the routine
// editor's 'sg' + id) and none of the meta its members brought from elsewhere.
function groupSupersets(list, slots, field, problems) {
  const labels = list.map(ex => (ex?.superset == null ? null : clean(String(ex.superset), SG_LABEL_MAX).toLowerCase()))
  if (labels.every(l => l == null)) return
  const runs = new Map()
  labels.forEach((l, i) => {
    if (!l) return
    const run = runs.get(l)
    if (run && run[run.length - 1] !== i - 1) { problems.push({ field: `${field}[${i}].superset`, input: list[i].superset, problem: 'the exercises of one superset go next to each other' }); return }
    if (run) run.push(i); else runs.set(l, [i])
  })
  if (problems.length) return
  const taken = new Set(slots.map(s => s?.sg).filter(Boolean))
  labels.forEach((l, i) => {
    if (l === '' && slots[i]) { delete slots[i].sg; delete slots[i].sgName; delete slots[i].sgRest; delete slots[i].sgCircuit }
  })
  for (const run of runs.values()) {
    const members = run.map(i => slots[i])
    const kept = members[0].sg
    if (kept && members.every(m => m.sg === kept) && slots.filter(x => x?.sg === kept).length === members.length) continue
    let sg
    do sg = 'sg' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
    while (taken.has(sg))
    taken.add(sg)
    for (const m of members) { delete m.sgName; delete m.sgRest; delete m.sgCircuit; m.sg = sg }
  }
}

function placeOnWeekdays(S, id, days) {
  S.week = S.week && typeof S.week === 'object' ? S.week : {}
  for (let d = 0; d < 7; d++) {
    const ids = [].concat(S.week[d] ?? []).filter(x => x != null && x !== '')
    const has = ids.includes(id)
    const want = days.includes(d)
    if (has === want) continue
    const next = want ? [...ids, id] : ids.filter(x => x !== id)
    if (next.length) S.week[d] = next; else delete S.week[d]
  }
}

// The routine's own rule (#1258): one of the reps rules, or 'default' for the profile's. → the
// rule to store, or null (none given, 'default', or a problem said).
function routinePolicy(v, problems) {
  if (v == null || v === 'default') return null
  if (!POLICIES_FOR.reps.includes(v)) { problems.push({ field: 'policy', problem: `one of ${POLICIES_FOR.reps.join(', ')}, or default` }); return null }
  return v
}

/**
 * A new routine into `S` (mutated). `input`: { name, exercises: [{ exercise, sets?, reps? | seconds?,
 * reps_min?, policy?, superset?, bands?, weight?, rest_sec?, minutes?, speed?, incline?, note? }],
 * policy?, weekdays?, unit?, speed_unit? }. → { routine } or { problems } (S untouched).
 */
export function createRoutine(S, input, { id } = {}) {
  const problems = []
  const name = clean(input?.name, ROUTINE_LIMITS.maxName)
  if (!name) problems.push({ field: 'name', problem: 'a routine needs a name' })
  if ((S.routines || []).some(r => r && String(r.name || '').toLowerCase() === name.toLowerCase())) {
    problems.push({ field: 'name', problem: 'a routine with this name exists already; update it, or pick another name' })
  }
  const unit = input?.unit === 'lb' || input?.unit === 'kg' ? input.unit : S.unit === 'lb' ? 'lb' : 'kg'
  const speedUnit = input?.speed_unit === 'kmh' || input?.speed_unit === 'mph' ? input.speed_unit : speedUnitOf(S)
  const prog = routinePolicy(input?.policy, problems)
  const ex = slotsOf(S, input?.exercises, null, unit, speedUnit, 'exercises', problems, prog ? { prog } : null)
  const days = input?.weekdays == null ? { days: null } : weekdaysOf(input.weekdays)
  if (days.problem) problems.push({ field: 'weekdays', problem: days.problem })
  if (problems.length) return { problems }
  const routine = { id: id || 'mr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, emoji: 'figureStrength', ...(prog ? { prog } : {}), ex }
  cleanupSg(routine.ex)
  S.routines = [...(S.routines || []), routine]
  if (days.days) placeOnWeekdays(S, routine.id, days.days)
  return { routine }
}

/**
 * An existing routine changed in `S` (mutated). `patch`: { name?, exercises? (the whole new list),
 * add_exercises? (appended), policy?, weekdays? (the days it is on, all of them), unit?, speed_unit? }.
 */
export function updateRoutine(S, routineId, patch) {
  const i = (S.routines || []).findIndex(r => r && r.id === routineId)
  if (i < 0) return { problems: [{ field: 'routine_id', problem: 'no routine with this id; list_routines has them' }] }
  const old = S.routines[i]
  const problems = []
  const next = { ...old }
  if (patch?.name != null) {
    const name = clean(patch.name, ROUTINE_LIMITS.maxName)
    if (!name) problems.push({ field: 'name', problem: 'a routine needs a name' })
    else if (S.routines.some((r, j) => j !== i && r && String(r.name || '').toLowerCase() === name.toLowerCase())) problems.push({ field: 'name', problem: 'another routine has this name' })
    else next.name = name
  }
  const unit = patch?.unit === 'lb' || patch?.unit === 'kg' ? patch.unit : S.unit === 'lb' ? 'lb' : 'kg'
  const speedUnit = patch?.speed_unit === 'kmh' || patch?.speed_unit === 'mph' ? patch.speed_unit : speedUnitOf(S)
  if (patch?.policy != null) {
    const prog = routinePolicy(patch.policy, problems)
    if (prog) next.prog = prog
    else if (patch.policy === 'default') delete next.prog
  }
  const oldEx = Array.isArray(old.ex) ? old.ex : []
  if (patch?.exercises != null) next.ex = slotsOf(S, patch.exercises, oldEx, unit, speedUnit, 'exercises', problems, next)
  if (patch?.add_exercises != null) next.ex = [...(next.ex || oldEx), ...slotsOf(S, patch.add_exercises, null, unit, speedUnit, 'add_exercises', problems, next)]
  if ((next.ex || []).length > ROUTINE_LIMITS.maxExercises) problems.push({ field: 'exercises', problem: `at most ${ROUTINE_LIMITS.maxExercises}` })
  const days = patch?.weekdays == null ? { days: null } : weekdaysOf(patch.weekdays)
  if (days.problem) problems.push({ field: 'weekdays', problem: days.problem })
  if (problems.length) return { problems }
  if (next.ex !== old.ex) { next.ex = next.ex.map(s => ({ ...s })); cleanupSg(next.ex) }
  const routines = [...S.routines]
  routines[i] = next
  S.routines = routines
  if (days.days) placeOnWeekdays(S, routineId, days.days)
  return { routine: next }
}

/** A routine gone from `S` (mutated), off every weekday and date it was planned on. */
export function removeRoutine(S, routineId) {
  const r = (S.routines || []).find(x => x && x.id === routineId)
  if (!r) return { problems: [{ field: 'routine_id', problem: 'no routine with this id; list_routines has them' }] }
  S.routines = [...S.routines]
  S.week = { ...(S.week || {}) }
  S.dayPlan = { ...(S.dayPlan || {}) }
  const dropped = deleteRoutine(S, routineId)
  return { routine: r, dropped }
}

/** The weekdays a routine is planned on, as names. */
export const routineWeekdays = (S, id) => WEEKDAYS.filter((_, d) => [].concat(S?.week?.[d] ?? []).includes(id))
