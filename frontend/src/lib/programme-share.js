import { buildPlanBundle, mergePlan, parsePlan } from './plan-share.js'
import {
  PROGRAMME_COLOURS, PROGRAMME_WEEK_MODES, addProgrammeDefinitionInState, createProgrammeDefinition,
} from './programmes.js'
import { POLICIES } from './progression.js'

const FORMAT = 1
const ROOT_KEYS = new Set(['opengym_programme', 'exported', 'unit', 'programme', 'plan'])
const PROGRAMME_KEYS = new Set(['name', 'emoji', 'progression', 'colour', 'weeks'])
const WEEK_KEYS = new Set(['mode', 'days'])
const DAY_KEYS = new Set(['weekday', 'sessions'])
const SESSION_KEYS = new Set(['routineRef', 'prescription'])
const PRESCRIPTION_KEYS = new Set(['notes', 'workRestSec', 'rir'])
const UNITS = new Set(['kg', 'lb'])
const clone = value => globalThis.structuredClone ? structuredClone(value) : JSON.parse(JSON.stringify(value))
const own = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key)
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
const fail = message => {
  const error = new Error(`Invalid openGym Programme file: ${message}`)
  error.code = 'not-programme'
  throw error
}

function assertKeys(value, allowed, label) {
  if (!object(value)) fail(`${label} must be an object`)
  const extra = Object.keys(value).find(key => !allowed.has(key))
  if (extra) fail(`${label} contains unsupported field “${extra}”`)
}

function text(value, label, max, { optional = false } = {}) {
  if (optional && value == null) return undefined
  if (typeof value !== 'string') fail(`${label} must be text`)
  const out = value.trim()
  if (!out || out.length > max) fail(`${label} is invalid`)
  return out
}

function exportDate(now) {
  const date = now == null ? new Date() : new Date(now)
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid Programme export date')
  return date.toISOString().slice(0, 10)
}

function prescriptionOf(snapshot) {
  const prescription = (snapshot.ex || []).map(exercise => {
    if (exercise.notes != null && typeof exercise.notes !== 'string') fail('exercise notes are invalid')
    if (exercise.workRestSec != null && (!Number.isFinite(exercise.workRestSec) || exercise.workRestSec < 0 || exercise.workRestSec > 86400)) fail('exercise work rest is invalid')
    if (exercise.rir != null && (!Number.isFinite(exercise.rir) || exercise.rir < 0 || exercise.rir > 10)) fail('exercise RIR is invalid')
    const notes = exercise.notes?.trim().slice(0, 1000)
    return { ...(notes ? { notes } : {}), ...(exercise.workRestSec != null ? { workRestSec: Math.round(exercise.workRestSec) } : {}), ...(exercise.rir != null ? { rir: exercise.rir } : {}) }
  })
  return prescription.some(entry => Object.keys(entry).length) ? prescription : undefined
}

function cleanPrescription(value, routine, label) {
  if (value == null) return undefined
  if (!Array.isArray(value) || value.length !== (routine.ex || []).length) fail(`${label} prescription is invalid`)
  return value.map((entry, index) => {
    assertKeys(entry, PRESCRIPTION_KEYS, `${label} prescription ${index + 1}`)
    const notes = entry.notes == null ? undefined : text(entry.notes, 'exercise notes', 1000)
    const workRestSec = entry.workRestSec
    const rir = entry.rir
    if (workRestSec != null && (!Number.isFinite(workRestSec) || workRestSec < 0 || workRestSec > 86400)) fail(`${label} work rest is invalid`)
    if (rir != null && (!Number.isFinite(rir) || rir < 0 || rir > 10)) fail(`${label} RIR is invalid`)
    return { ...(notes ? { notes } : {}), ...(workRestSec != null ? { workRestSec: Math.round(workRestSec) } : {}), ...(rir != null ? { rir } : {}) }
  })
}

