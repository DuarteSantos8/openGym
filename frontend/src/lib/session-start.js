// Generate one immutable prescription per routine occurrence. The engine decides; this boundary
// only gathers its inputs (rule, track state, newest log, current 1RM) and stores its output.
import { currentOneRm, bestLoad, operatorFor, phaseOf, planFingerprint, planPhase, rungsOf, defaultPlanRule, generatePrescription, needsOneRm, resolveProgressionContext, slotFor, slotInputs, supports, withRest } from './prescription/index.js'
import { EXIDX, isAssisted, isBodyweightEq } from './exercises.js'
import { modeOf, barFloor, lastAcrossRoutines, lastEntryFor, insertWarmupRow } from './history.js'
import { oneRmForMeaning } from './onerm.js'
import { exView, exConverted, viewTarget, profileUnit } from './ex-unit.js'
import { convertExact, convertStep, convPrescription } from './units.js'
import { captureReference, programmeView } from './programmes.js'
import { isoOf } from './format.js'
import { warmupSource, warmupModeOf, withWarmupBlock } from './warmup-ramp.js'
import { dropGrid } from './plates.js'
import { isWarmupRow, isSideSet, syncSideAggregate } from './workout-model.js'
import { contentHash, deepFreeze } from '../../../api/engine/index.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { dbLoadFor, bellsIn, ownedWeightsFor, historyAs, meaningFactor, entryDbLoad } from './dumbbells.js'

// How the exercise is logged: the occurrence's own mode, else the catalogue's (a cardio exercise);
// a rule with a duration and no reps is a hold.
const modeFor = (occ, p) => {
  const mode = modeOf({ mode: occ.mode, id: occ.exerciseId })
  return mode === 'reps' && p.parameters.durationSeconds ? 'time' : mode
}

/** Exercises in these routines that need a 1RM the profile does not have yet: a rule of its own
 *  without an adopted one, or a programme slot its run cannot generate without one. */
export function missingOneRms(profile, routines) {
  const ids = new Set()
  const view = programmeView(profile)
  for (const routine of routines) {
    for (const occ of routine.ex || []) {
      if (currentOneRm(profile.oneRepMaxes, occ.exerciseId)) continue
      const at = view && slotFor({ view, run: view.run, rid: routine.id, oid: occ.occurrenceId, date: isoOf(new Date()) }).assignment
      const own = at ? slotInputs({ view, run: view.run, assignment: at, occRule: occ.rule }).blocked === 'reference-missing' : occ.rule && needsOneRm(occ.rule) && !occ.ref
      if (own) ids.add(occ.exerciseId)
    }
  }
  return [...ids]
}

/** An occurrence whose rule starts from `preset`'s defaults with these plain numbers. */
export function occurrenceFor(exerciseId, { sets, reps, sec, weight } = {}, { id, unit = 'kg', routineId = null, preset = 'autoregulated' } = {}) {
  const o = {}
  if (sets > 0) o.sets = { min: Math.round(sets), max: Math.round(sets) }
  if (sec > 0) Object.assign(o, { durationSeconds: { min: sec, max: sec }, reps: { min: 1, max: 1 } })
  else if (reps > 0) o.reps = { min: Math.round(reps), max: Math.round(reps) }
  if (weight > 0) o.load = { mode: 'absolute', value: weight, unit }
  return { occurrenceId: id, exerciseId, rule: defaultPlanRule(preset, { id, exerciseId, routineId, unit, ...o }) }
}

/** The exercise the track's current rung names: the occurrence's own when the rung names none. */
export function effectiveExerciseId(occ, profile) {
  const op = occ.rule && operatorFor(planPhase(occ.rule), 'difficulty')
  if (!op) return occ.exerciseId
  const s = profile?.progression?.[occ.occurrenceId]
  // A plan edit restarts the track at rung 0 (advance.js `restart`): so does its exercise.
  const at = s && (!s.planFingerprint || s.planFingerprint === planFingerprint(occ.rule)) ? s.values?.difficulty ?? 0 : 0
  const rungs = rungsOf(op)
  const id = rungs[Math.min(at, rungs.length - 1)]?.exerciseId
  return id && EXIDX[id] ? id : occ.exerciseId
}

/**
 * Mutates `profile.prescriptions` (the store's update draft) and returns the session exposures. An
 * occurrence the current programme run plans (programmes.js programmeView) is generated from its
 * stage on the run's own track (slotFor → slotInputs), the week's options over the occurrence's,
 * and stamped with where it went (`exposure.programme`); anything else from its own rule. When
 * continuing would pass earlier appointments of the week or round (spec 7.3), nothing is built: the
 * answer is an empty list carrying `bypass` (`p<n>:a<i>` ids) until programmes.js bypassTo records them.
 * `ctx.history` (a session logged into the past: the profile as of its day, backfill.js historyAsOf)
 * is what its prescriptions are generated from; the run, its slots and every capture are read and
 * written on `stored` itself, so a later session already in the run still holds its slot. The
 * workout a backfill replaces (`ctx.replaceId`) is read as gone: the replacement takes its slot back.
 */
