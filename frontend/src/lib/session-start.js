// Generate one immutable prescription per routine occurrence. The engine decides; this boundary
// only gathers its inputs (rule, track state, newest log, current 1RM) and stores its output.
import { policyOfPreset, planOptions, currentOneRm, bestLoad, operatorFor, phaseOf, planFingerprint, planPhase, rungsOf, defaultPlanRule, generatePrescription, needsOneRm, resolveProgressionContext, slotFor, slotInputs, supports, withRest } from './prescription/index.js'
import { EXIDX, isAssisted, isBodyweightEq } from './exercises.js'
import { modeOf, barFloor, lastAcrossRoutines, lastEntryFor, insertWarmupRow } from './history.js'
import { oneRmForMeaning } from './onerm.js'
import { exView, exConverted, viewTarget, profileUnit } from './ex-unit.js'
import { convertExact, convPrescription } from './units.js'
import { prescriptionWhy } from './progression-why.js'
import { captureReference, programmeView } from './programmes.js'
import { dateIn } from '../../../api/engine/programme-run.js'
import { isDeloadDay, deloadSets } from './deload-cycle.js'
import { bandsOf, setBandsOf, nextBandsUp, usesBands } from './bands.js'
import { gymSplitView } from './gym-split.js'
import { nextRung } from './ladders.js'
import { dupSessions, undulatingDay } from './undulating.js'
import { isoOf } from './format.js'
import { warmupSource, warmupModeOf, withWarmupBlock } from './warmup-ramp.js'
import { dropGrid } from './plates.js'
import { isWarmupRow, isSideSet, syncSideAggregate } from './workout-model.js'
import { contentHash, deepFreeze } from '../../../api/engine/index.js'
import { entriesForExposures, loadStepFor } from './session-ui-adapter.js'
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
      const at = view && slotFor({ view, run: view.run, rid: routine.id, oid: occ.occurrenceId, date: dateIn(Date.now(), view.run.tz || 'UTC') }).assignment
      const own = at ? slotInputs({ view, run: view.run, assignment: at, occRule: occ.rule }).blocked === 'reference-missing' : occ.rule && needsOneRm(occ.rule) && !occ.ref
      if (own) ids.add(occ.exerciseId)
    }
  }
  return [...ids]
}