function programmeShape(input, routineRefs, { exporting = false } = {}) {
  assertKeys(input, PROGRAMME_KEYS, 'programme')
  const name = text(input.name, 'programme name', 200)
  const progression = text(input.progression || 'linear', 'programme progression', 50)
  if (!POLICIES.includes(progression)) fail('programme progression is invalid')
  const emoji = text(input.emoji, 'programme emoji', 32, { optional: true })
  const colour = input.colour == null ? null : text(input.colour, 'programme colour', 20)
  if (colour != null && !PROGRAMME_COLOURS.includes(colour)) fail('programme colour is invalid')
  if (!Array.isArray(input.weeks) || input.weeks.length < 1 || input.weeks.length > 52) fail('week count must be between 1 and 52')
  let sessionCount = 0
  let scheduledSessionCount = 0
  const prescriptionsByRef = new Map()
  const weeks = input.weeks.map((week, weekIndex) => {
    if (!exporting) assertKeys(week, WEEK_KEYS, `week ${weekIndex + 1}`)
    const mode = week.mode == null ? 'normal' : week.mode
    if (!PROGRAMME_WEEK_MODES.includes(mode)) fail(`week ${weekIndex + 1} mode is invalid`)
    if (!Array.isArray(week.days)) fail(`week ${weekIndex + 1} days must be a list`)
    const seenDays = new Set()
    const days = week.days.map((day, dayIndex) => {
      if (!exporting) assertKeys(day, DAY_KEYS, `week ${weekIndex + 1} day ${dayIndex + 1}`)
      const weekday = Number(day.weekday)
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || seenDays.has(weekday)) fail(`week ${weekIndex + 1} has an invalid or duplicate weekday`)
      seenDays.add(weekday)
      if (!Array.isArray(day.sessions) || day.sessions.length > 100) fail(`week ${weekIndex + 1} day ${weekday} sessions are invalid`)
      const sessions = day.sessions.map((session, sessionIndex) => {
        if (exporting) {
          if (!object(session?.routineSnapshot) || typeof session.routineSnapshot.id !== 'string' || !session.routineSnapshot.id.trim() || typeof session.routineSnapshot.name !== 'string' || !session.routineSnapshot.name.trim() || !Array.isArray(session.routineSnapshot.ex)) fail(`week ${weekIndex + 1} day ${weekday} session ${sessionIndex + 1} has no valid routine snapshot`)
          const ref = routineRefs(session.routineSnapshot)
          const prescription = prescriptionOf(session.routineSnapshot)
          sessionCount++
          if (mode !== 'rest') scheduledSessionCount++
          return { routineRef: ref, ...(prescription ? { prescription } : {}) }
        }
        assertKeys(session, SESSION_KEYS, `week ${weekIndex + 1} day ${weekday} session ${sessionIndex + 1}`)
        const routineRef = text(session.routineRef, 'routine reference', 100)
        if (!/^programme-routine-[1-9]\d*$/.test(routineRef)) fail('routine reference is invalid')
        const routine = routineRefs.get(routineRef)
        if (!routine) fail(`week ${weekIndex + 1} day ${weekday} session ${sessionIndex + 1} references a missing routine`)
        const prescription = cleanPrescription(session.prescription, routine, `week ${weekIndex + 1} day ${weekday} session ${sessionIndex + 1}`)
        const signature = JSON.stringify(prescription || null)
        if (prescriptionsByRef.has(routineRef) && prescriptionsByRef.get(routineRef) !== signature) fail(`routine reference ${routineRef} has conflicting prescriptions`)
        prescriptionsByRef.set(routineRef, signature)
        sessionCount++
        if (mode !== 'rest') scheduledSessionCount++
        return { routineRef, ...(prescription ? { prescription } : {}) }
      })
      return { weekday, sessions }
    })
    return { mode, days }
  })
  if (!sessionCount) fail('programme has no sessions')
  if (!scheduledSessionCount) fail('programme has no scheduled sessions')
  return { name, ...(emoji ? { emoji } : {}), progression, colour, weeks }
}