export function buildSessionExposures(stored, routine, ctx) {
  stored.prescriptions ||= {}
  const past = ctx.history || stored
  const date = ctx.date || stored.active?.d || isoOf(new Date(ctx.now))
  // Only the records a run reads: spreading the draft would copy the whole profile.
  const runView = () => programmeView(ctx.replaceId == null ? stored : { programme: stored.programme, programmeRuns: stored.programmeRuns, programmeEvents: stored.programmeEvents,
    prescriptions: stored.prescriptions, routines: stored.routines, workouts: (stored.workouts || []).filter(w => w.id !== ctx.replaceId) })
  let view = routine?.excludeFromProgression === true ? null : runView()
  const placed = (routine?.ex || []).map(occ => (view ? slotFor({ view, run: view.run, rid: routine.id, oid: occ.occurrenceId, date }) : null))
  const bypass = [...new Set(placed.flatMap(x => x?.bypass || []))]
  if (bypass.length) return Object.assign([], { bypass })
  return (routine?.ex || []).map((original, i) => {
    const id = effectiveExerciseId(original, past)
    const storedOccurrence = id === original.exerciseId ? original : { ...original, exerciseId: id, exerciseName: undefined }
    const profile = exConverted(past, id)
      ? exView({ ...past, workouts: [...(past.workouts || [])] }, id) : past
    const base = viewTarget(stored, id, storedOccurrence)
    const at = placed[i]?.assignment
    let inputs = at ? slotInputs({ view, run: view.run, assignment: at, occRule: base.rule }) : null
    // The first session that finds a 1RM for a track with none adopts it (spec 10.1).
    if (inputs?.blocked === 'reference-missing' && currentOneRm(stored.oneRepMaxes, base.exerciseId)) {
      captureReference(stored, at.trackId, currentOneRm(stored.oneRepMaxes, base.exerciseId), ctx.now)
      view = runView()
      inputs = slotInputs({ view, run: view.run, assignment: at, occRule: base.rule })
    }
    // Still no reference: ordinary work kept out of progression, nothing fabricated; the slot stays open.
    const prog = inputs && !inputs.blocked ? inputs : null
    const options = prog?.rule.options || {}
    // The week's execution options over the occurrence's own (an incline lives in its cardio settings).
    const occ = prog ? { ...base, ...options, ...(options.incline != null ? { cardio: { ...base.cardio, incline: options.incline } } : {}) } : base
    // A programme's maintenance, extra and recovery work is logged and moves nothing.
    const excluded = routine.excludeFromProgression === true || occ.excludeFromProgression === true || !!inputs?.blocked || (!!prog && (at.role !== 'work' || prog.rule.program.adaptive === false))
    const trackId = prog ? prog.trackId : occ.occurrenceId
    const meaning = dbLoadFor(profile, occ)
    const owned = ownedWeightsFor(profile, occ)
    const history = historyAs(profile, occ.exerciseId, meaning)
    // An assistance machine's load is the help given: the engine runs every step the other way.
    // An occurrence can say so itself (v1's per-exercise override), else the catalogue does.
    const assisted = typeof occ.assisted === 'boolean' ? occ.assisted : isAssisted(occ.exerciseId)
    // A reference the occurrence adopted (spec 10.1), captured from the current 1RM on its first use.
    const adopted = prog ? prog.oneRm : occ.rule && needsOneRm(occ.rule) ? occ.ref ?? currentOneRm(stored.oneRepMaxes, occ.exerciseId) : null
    if (!prog && adopted && !occ.ref) adoptReference(stored, routine.id, original.occurrenceId, adopted)
    let generation
    if (prog) generation = { trackId, state: prog.state, lastPrescription: prog.lastPrescription, lastLog: prog.lastLog, at: prog.at ?? null, startFrom: 'plan' }
    else {
      // The engine picks the history and decides a restart; this boundary only passes the profile.
      const context = resolveProgressionContext({
        trackId, exerciseId: occ.exerciseId, rule: occ.rule, assisted,
        workouts: history.workouts, prescriptions: profile.prescriptions, progression: profile.progression,
        // A ladder's rung is its own track's: another routine's state for the same exercise would move it.
        acrossRoutines: lastAcrossRoutines(profile) && !(occ.rule && operatorFor(planPhase(occ.rule), 'difficulty'))
      })
      const previous = (profile.workouts || []).flatMap(w => w.exposures || []).find(x => x.exposureId === context.baseline?.exposureId)
      const previousMeaning = entryDbLoad(previous)
      const factor = meaningFactor(previousMeaning, meaning, { id: occ.exerciseId, side: occ.side })
      if (factor !== 1 && context.state?.values?.load?.mode === 'absolute') {
        const next = context.state.values.load.value, lifted = bestLoad(previous, assisted)
        // A meaning change scales the lifted load; an earned absolute increment keeps its size.
        const earned = !context.state.deload && context.lastPrescription && operatorFor(phaseOf(context.lastPrescription), 'load')?.step.type === 'absolute' && lifted > 0 ? next - lifted : 0
        context.state = { ...context.state, values: { ...context.state.values, load: { ...context.state.values.load, value: next * factor + earned * (1 - factor) } } }
      }
      generation = {
        trackId, state: excluded ? null : context.state, lastPrescription: excluded ? null : context.lastPrescription,
        // The engine reads a log's id; a saved exposure carries it as exposureId.
        lastLog: !excluded && context.baseline ? { ...context.baseline, id: context.baseline.exposureId } : null,
        reset: excluded ? null : context.reset, heldLoad: excluded ? null : context.heldLoad, startFrom: profile.startFrom
      }
    }
    let rule = prog ? prog.rule : occ.rule
    if (occ.restFromProfile && Number.isFinite(profile.restSec)) rule = withRest(rule, profile.restSec)
    if (rule.exerciseId !== occ.exerciseId) rule = { ...rule, exerciseId: occ.exerciseId }
    if (owned) rule = { ...rule, rounding: { mode: 'allowed_values', allowedValues: owned } }
    let prescription = generatePrescription({
      id: ctx.newId(`prescription:${routine.id}:${occ.occurrenceId}:${ctx.now}:${i}`),
      now: new Date(ctx.now).toISOString(),
      rule, ...generation,
      oneRm: adopted ? oneRmForMeaning({ ...profile, oneRepMaxes: { [adopted.id]: adopted } }, occ.exerciseId, meaning) : oneRmForMeaning(profile, occ.exerciseId, meaning),
      // Lighter is harder on an assisted machine: the engine ramps its warm-ups up in help instead (#581).
      warmup: typeof occ.warmup === 'object' ? occ.warmup : null,
      warmupFloor: barFloor(profile, occ.exerciseId),
      backoff: occ.backoff === true,
      equipment: EXIDX[occ.exerciseId]?.eq ?? null, assisted,
      // What a deload needs to know about the movement (deload.js).
      perSide: occ.side === true, restPause: occ.intensifier?.type === 'restpause', restPauseReps: occ.intensifier?.totalReps,
      bodyweight: typeof occ.bodyweight === 'boolean' ? occ.bodyweight : isBodyweightEq(occ.exerciseId)
    })
    if (!prog && occ.repeatLast && prescription.preset === 'autoregulated' && modeFor(occ, prescription) === 'reps') {
      const last = lastEntryFor(history, occ.exerciseId)?.sets
      if (last?.length) {
        const rows = prescription.rows.map((row, i) => {
          const prior = last[i] || last.at(-1)
          return { ...row, load: prior.w > 0 ? { value: prior.w, unit: profile.unit } : null }
        })
        const rowReps = rows.map((_, i) => (last[i] || last.at(-1)).r)
        prescription = freezePrescription({ ...prescription, rows, prefill: { ...prescription.prefill, load: null, reps: rowReps[0], rowReps } })
      }
    }
    // Where the session went in the run, frozen with it (provenance only; its targets are the engine's).
    const stamp = prog ? { runId: view.run.id, rev: view.tracks[at.trackId]?.def?.rev ?? view.run.def.rev, trackId: at.trackId, slot: at.slot, stage: at.stage, attempt: at.attempt, role: at.role, ref: prog.oneRm ?? null, effort: prog.effort ?? null } : null
    if (stamp) prescription = freezePrescription({ ...prescription, provenance: { ...prescription.provenance, programme: stamp } })
    const exposure = {
      exposureId: ctx.newId(`exposure:${routine.id}:${occ.occurrenceId}:${ctx.now}:${i}`),
      exerciseId: occ.exerciseId, exerciseNameSnapshot: occ.exerciseName || occ.exerciseId, mode: modeFor(occ, prescription),
      routineId: routine.id, occurrenceId: occ.occurrenceId, trackId,
      excludedFromProgression: excluded,
      prescriptionId: prescription.id,
      ...Object.fromEntries(['sgName', 'sgRest', 'sideRestOff', 'sideRestSec', 'autoHold', 'warmupRestOff', 'subs', 'restOff'].filter(k => occ[k] != null).map(k => [k, occ[k]])),
      ...(stamp ? { programme: stamp } : {}),
      ...(occ.sg ? { sg: occ.sg } : {}),
      // The plan's instruction for this exercise, shown on its card; session-only (finish-session.js drops it).
      ...(typeof occ.note === 'string' && occ.note ? { setupNote: occ.note } : {}),
      ...(occ.side ? { side: true } : {}),
      ...(meaning !== 'as' ? { dbLoad: meaning, bells: bellsIn({ id: occ.exerciseId, side: occ.side }) } : {}),
      ...(occ.lastToFailure ? { lastToFailure: true } : {}),
      ...(occ.backoff ? { backoff: true } : {}),
      ...(occ.cardio?.incline != null ? { incline: occ.cardio.incline } : {}),
      assisted,
      ...(occ.warmupRestSec > 0 ? { warmupRestSec: occ.warmupRestSec } : {}),
      ...(occ.bodyweight != null ? { bodyweight: occ.bodyweight } : {}),
      ...(occ.intensifier && supports(occ.rule)[occ.intensifier.type] ? { intensifier: occ.intensifier } : {}),
      performance: { sets: [] }
    }
    prescription = sessionWarmups(profile, occ, routine, prescription, exposure, excluded)
    if (exConverted(stored, occ.exerciseId)) prescription = convPrescription(prescription, profile.unit, profileUnit(stored), true, convertExact, (v, from, to) => convertExact(v, from, to, 10))
    stored.prescriptions[prescription.id] = prescription
    return exposure
  })
}