/** An occurrence whose rule starts from `preset`'s defaults with these plain numbers. */
export function occurrenceFor(exerciseId, { sets, reps, sec, weight } = {}, { id, unit = 'kg', routineId = null, preset = 'manual' } = {}) {
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
  // The workout in progress (`ctx.active`): an exercise added to it never takes a slot it holds already.
  const active = ctx.active ?? stored.active ?? null
  // Only the records a run reads: spreading the draft would copy the whole profile.
  const runView = () => programmeView(ctx.replaceId == null ? stored : { programme: stored.programme, programmeRuns: stored.programmeRuns, programmeEvents: stored.programmeEvents,
    prescriptions: stored.prescriptions, routines: stored.routines, workouts: (stored.workouts || []).filter(w => w.id !== ctx.replaceId) }, null, active)
  // Logged as extra (`ctx.extra`, the person's answer to a bypass): outside the run, moving nothing.
  const outside = routine?.excludeFromProgression === true || ctx.extra === true
  let view = outside ? null : runView()
  // The session's day in the run's own timezone, the one its saved work is read back in (deriveRun):
  // the start of the workout in progress an exercise joins, else now. Never the device's own date.
  const date = view && (ctx.date || dateIn(Number.isFinite(active?.start) ? active.start : ctx.now, view.run.tz || 'UTC'))
  const placed = (routine?.ex || []).map(occ => (view ? slotFor({ view, run: view.run, rid: routine.id, oid: occ.occurrenceId, date, appt: ctx.appts?.[routine.id] ?? null }) : null))
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
    const excluded = outside || occ.excludeFromProgression === true || !!inputs?.blocked || (!!prog && (at.role !== 'work' || prog.rule.program.adaptive === false))
    const trackId = prog ? prog.trackId : occ.occurrenceId
    const meaning = dbLoadFor(profile, occ)
    const owned = ownedWeightsFor(profile, occ)
    // An exercise kept per gym (#988, lib/gym-split.js) reads only this gym's (or brand's) sessions:
    // the engine then replays its track over those alone, so each gym progresses on its own (v1).
    const history = gymSplitView({ ...historyAs(profile, occ.exerciseId, meaning), ...(ctx.active?.gym ? { active: { gym: ctx.active.gym } } : {}) }, occ.exerciseId)
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
      failureSets: modeOf({ mode: occ.mode, id: occ.exerciseId }) === 'cardio' ? undefined : occ.failureSets,
      lastToFailure: modeOf({ mode: occ.mode, id: occ.exerciseId }) !== 'cardio' && occ.lastToFailure === true,
      equipment: EXIDX[occ.exerciseId]?.eq ?? null, assisted,
      // What a deload needs to know about the movement (deload.js).
      perSide: occ.side === true, restPause: occ.intensifier?.type === 'restpause', restPauseReps: occ.intensifier?.totalReps,
      bodyweight: typeof occ.bodyweight === 'boolean' ? occ.bodyweight : isBodyweightEq(occ.exerciseId)
    })
    // "Repeat today" hands over the rows of the day it repeats (session-repeat.js), as many as were done.
    const repeated = ctx.rows?.get(occ.occurrenceId)
    if (repeated) prescription = prescriptionAtRows(prescription, repeated, profile.unit, repeated.length)
    else if (!prog && occ.repeatLast && prescription.preset === 'manual' && modeFor(occ, prescription) === 'reps') {
      const last = lastEntryFor(history, occ.exerciseId)?.sets
      if (last?.length) prescription = prescriptionAtRows(prescription, last, profile.unit)
    }
    // A carry or a sled (#1011): the slot's metres, or last time's metres and load when that was a
    // distance set too (v1 buildWorkSets); no progression of its own yet.
    if (modeFor(occ, prescription) === 'distance' && !repeated) {
      const last = (lastEntryFor(history, occ.exerciseId, routine?.id)?.sets || []).filter(r => !isWarmupRow(r) && r.m > 0)
      const n = prescription.rows.length
      const at = i => last[i] || last.at(-1)
      const metres = Math.max(1, Math.round(Number(occ.distance?.m)) || 20)
      prescription = freezePrescription({
        ...prescription,
        ...(last.length ? { rows: prescription.rows.map((row, i) => ({ ...row, load: at(i).w > 0 ? { value: at(i).w, unit: profile.unit } : row.load })) } : {}),
        prefill: { ...prescription.prefill, metres, ...(last.length ? { rowMetres: Array.from({ length: n }, (_, i) => at(i).m), load: null } : {}) }
      })
    }
    // A band exercise (lib/bands.js, v1 seedBands): each row opens with the bands last time's did,
    // else the slot's. Every work set at the top of the reps climbs one band and starts the reps
    // again at the bottom, instead of one rep more on the same band (night QA 146).
    let rowBands = null, bandClimb = false
    if (modeFor(occ, prescription) === 'reps' && !repeated && usesBands(profile, occ.exerciseId, occ)) {
      const plan = setBandsOf({ bands: occ.bands })
      const lastEntry = lastEntryFor(history, occ.exerciseId, routine?.id)
      const lastWork = (lastEntry?.sets || []).filter(r => !isWarmupRow(r) && !isSideSet(r))
      const anyBands = lastWork.some(r => setBandsOf(r).length)
      if (anyBands || plan.length) {
        // A ladder migrated from a v1 double keeps that window (loadedReps): its bottom is where the reps restart.
        const reps = planOptions(occ.rule).loadedReps || planPhase(occ.rule).parameters.reps
        const list = bandsOf(profile)
        // The top is what last time asked for (a ladder's reps climb without a ceiling of their own).
        const top = Number(lastEntry?.target?.reps) > 0 ? Number(lastEntry.target.reps) : reps.max < 1000 ? reps.max : reps.min
        bandClimb = anyBands && (policyOfPreset(prescription.preset) || 'off') !== 'off' && !(prescription.rows[0]?.load?.value > 0) && top > 0 && lastWork.every(r => Number(r.r) >= top)
          && !!nextBandsUp(setBandsOf(lastWork[0]), list)
        rowBands = prescription.rows.map((_, i) => {
          const prev = lastWork[i] || lastWork.at(-1)
          const ids = (anyBands && setBandsOf(prev).length ? setBandsOf(prev) : plan)
          return ids.length && bandClimb ? nextBandsUp(ids, list) || ids : ids
        })
        if (bandClimb) prescription = prescriptionAtRows(prescription, prescription.rows.map(() => ({ w: 0, r: reps.min })), profile.unit)
      }
    }
    // Undulating days (lib/undulating.js): today's reps off the plan, the load off the recent estimated
    // max, the day stamped on the exposure. Also a bodyweight ladder that has turned undulating with weight.
    let dup = null
    const undulating = prescription.preset === 'undulating' || (planOptions(occ.rule).loadedPreset === 'undulating' && prescription.rows[0]?.load?.value > 0)
    if (undulating && !prog && !repeated && !excluded && !assisted && modeFor(occ, prescription) === 'reps') {
      const day = undulatingDay(dupSessions(history.workouts, occ.exerciseId), { reps: planPhase(occ.rule).parameters.reps.max, perSide: occ.side === true, step: planOptions(occ.rule).step?.type === 'absolute' ? planOptions(occ.rule).step.value : loadStepFor(prescription, profile.unit), unit: profile.unit })
      if (day) {
        dup = day
        const w = day.weight ?? prescription.rows[0]?.load?.value ?? 0
        prescription = prescriptionAtRows(prescription, prescription.rows.map(() => ({ w, r: day.reps })), profile.unit)
      }
    }
    // A deload week of your own (lib/deload-cycle.js), with no programme running: fewer work sets,
    // the weight and reps where they were, and the session kept out of progression. Only a lifting
    // exercise of a routine; a timed hold, cardio or pyramid sets train as usual (v1 planEntry).
    const deloadWeek = !prog && !repeated && routine?.id != null && routine.id !== 'freestyle' && modeFor(occ, prescription) === 'reps'
      && !['pyramid_reps', 'pyramid'].includes(prescription.preset) && isDeloadDay(profile, ctx.date || isoOf(new Date(ctx.now)), !!programmeView(stored))
    if (deloadWeek) {
      const planned = planPhase(occ.rule).parameters
      const n = deloadSets(planned.sets.min)
      const lastW = (lastEntryFor(history, occ.exerciseId, routine.id)?.sets || []).filter(r => !isWarmupRow(r) && r.w > 0).at(-1)?.w
      const w = lastW > 0 ? lastW : prescription.rows[0]?.load?.value ?? 0
      prescription = prescriptionAtRows(prescription, [{ w, r: planned.reps.max }], profile.unit, n)
    }
    // Where the session went in the run, frozen with it (provenance only; its targets are the engine's).
    const stamp = prog ? { runId: view.run.id, rev: view.tracks[at.trackId]?.def?.rev ?? view.run.def.rev, trackId: at.trackId, slot: at.slot, stage: at.stage, attempt: at.attempt, role: at.role, ref: prog.oneRm ?? null, effort: prog.effort ?? null } : null
    if (stamp) prescription = freezePrescription({ ...prescription, provenance: { ...prescription.provenance, programme: stamp } })
    const exposure = {
      exposureId: ctx.newId(`exposure:${routine.id}:${occ.occurrenceId}:${ctx.now}:${i}`),
      exerciseId: occ.exerciseId, exerciseNameSnapshot: occ.exerciseName || occ.exerciseId, mode: modeFor(occ, prescription),
      routineId: routine.id, occurrenceId: occ.occurrenceId, trackId,
      excludedFromProgression: excluded || deloadWeek,
      prescriptionId: prescription.id,
      ...(deloadWeek ? { deloadWeek: true } : {}),
      ...(rowBands?.some(ids => ids.length) ? { rowBands } : {}),
      ...(dup ? { dup: dup.day } : {}),
      ...Object.fromEntries(['sgName', 'sgRest', 'sgCircuit', 'tempo', 'nextRestSec', 'nextRestOff', 'sideRestOff', 'sideRestSec', 'autoHold', 'warmupRestOff', 'subs', 'restOff'].filter(k => occ[k] != null).map(k => [k, occ[k]])),
      ...(stamp ? { programme: stamp } : {}),
      ...(occ.sg ? { sg: occ.sg } : {}),
      // The plan's instruction for this exercise, shown on its card; session-only (finish-session.js drops it).
      ...(typeof occ.note === 'string' && occ.note ? { setupNote: occ.note } : {}),
      ...(occ.side ? { side: true } : {}),
      ...(meaning !== 'as' ? { dbLoad: meaning, bells: bellsIn({ id: occ.exerciseId, side: occ.side }) } : {}),
      ...(prescription.failureSets != null ? { failureSets: prescription.failureSets } : {}),
      ...(occ.lastToFailure && prescription.failureSets === 'last' ? { lastToFailure: true } : {}),
      ...(occ.backoff ? { backoff: true } : {}),
      ...(occ.cardio?.incline != null ? { incline: occ.cardio.incline } : {}),
      ...(occ.cardio?.level != null ? { level: occ.cardio.level } : {}),
      assisted,
      ...(occ.warmupRestSec > 0 ? { warmupRestSec: occ.warmupRestSec } : {}),
      ...(occ.bodyweight != null ? { bodyweight: occ.bodyweight } : {}),
      ...(occ.intensifier && supports(occ.rule)[occ.intensifier.type] ? { intensifier: occ.intensifier } : {}),
      performance: { sets: [] }
    }
    // Why it opens at these numbers (v1's line on the card); session-only, like the note (finish-session.js drops it).
    const why = bandClimb ? null : dup ? { policy: 'undulating', kind: dup.kind, why: dup.why } : deloadWeek ? { policy: policyOfPreset(prescription.preset) || 'off', kind: 'deloadweek', why: ['Deload week: {0} of {1} sets, same weight. Lighter on purpose.', prescription.rows.length, planPhase(occ.rule).parameters.sets.min] }
      : prog || excluded ? null : prescriptionWhy({ prescription, last: generation.lastPrescription, state: generation.state, lastLog: generation.lastLog, reset: generation.reset, unit: profile.unit, assisted })
    if (why) exposure.plan = why
    // A skill ladder at the top with every set there (v1 ladderPrescription): the plan names the next,
    // harder rung for the workout to offer (views/Workout.jsx LadderNext), or says it is the last.
    if (prescription.preset === 'skill_ladder' && !prog && !excluded && generation.lastLog) {
      const top = planPhase(occ.rule).parameters.reps.max
      const last = (lastEntryFor(history, occ.exerciseId, routine?.id)?.sets || []).filter(r => !isWarmupRow(r))
      if (prescription.prefill.reps >= top && last.length && last.every(r => Number(r.r) >= top)) {
        const next = nextRung(profile, occ.exerciseId)
        exposure.plan = next ? { policy: 'ladder', kind: 'ladder', next, why: ['Every set at {0}. You’re ready for the next rung.', top] }
          : { policy: 'ladder', kind: 'hold', why: ['Top of the ladder. Add weight, slow the tempo or make your own next rung.'] }
      }
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

/**
 * A prescription reopened at rows that were logged (a freestyle exercise's last time, "Repeat
 * today"): each row at its own weight and reps, a hold at its seconds, cardio at its minutes and
 * speed, `count` rows of them.
 */
function prescriptionAtRows(p, logged, unit, count = p.rows.length) {
  const at = i => logged[i] || logged.at(-1)
  const rows = Array.from({ length: count }, (_, i) => ({ ...(p.rows[i] || p.rows.at(-1)), load: at(i).w > 0 ? { value: at(i).w, unit } : null }))
  const rowReps = rows.map((_, i) => at(i).r)
  const own = !p.parameters.durationSeconds ? { reps: rowReps[0], rowReps }
    : p.parameters.speed ? { cardioRows: rows.map((_, i) => ({ min: at(i).min, speed: at(i).speed, ...(at(i).incline != null ? { incline: at(i).incline } : {}), ...(at(i).level != null ? { level: at(i).level } : {}) })) }
      : at(0).sec > 0 ? { durationSeconds: at(0).sec, rowSeconds: rows.map((_, i) => at(i).sec || at(0).sec) } : {}
  return freezePrescription({ ...p, rows, prefill: { ...p.prefill, sets: count, load: null, ...own } })
}

const freezePrescription = p => {
  const { contentHash: previous, ...body } = p
  return deepFreeze({ ...body, contentHash: contentHash(body) })
}
function sessionWarmups(profile, occ, routine, p, exposure, excluded) {
  // Cardio has no carried warm-up block; a rep exercise with progression off still carries marked
  // warm-ups when it starts its work rows from the last session (v1.4.5).
  const cfg = { ...occ, id: occ.exerciseId, mode: exposure.mode, ...(occ.legacyWarmupSets > 0 ? { warmup: undefined, warmupSets: occ.legacyWarmupSets } : {}) }
  const source = warmupSource(profile, cfg)
  const step = dropGrid(profile, cfg), floor = barFloor(profile, occ.exerciseId)
  const carried = profile.startFrom === 'last' && !excluded && !warmupModeOf(occ) && (typeof occ.warmup !== 'object' || occ.legacyWarmupSets > 0) && exposure.mode !== 'cardio' && occ.intensifier?.type !== 'restpause'
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

/**
 * One exercise built the way adding it to a running session builds it (Workout.jsx's Add): from
 * `routine`'s rule when it belongs to one, else freestyle, at last time's numbers. Writes its
 * prescription to `stored` (the store's update draft) and returns `{ entry, exposures }` for the
 * running workout, which keeps its exposures beside its entries. `ctx`: `{ now, newId, active }`.
 */
export function buildSessionEntry(stored, exId, cfg, routine = null, ctx = {}) {
  const newId = ctx.newId || (() => Date.now().toString(36) + Math.random().toString(36).slice(2, 7))
  const occ = occurrenceFor(exId, cfg || {}, { id: newId(), unit: stored.unit, routineId: routine?.id ?? null })
  const occurrence = routine ? occ : { ...occ, repeatLast: true }
  const exposures = buildSessionExposures(stored, { ...(routine || { id: 'freestyle' }), ex: [occurrence] }, { now: ctx.now ?? Date.now(), newId, unit: stored.unit, active: ctx.active ?? null })
  if (!routine) for (const x of exposures) delete x.routineId
  const [entry] = entriesForExposures(exposures, stored.prescriptions, stored)
  return { entry: entry ? { id: exId, ...entry } : null, exposures }
}