/** Build a self-contained reusable Programme file. Active cycles and history are never accepted. */
export function buildProgrammeBundle(definition, { customEx = [], unit = 'kg', now } = {}) {
  if (!UNITS.has(unit)) throw new Error('Programme unit must be kg or lb')
  const snapshots = []
  const refsBySnapshot = new Map()
  const refFor = snapshot => {
    const shared = clone(snapshot)
    // These are derived by the Programme's progression and week mode when it is rehydrated;
    // carrying them on the recipient's standalone routine would leak Programme state into it.
    delete shared.programmeProgression
    delete shared.excludeFromProgression
    const key = JSON.stringify(shared)
    let ref = refsBySnapshot.get(key)
    if (!ref) {
      ref = `programme-routine-${snapshots.length + 1}`
      refsBySnapshot.set(key, ref)
      snapshots.push({ ...shared, id: ref })
    }
    return ref
  }
  const source = {
    name: definition?.name, emoji: definition?.emoji, progression: definition?.progression,
    colour: own(definition, 'colour') ? definition.colour : null, weeks: definition?.weeks,
  }
  const programme = programmeShape(source, refFor, { exporting: true })
  const exported = exportDate(now)
  const plan = buildPlanBundle({ unit, routines: snapshots, customEx, week: {} }, programme.name)
  plan.exported = exported
  const checked = parsePlan(plan, unit)
  if (checked.dropped || checked.routines.length !== snapshots.length) throw new Error('Programme contains an exercise that cannot be shared')
  return { opengym_programme: FORMAT, exported, unit, programme, plan }
}

function validExportDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
/** Validate untrusted JSON and return only the fields used by Programme import. */
export function parseProgramme(raw) {
  let data = raw
  if (typeof raw === 'string') { try { data = JSON.parse(raw) } catch { fail('file is not valid JSON') } }
  assertKeys(data, ROOT_KEYS, 'file')
  if (data.opengym_programme !== FORMAT) fail('unsupported format version')
  if (!validExportDate(data.exported)) fail('export date is invalid')
  if (!UNITS.has(data.unit)) fail('unit is invalid')
  if (!object(data.plan) || data.plan.unit !== data.unit || !object(data.plan.week) || Object.keys(data.plan.week).length) fail('embedded routine plan is invalid')
  let first
  try { first = parsePlan(data.plan, data.unit) } catch { fail('embedded routine plan is invalid') }
  if (first.dropped) fail('embedded routine plan has unknown exercises')
  const refs = new Map(first.routines.map(routine => [String(routine.id), routine]))
  if (refs.size !== first.routines.length || [...refs.keys()].some(ref => !/^programme-routine-[1-9]\d*$/.test(ref))) fail('embedded routine identities are invalid')
  const programme = programmeShape(data.programme, refs)
  const used = new Set(programme.weeks.flatMap(week => week.days.flatMap(day => day.sessions.map(session => session.routineRef))))
  if (used.size !== refs.size || [...refs.keys()].some(ref => !used.has(ref))) fail('embedded routine plan contains an unreferenced routine')

  // Rebuilding applies plan-share's privacy whitelist to every routine, exercise and custom field.
  const canonical = buildPlanBundle({ unit: data.unit, routines: first.routines, customEx: first.customEx, week: {} }, programme.name)
  canonical.exported = data.exported
  const checked = parsePlan(canonical, data.unit)
  if (checked.dropped) fail('embedded routine plan has unknown exercises')
  return { opengym_programme: FORMAT, exported: data.exported, unit: data.unit, programme, plan: canonical }
}

/** Pure import: return a cloned next state, leaving the supplied state unchanged on success or failure. */
export function mergeProgramme(state, parsed) {
  const checked = parseProgramme(parsed)
  const next = clone(state)
  next.routines = Array.isArray(next.routines) ? next.routines : []
  next.customEx = Array.isArray(next.customEx) ? next.customEx : []
  next.week = object(next.week) ? next.week : {}
  const beforeCustom = next.customEx.length
  const merged = mergePlan(next, checked.plan, { schedule: false })
  const byId = new Map(next.routines.map(routine => [String(routine.id), routine]))
  const weeks = checked.programme.weeks.map(week => ({
    mode: week.mode,
    days: week.days.map(day => ({
      weekday: day.weekday,
      sessions: day.sessions.map(session => {
        const routineId = merged.routineIdMap[session.routineRef]
        const routineSnapshot = byId.get(String(routineId))
        if (!routineId || !routineSnapshot) fail('could not remap an imported routine')
        session.prescription?.forEach((entry, index) => { Object.assign(routineSnapshot.ex[index], entry) })
        return { routineId, routineSnapshot: clone(routineSnapshot) }
      }),
    })),
  }))
  const definition = createProgrammeDefinition({ ...checked.programme, weeks }, next)
  addProgrammeDefinitionInState(next, definition)
  return {
    state: next,
    counts: { routines: merged.routines, customExercises: next.customEx.length - beforeCustom, programmes: 1 },
    programmeId: definition.id,
  }
}