// The first use of a 1RM rule adopts the current 1RM into the occurrence, in the same change.
function adoptReference(stored, rid, oid, ref) {
  stored.routines = (stored.routines || []).map(r => (r.id !== rid ? r : { ...r, ex: (r.ex || []).map(o => (o.occurrenceId === oid && !o.ref ? { ...o, ref: { ...ref } } : o)) }))
}

const freezePrescription = p => {
  const { contentHash: previous, ...body } = p
  return deepFreeze({ ...body, contentHash: contentHash(body) })
}
function sessionWarmups(profile, occ, routine, p, exposure, excluded) {
  const cfg = { ...occ, id: occ.exerciseId, mode: exposure.mode, ...(occ.legacyWarmupSets > 0 ? { warmup: undefined, warmupSets: occ.legacyWarmupSets } : {}) }
  const source = warmupSource(profile, cfg)
  const step = dropGrid(profile, cfg), floor = barFloor(profile, occ.exerciseId)
  const carried = profile.startFrom === 'last' && !excluded && !warmupModeOf(occ) && (typeof occ.warmup !== 'object' || occ.legacyWarmupSets > 0) && (exposure.mode === 'time' || phaseOf(p).progression.length > 0) && occ.intensifier?.type !== 'restpause'
    ? lastEntryFor(profile, occ.exerciseId, routine.id)?.warmups : null
  let rows = entriesForExposures([exposure], { [p.id]: p })[0].sets
  if (carried?.some(row => row.edited) && carried.every(row => exposure.mode === 'time' ? row.sec > 0 : isSideSet(row) || row.r > 0)) {
    rows = rows.filter(row => !isWarmupRow(row))
    for (const row of carried) {
      if (!row.edited) { rows = insertWarmupRow(rows, exposure.mode, cfg, step, floor); continue }
      const fresh = isSideSet(row) ? syncSideAggregate({ phase: 'warmup', warmup: true, edited: true, sides: Object.fromEntries(['L', 'R'].map(side => [side, { w: Number(row.sides[side].w) || 0, r: Number(row.sides[side].r) || 0, done: false }])) })
        : { w: Number(row.w) || 0, ...(exposure.mode === 'time' ? { sec: row.sec } : { r: Number(row.r) || 0 }), done: false, phase: 'warmup', warmup: true, edited: true }
      const at = rows.findIndex(row => !isWarmupRow(row))
      rows.splice(at < 0 ? rows.length : at, 0, fresh)
    }
  } else if (occ.warmup && typeof occ.warmup === 'object' && !(occ.legacyWarmupSets > 0)) return p
  else if (source.kind === 'auto' || source.kind === 'own') rows = withWarmupBlock(profile, cfg, rows, { grid: step, floor, unit: profile.unit })
  else if (occ.warmup === 'none') rows = rows.filter(row => !isWarmupRow(row))
  else if (source.kind === 'count' && (typeof occ.warmup !== 'object' || occ.legacyWarmupSets > 0)) {
    rows = rows.filter(row => !isWarmupRow(row))
    for (let i = 0; i < Math.min(5, cfg.warmupSets); i++) rows = insertWarmupRow(rows, exposure.mode, cfg, step, floor)
  } else return p
  return freezePrescription({ ...p, warmupRows: rows.filter(isWarmupRow).map(row => ({ load: { value: row.w || 0, unit: profile.unit }, reps: row.r || 1, phase: 'warmup', uiRow: row })) })
}
