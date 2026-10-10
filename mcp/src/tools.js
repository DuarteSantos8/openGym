/* The nine read-only tools. Each handler returns JSON; labels.js pre-substitutes any
   {0}/{1} template the lib returns so the LLM gets final text, not template strings.
   ISO dates are validated on the way in; the handlers never see 'yesterday'.

   Reads exclusively engineSchemaVersion 2 shapes: routines are occurrences carrying a PlanRule
   (S.routines[].ex[] = {occurrenceId, exerciseId, rule, ...}), workouts are logs
   (S.workouts[].exposures[] = {exerciseId, prescriptionId, performance, audit, ...}) pointing at an
   immutable prescription in S.prescriptions. A profile still on the old shape is refused up front
   by stateOrError() — see state.js's engineUnsupported(). */
import { z } from 'zod'
import { getState, MIN_ENGINE_SCHEMA, engineUnsupported } from './state.js'
import {
  fmt, setLabel, muscleName, friendlyDuration, ratio, muscleOrder,
  presetLabel, setRoleLabel, ruleSummary
} from './labels.js'
import {
  modeOf, workoutVolume, setsDone, effectiveRoutine, effectiveRoutineIds, workoutAt
} from '../../frontend/src/lib/history.js'
import { queueView, queueNext, pinState } from '../../frontend/src/lib/queue.js'
import { exOr, registerCustom } from '../../frontend/src/lib/exercises.js'
import { isFailureSet } from '../../frontend/src/lib/workout-model.js'
import {
  bestSetOf, best1RM, e1rmSeries, DEFAULT_FORMULA, REP_CAP
} from '../../frontend/src/lib/onerm.js'
import { loadOfWorkouts, rankOf, levelsOf } from '../../frontend/src/lib/muscles.js'
import { missingReference, planOptions, planPhase } from '../../frontend/src/lib/prescription/index.js'
import { buildSessionExposures } from '../../frontend/src/lib/session-start.js'
import { entriesForExposures } from '../../frontend/src/lib/session-ui-adapter.js'

/* ---------- helpers ---------- */

// A 'YYYY-MM-DD' the calendar actually has. The regex alone let 2026-02-30 through, and
// new Date('2026-02-30T12:00:00') rolls over to March 2 — so preview_session answered for
// March 2 while echoing February 30 back as the date it had answered for. Round-trip the string
// through the same local-noon construction the handlers use and insist it comes back unchanged;
// as a zod refine that is a -32602 at the SDK boundary instead of a confident wrong answer.
const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const todayIso = () => localIso(new Date())
const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').refine(
  v => { const d = new Date(v + 'T12:00:00'); return !Number.isNaN(d.getTime()) && localIso(d) === v },
  { message: 'not a date the calendar has (YYYY-MM-DD)' }
)

// A custom exercise lives in S.customEx and is merged into EXIDX by registerCustom() at
// store load (useStore.js:54). The MCP server deliberately never calls it: http.js serves
// several profiles from one process behind withRemoteState, so mutating the module-global
// index would leak one profile's customs into another's reads.
const customOf = (id, S) => (S.customEx || []).find(ex => ex.id === id)
// exOr's miss is a placeholder object, not null — callers that only need a name are fine
// with it, callers feeding muscle resolution are NOT. Use customOf directly there.
const exerciseOf = (id, S) => customOf(id, S) || exOr(id)
// The session builder, though, reads each exercise's equipment and body part from that global
// index, so preview_session built a custom leg lift with the small load step where the app (which
// registers its customs) takes the larger one. It registers the profile's customs for the length
// of one synchronous build and takes them back out in the same call: nothing else, and no other
// profile's read, can run in between.
function withCustomsIndexed(S, build) {
  registerCustom(Array.isArray(S.customEx) ? S.customEx : [])
  try { return build() } finally { registerCustom([]) }
}

function noState() {
  return {
    error: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
    unit: 'kg'
  }
}

function engineUnsupportedError(S) {
  return {
    error: 'engine_schema_unsupported',
    message: `This profile is on an old data format (schema ${S.engineSchemaVersion || 1}) that predates the generic training-prescription engine. Sign in from a device running the current openGym app so it can upgrade the saved data to the current format, then retry.`,
    engine_schema_version: S.engineSchemaVersion || 1,
    min_engine_schema: MIN_ENGINE_SCHEMA,
    unit: S.unit || 'kg'
  }
}

// Every handler starts here: no state file yet, a profile the engine can't read, or a live S.
function stateOrError() {
  const S = getState()
  if (!S) return { error: noState() }
  if (engineUnsupported(S)) return { error: engineUnsupportedError(S) }
  return { S }
}

const prescriptionOf = (S, exposure) => S.prescriptions?.[exposure.prescriptionId] || null
const modeOfExposure = (exId, exposure) => exposure.mode || modeOf({ id: exId })

// The plan's own numbers for one exposure — what was prescribed, never what was logged.
function prescribedTargetOf(p) {
  if (!p) return null
  const reps = p.parameters.reps
  return {
    sets: p.rows.length,
    ...(p.parameters.durationSeconds ? { sec: p.prefill.durationSeconds } : reps.min === reps.max ? { reps: reps.min } : { reps_min: reps.min, reps_max: reps.max }),
    ...(p.rows[0]?.load ? { weight: p.rows[0].load.value } : {}),
    ...(p.rows[0]?.loadTo ? { weight_max: p.rows[0].loadTo.value } : {}),
    status: p.statusAtGeneration
  }
}

function whyOf(p) {
  if (p.statusAtGeneration === 'completed') return 'progression completed — holding the terminal target'
  if (missingReference(p)) return 'no 1RM on file — percent loads are left for the athlete to fill'
  if (p.provenance.derivedFromOutOfPlan) return 'suggested from a session logged out of plan'
  return null
}

// setLabel()/history.js speaks a {w,r,sec,min,speed} row against a {id,mode,reps,sec,weight}
// cfg — the exact shape every finished/active session in the app already renders through.
// Rebuilding that pair from a prescription keeps a set's label byte-identical to what the UI
// would show, instead of re-deriving formatting rules here.
function targetCfgOf(exId, mode, target) {
  return { id: exId, mode, reps: target?.reps, sec: target?.sec, weight: target?.weight }
}

function legacyRowOf(row) {
  const obs = m => row.observations?.find(x => x.metric === m)?.value
  const dur = obs('duration')
  return {
    r: Number(obs('repetitions')) || 0,
    sec: Number(dur) || 0,
    min: dur != null ? dur / 60 : 0,
    speed: Number(obs('speed')) || 0,
    ...(obs('incline') != null ? { incline: obs('incline') } : {}),
    ...(isFailureSet(row) ? { failure: true } : {}),
    w: row.resistance?.kind === 'external-load' ? Number(row.resistance.value) || 0 : 0
  }
}

function plannedSets(S, w) {
  return (w.exposures || []).reduce((n, x) => n + (prescriptionOf(S, x)?.rows.length ?? (x.performance?.sets || []).length), 0)
}

// Full breakdown of one exposure for get_workout: what the plan asked for (prescribed_target,
// and per-set `prescribed`) versus what was actually logged (per-set `observed`) — get_workout's
// whole job is not to blur these into one number the way a routine's own display would.
function exposureView(S, exposure) {
  const ex = exerciseOf(exposure.exerciseId, S)
  const p = prescriptionOf(S, exposure)
  const mode = modeOfExposure(exposure.exerciseId, exposure)
  const target = prescribedTargetOf(p)
  const cfg = targetCfgOf(exposure.exerciseId, mode, target)
  return {
    id: exposure.exerciseId,
    name: ex.n,
    body_part: ex.bp || null,
    mode,
    excluded_from_progression: exposure.excludedFromProgression === true,
    preset_id: p?.preset || null,
    preset_label: p ? presetLabel(p.preset) : null,
    prescribed_target: target,
    // Fields the athlete logged outside the plan, from the audit saved with the log.
    out_of_plan: [...new Set((exposure.audit || []).filter(f => f.code !== 'completed_track').map(f => f.field))],
    sets: (exposure.performance?.sets || []).map(row => {
      const planned = p?.rows[Number(row.setId?.slice(1))]
      const legacy = legacyRowOf(row)
      return {
        done: row.status === 'completed',
        status: row.status,
        role: row.role || null,
        role_label: setRoleLabel(row.role),
        ...(isFailureSet(legacy) ? { failure: true } : {}),
        label: setLabel(exposure.exerciseId, legacy, cfg),
        prescribed: planned ? {
          reps_min: planned.reps.min, reps_max: planned.reps.max,
          ...(planned.load ? { weight: planned.load.value } : {}),
          ...(planned.loadTo ? { weight_max: planned.loadTo.value } : {})
        } : null,
        observed: { w: legacy.w, r: legacy.r, sec: legacy.sec, min: legacy.min, speed: legacy.speed, ...(legacy.incline != null ? { incline: legacy.incline } : {}) }
      }
    })
  }
}

// Best estimate per exercise, mirroring the UI's PR table: every eligible set across history, biggest wins.
// It asks bestSetOf() rather than scanning the rows here, so this table and the per-exercise answer of
// estimate_1rm are the same reading of the same history. They were not while this scanned: a unilateral
// set is one row carrying both sides, so the row's `r` is L+R and went over the rep cap while bestSetOf
// read each side's own reps, and a row with one side still unchecked is not `done` here but is completed
// work for the limb that finished it. The exercise then had a 1RM and no line in the PR table at once.
// An assistance machine is left out the same way (issue #232): the load is the help you were given.
// Warm-ups are skipped for the same reason bestSetOf() skips them (onerm.js): a heavy ramp row is not a
// record. Without this the coach's PR and the athlete's PR silently disagree for the same exercise.
function prTable(S, formula) {
  const byId = new Map()
  for (const w of (S.workouts || [])) {
    for (const exposure of (w.exposures || [])) {
      const best = bestSetOf(exposure, formula)
      if (!best) continue
      const prev = byId.get(exposure.exerciseId)
      if (!prev || best.est > prev.est) {
        const ex = exerciseOf(exposure.exerciseId, S)
        byId.set(exposure.exerciseId, { exId: exposure.exerciseId, exName: ex.n, bp: ex.bp || null, est: best.est, w: best.w, r: best.r, date: w.d })
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.est - a.est)
}

/* ---------- the 9 tools ---------- */

/** list_routines — names + counts of each routine in the user's plan. */
export const listRoutines = {
  name: 'list_routines',
  description: 'List the workout routines saved in the user\'s openGym profile (the same list the Plan screen shows). Each routine is a named set of exercises with set/rep targets. Use this to discover the plan structure before diving into a specific routine or today\'s workout.',
  schema: {},
  handler: () => {
    const { S, error } = stateOrError()
    if (error) return error
    return {
      unit: S.unit || 'kg',
      routines: (S.routines || []).map(r => {
        const presetIds = new Set()
        ;(r.ex || []).forEach(occ => { if (occ.rule) presetIds.add(occ.rule.preset) })
        return {
          id: r.id,
          name: r.name,
          emoji: r.emoji || null,
          exercise_count: (r.ex || []).length,
          superset_groups: [...new Set((r.ex || []).map(e => e.sg).filter(Boolean))].length || 0,
          // A routine no longer has one policy — each exercise carries its own rule — so
          // this lists every distinct one in play rather than pretending there is a single answer.
          presets: [...presetIds].sort().map(id => ({ preset_id: id, preset_label: presetLabel(id) })),
          exclude_from_progression: r.excludeFromProgression === true
        }
      })
    }
  }
}

/** get_routine — the full exercise list for one routine, including set/rep targets. */
export const getRoutine = {
  name: 'get_routine',
  description: 'Get the full exercise list for a single routine (the same view the routine editor shows). Returns mode (reps/time/cardio), the plan rule\'s progression preset and its parameters (set count, reps or rep range, load, rest, etc.), superset links, and each exercise\'s own rest in seconds (absent means it inherits the global rest timer). Use routine_id from list_routines.',
  schema: { routine_id: z.string().min(1) },
  handler: ({ routine_id }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const r = (S.routines || []).find(x => x.id === routine_id)
    if (!r) { const e = new Error(`no routine with id ${JSON.stringify(routine_id)}`); e.code = 'ENOENT'; throw e }
    const unit = S.unit || 'kg'
    return {
      id: r.id,
      name: r.name,
      emoji: r.emoji || null,
      exclude_from_progression: r.excludeFromProgression === true,
      unit,
      exercises: (r.ex || []).map((occ, i) => {
        const ex = exerciseOf(occ.exerciseId, S)
        const plan = occ.rule ? planPhase(occ.rule).parameters : null
        const mode = plan?.durationSeconds ? (modeOf({ id: occ.exerciseId }) === 'cardio' ? 'cardio' : 'time') : modeOf({ id: occ.exerciseId })
        return {
          position: i + 1,
          id: occ.exerciseId,
          name: ex.n,
          body_part: ex.bp || null,
          mode,
          preset_id: occ.rule?.preset || null,
          preset_label: occ.rule ? presetLabel(occ.rule.preset) : null,
          params: plan,
          // A program of several phases (5/3/1 weeks, accumulation then intensification): their ids, in order.
          ...(occ.rule?.program.phases.length > 1 ? { phases: occ.rule.program.phases.map(ph => ph.id) } : {}),
          // Pyramid sets: one rep target per set ('max' is as many reps as possible), each set's own rest in seconds.
          pyramid: occ.rule?.preset === 'pyramid_reps' ? planOptions(occ.rule).setReps : undefined,
          pyramid_rest_sec: occ.rule?.preset === 'pyramid_reps' ? planOptions(occ.rule).setRest : undefined,
          summary: occ.rule ? ruleSummary(occ.rule) : null,
          rest_sec: plan?.restSeconds,
          superset_group: occ.sg || null,
          laterality: occ.laterality || 'bilateral'
        }
      })
    }
  }
}

/** get_week_plan — what's scheduled each weekday + today, and the coach week when one is running. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const getWeekPlan = {
  name: 'get_week_plan',
  description: 'Show the user\'s training plan. `days` is the authoritative answer to "what is planned when": the next seven dates from today with the routines planned for each (a date can hold several — a combined day) and how each was decided: a coach-week session ("coach"), a session the user pinned to that date ("pinned"), a one-off routine override ("override"), a "rest" override ("rest_override"), the weekday plan ("weekday") or nothing ("rest"). `coach_week` is the current coach week when one is running (a week written by an external planner through the API, never by the app): its sessions are done IN ORDER on whatever days the user trains (no weekday attached), the first undone one is today\'s session, a session can be pinned to a date, and `waiting` means the week starts on `starts_on`. `weekdays` is the user\'s own weekly plan keyed by JS getDay() (Sunday=0 … Saturday=6, the openGym state convention) — in a coach week it holds only the routines the user planned themselves, which ride along beside the coach-week session.',
  schema: {},
  handler: () => {
    const { S, error } = stateOrError()
    if (error) return error
    const today = new Date()
    const isoToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
    const todayWd = today.getDay()
    const routines = S.routines || []
    const nameOf = id => routines.find(x => x.id === id)?.name || null
    // A weekday holds a routine-id list (combine routines); older states hold one id.
    const weekdayIds = d => [].concat(S.week?.[d] || []).filter(id => routines.some(x => x.id === id))
    const todayIds = effectiveRoutineIds(S, isoToday, isoToday)
    const view = queueView(S, isoToday)
    // How a date's plan was decided — the same precedence as effectiveRoutineIds, named.
    const plannedBy = (iso, ids) => {
      const ov = S.dayPlan?.[iso]
      if (ov === 'rest') return 'rest_override'
      const pin = pinState(S, ov)
      if (pin === 'open') return 'pinned'
      if (!pin && ov && routines.some(x => x.id === ov)) return 'override'
      if (ids.length && queueNext(S, iso, isoToday) === ids[0]) return 'coach'
      return ids.length ? 'weekday' : 'rest'
    }
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, 12)
      const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
      const ids = effectiveRoutineIds(S, iso, isoToday)
      return { date: iso, weekday: d.getDay(), weekday_name: DAY_NAMES[d.getDay()], routine_ids: ids, routine_names: ids.map(nameOf), planned_by: plannedBy(iso, ids) }
    })
    return {
      today: isoToday,
      today_routine_id: todayIds[0] ?? null,
      today_routine_name: todayIds.length ? nameOf(todayIds[0]) : null,
      today_routine_ids: todayIds,
      today_routine_names: todayIds.map(nameOf),
      coach_week: view ? {
        label: view.label,
        starts_on: view.startsOn,
        waiting: view.waiting,
        complete: view.complete,
        // state: done | next (today's session) | pinned (to `pinned_to`) | later
        sessions: view.items.map(i => ({ routine_id: i.id, routine_name: i.name, state: i.state, pinned_to: i.on ?? null }))
      } : null,
      days,
      weekdays: [0, 1, 2, 3, 4, 5, 6].map(d => {
        const ids = weekdayIds(d)
        // Surface today's override only (not the whole dayPlan dict — usually empty, but might
        // have grown from repeated "move this day" actions).
        const overrideForToday = d === todayWd ? (S.dayPlan?.[isoToday] ?? null) : null
        return {
          weekday: d,
          weekday_name: DAY_NAMES[d],
          routine_ids: ids,
          routine_names: ids.map(nameOf),
          routine_id: ids[0] ?? null,
          routine_name: ids.length ? nameOf(ids[0]) : null,
          routine_emoji: ids.length ? (routines.find(x => x.id === ids[0])?.emoji || null) : null,
          override_for_today_or_null: overrideForToday
        }
      })
    }
  }
}

/** list_workouts — newest-first summary of recent sessions. */
export const listWorkouts = {
  name: 'list_workouts',
  description: 'List recent finished workouts, newest first. Each item summarises the date, exercise count, sets done / planned, total volume (in the user\'s unit), duration and whether PRs were set. Use this before drilling into a specific date with get_workout.',
  schema: {
    from: isoDate().optional().describe('Inclusive start date YYYY-MM-DD. Defaults to no lower bound (list most recent).'),
    to: isoDate().optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.'),
    limit: z.number().int().min(1).max(200).optional().describe('Max items to return. Defaults to 25.')
  },
  handler: ({ from, to, limit }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const lim = Math.min(Math.max(limit || 25, 1), 200)
    // `to` is documented as defaulting to today, and had no default at all. A row dated in the
    // future — another device with a wrong clock — was listed first as the most recent session.
    const hi = to || todayIso()
    const all = (S.workouts || []).slice().sort((a, b) => (b.d || '').localeCompare(a.d || ''))
    const matching = all.filter(w => {
      if (from && w.d < from) return false
      if (w.d > hi) return false
      return true
    })
    const filtered = matching.slice(0, lim)
    return {
      unit: S.unit || 'kg',
      // total_count is all-time and predates the filter — kept as it is, since callers read it
      // that way. matching_count is how many are in the from/to range, and truncated says the
      // limit cut the list: without them "how many sessions did I do in March" was unanswerable,
      // because 25 rows and a total of 340 say nothing about the 40 in March.
      total_count: all.length,
      matching_count: matching.length,
      returned_count: filtered.length,
      truncated: filtered.length < matching.length,
      workouts: filtered.map(w => ({
        // The only thing that identifies a session uniquely. Two workouts on one day is
        // ordinary — a lifting session and an evening run — and without an id here the second
        // one cannot be asked about at all.
        id: w.id || null,
        date: w.d,
        routine_id: (w.routineIds || [])[0] || null,
        routine_name: w.name || null,
        exercise_count: (w.exposures || []).length,
        sets_done: setsDone(w),
        sets_planned: plannedSets(S, w),
        sets_ratio: ratio(setsDone(w), plannedSets(S, w)),
        volume: workoutVolume(S, w),
        duration_ms: w.end && w.start ? (w.end - w.start) : null,
        duration: w.end && w.start ? friendlyDuration(w.end - w.start) : null,
        prs: (w.prs || []).length,
        bodyweight_at_workout: w.bw || null
      }))
    }
  }
}

/** get_workout — full entry/set breakdown for one date. */
export const getWorkout = {
  name: 'get_workout',
  description: 'Get the full breakdown of one workout: every exercise, its mode (reps/time/cardio), what the plan prescribed, and what was actually logged, set by set. Identify it by workout_id (from list_workouts) or by date. Use list_workouts first if you don\'t know either.',
  schema: {
    date: isoDate().optional().describe('The workout date as YYYY-MM-DD. If two sessions share that date, the answer lists them instead and asks for a workout_id.'),
    workout_id: z.string().min(1).optional().describe('The id from list_workouts. Preferred: it names one session even on a day with two.')
  },
  handler: ({ date, workout_id }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const workouts = S.workouts || []
    let w
    if (workout_id) {
      w = workouts.find(x => x.id === workout_id)
      if (!w) { const e = new Error(`no workout with id ${workout_id}`); e.code = 'ENOENT'; throw e }
    } else if (date) {
      const sameDay = workouts.filter(x => x.d === date)
      if (!sameDay.length) { const e = new Error(`no workout on ${date}`); e.code = 'ENOENT'; throw e }
      // Answering with the first of two is how a question about the evening run gets the
      // morning's lifting numbers, stated with total confidence. Say there are two instead.
      if (sameDay.length > 1) {
        return {
          ambiguous: true,
          date,
          message: `${sameDay.length} workouts were logged on ${date} — call get_workout again with one of these workout_id values.`,
          workouts: sameDay.map(x => ({
            id: x.id || null,
            routine_name: x.name || null,
            sets_done: setsDone(x),
            volume: workoutVolume(S, x),
            duration: x.end && x.start ? friendlyDuration(x.end - x.start) : null
          }))
        }
      }
      w = sameDay[0]
    } else {
      const e = new Error('get_workout needs either workout_id or date'); e.code = 'EINVAL'; throw e
    }
    return {
      id: w.id || null,
      date: w.d,
      routine_id: (w.routineIds || [])[0] || null,
      routine_name: w.name || null,
      unit: S.unit || 'kg',
      bodyweight_at_workout: w.bw || null,
      volume: workoutVolume(S, w),
      sets_done: setsDone(w),
      sets_planned: plannedSets(S, w),
      duration: w.end && w.start ? friendlyDuration(w.end - w.start) : null,
      prs: (w.prs || []).map(id => {
        const ex = exerciseOf(id, S)
        return ex.missing ? id : ex.n
      }),
      entries: (w.exposures || []).map(exposure => exposureView(S, exposure))
    }
  }
}

/** get_bodyweight — recent weigh-ins with the goal line. */
export const getBodyweight = {
  name: 'get_bodyweight',
  description: 'Get the body-weight log: chronological weigh-ins with weights, current goal, deltas vs goal (signed positive = above goal), and a latest summary. Useful for "am I trending toward my weight goal?" questions.',
  schema: {
    from: isoDate().optional().describe('Inclusive start date YYYY-MM-DD.'),
    to: isoDate().optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.')
  },
  handler: ({ from, to }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const goal = S.targetW || null
    // Same documented default as list_workouts: a future-dated weigh-in is not "latest".
    const hi = to || todayIso()
    const bw = (S.bodyweight || []).filter(b => {
      if (from && b.d < from) return false
      if (b.d > hi) return false
      return true
    }).sort((a, b) => (a.d || '').localeCompare(b.d || ''))
    const latest = bw.length ? bw[bw.length - 1] : null
    return {
      unit: S.unit || 'kg',
      goal,
      count: bw.length,
      latest: latest ? { date: latest.d, weight: latest.w, delta_vs_goal: goal != null ? Math.round((latest.w - goal) * 10) / 10 : null } : null,
      entries: bw.map(b => ({
        date: b.d,
        weight: b.w,
        delta_vs_goal: goal != null ? Math.round((b.w - goal) * 10) / 10 : null
      }))
    }
  }
}

/** estimate_1rm — best-ever 1RM for one exercise or a PR table across all reps-mode exercises. */
export const estimate1rm = {
  name: 'estimate_1rm',
  description: `Estimate one-rep max using Epley, Brzycki or Lombardi formulas. If an exercise_id is given, returns the all-time best estimate for that exercise with the source set (weight × reps + date) and the trend across history. If no exercise_id is given, returns a PR table across all reps-mode exercises (sorted highest first). Refuses to guess above ${REP_CAP} reps — above that, formulas diverge past 10% and "work capacity" is read instead of "maximal strength".`,
  schema: {
    // .min(1): an empty string is falsy, so it used to fall through to "no exercise_id given" and
    // answer a question about one exercise with the whole PR table.
    exercise_id: z.string().min(1).optional().describe('An exercise id from list_routines or get_workout entries. If omitted, returns a full PR table.'),
    formula: z.enum(['epley', 'brzycki', 'lombardi']).optional().describe(`Formula to use. Defaults to ${DEFAULT_FORMULA}.`)
  },
  handler: ({ exercise_id, formula }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const f = formula || DEFAULT_FORMULA
    if (exercise_id) {
      const ex = exerciseOf(exercise_id, S)
      const best = best1RM(S, exercise_id, f)
      const series = e1rmSeries(S, exercise_id, f)
      // A null best has two very different causes: never trained, or trained only above the
      // rep cap. Without saying which, an exercise logged for years at 15 reps reads as "no
      // records for calf raise" — a confident statement about the opposite of the truth.
      const trainedAtAll = (S.workouts || []).some(w =>
        (w.exposures || []).some(x => x.exerciseId === exercise_id && (x.performance?.sets || []).some(s => s.status === 'completed')))
      // exOr's miss is a placeholder named "Unknown exercise", not null. A typo'd or made-up id
      // therefore came back as "No completed sets logged for this exercise" — a statement about
      // the athlete's training, when the truth is that no such exercise exists. A deleted custom
      // is unknown to the catalogue too, but it has logged sets, so it keeps the real answer.
      const unknown = !!ex.missing && !trainedAtAll
      return {
        exercise: { id: exercise_id, name: ex.n, body_part: ex.bp || null, ...(unknown ? { unknown: true } : {}) },
        formula: f,
        formula_note: `Estimates use the ${f} formula. Cap at ${REP_CAP} reps applies; r=1 is treated as the measurement, not an estimate.`,
        best: best ? { est: best.est, w: best.w, r: best.r, date: best.d } : null,
        no_estimate_reason: best ? null
          : trainedAtAll
            ? `This exercise has logged sets, but none of them qualify: every set was above the ${REP_CAP}-rep cap, or carried no weight. That is not the same as never having trained it.`
            : unknown
              ? `No exercise with id ${JSON.stringify(exercise_id)} exists — not in the catalogue, not among this profile's custom exercises, and nothing is logged against it. Check the id against list_routines or a get_workout entry.`
              : 'No completed sets logged for this exercise.',
        trend: series.map(p => ({ date: p.d, est: p.y, w: p.w, r: p.r }))
      }
    }
    return {
      formula: f,
      formula_note: `Estimates use the ${f} formula. Cap at ${REP_CAP} reps applies; r=1 is treated as the measurement, not an estimate.`,
      pr_table: prTable(S, f)
    }
  }
}

/** muscle_balance — training distribution per muscle over a period (week/month/all). */
export const muscleBalance = {
  name: 'muscle_balance',
  description: 'Show which muscles the user has trained in a period, ranked by "effective sets" (volume in kg is intentionally not used — 100 kg leg press vs 12 kg lateral raise say nothing about which muscle worked harder). Reports worked muscles with a 0-4 relative level (1 = some work, 4 = most worked) and the muscles trained zero times in that period — useful for "what am I neglecting?" questions.',
  schema: {
    period: z.enum(['week', 'month', 'all']).describe('window: last 7 days, last 30 days, or all-time')
  },
  handler: ({ period }) => {
    const { S, error } = stateOrError()
    if (error) return error
    // Whole local days, counting today: a week is the 7 dates ending today, a month the 30. The
    // cutoff used to be an instant 7 x 24h back, which for the workouts that carry no clock — an
    // import, a hand-added session; they fall back to their date at local noon — pulled in an
    // EIGHTH calendar date, the one 7 days ago. "Last 7 days" listing 8 of them.
    const now = new Date()
    const midnightDaysBack = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n).getTime()
    const cutoff = period === 'week' ? midnightDaysBack(6)
      : period === 'month' ? midnightDaysBack(29)
        : Number.NEGATIVE_INFINITY
    const workouts = (S.workouts || []).filter(w => workoutAt(w) >= cutoff)
    const load = loadOfWorkouts(workouts.map(w => ({
      ...w,
      exposures: (w.exposures || []).map(x => {
        const custom = customOf(x.exerciseId, S)
        return custom && !x.muscleSnapshot ? { ...x, muscleSnapshot: custom } : x
      })
    })))
    const { worked, missed } = rankOf(load)
    const levels = levelsOf(load)
    return {
      period,
      // Local, like every other date this API reports (get_week_plan.today, every workout date).
      // toISOString() reads UTC, so late in the evening west of Greenwich the reported cutoff was
      // the day AFTER the one the filter used, and east of Greenwich the day before.
      cutoff_iso: period === 'all' ? null : localIso(new Date(cutoff)),
      workouts_in_period: workouts.length,
      worked: worked.map(slug => ({ slug, name: muscleName(slug), level: levels[slug], effective_sets: Math.round((load[slug] || 0) * 10) / 10 })),
      neglected: missed.map(slug => ({ slug, name: muscleName(slug) })),
      muscle_order_head_to_toe: muscleOrder()
    }
  }
}

/* ---------- preview_session ---------- */

/** preview_session — what starting this routine will actually put on screen. */
export const previewSession = {
  name: 'preview_session',
  description:
    'Preview the session a routine will actually open with — the numbers the user will see after the progression rule and their training history have generated a concrete prescription from the routine\'s plan rule. This is NOT the same as get_routine: a routine configured for "squat 3x5 @ 60kg" can open at 62.5kg because the policy advanced from the last logged session. Always call this (not get_routine) before telling someone what weight they are about to lift, or before judging whether an edit to a routine had any effect. Returns, per exercise, the plan rule\'s current configuration, the generated prescription and why it differs, if it does, and the opening set rows. Defaults to today\'s scheduled routine.',
  schema: {
    routine_id: z.string().min(1).optional().describe('Routine to preview. Defaults to the routine scheduled for `date`.'),
    date: isoDate().optional().describe('Date the session would be started on, YYYY-MM-DD. Affects which routine is scheduled, any one-off day override, and which training references are visible. Defaults to today.')
  },
  handler: ({ routine_id, date }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const now = date ? new Date(date + 'T12:00:00').getTime() : Date.now()
    const d = new Date(now)
    const iso = date || (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))

    let r
    if (routine_id) {
      r = (S.routines || []).find(x => x.id === routine_id)
      if (!r) { const e = new Error(`no routine with id ${JSON.stringify(routine_id)}`); e.code = 'ENOENT'; throw e }
    } else {
      r = effectiveRoutine(S, iso)
      if (!r) return { date: iso, routine_id: null, routine_name: null, rest_day: true, note: 'no routine is scheduled for this date (rest day)', exercises: [] }
    }

    const unit = S.unit || 'kg'
    // The same builder the app starts a session with (sheets.jsx beginWorkout → session-start.js):
    // prescription, references and history all come from there, so the preview cannot drift from
    // what the screen shows. It writes the newly generated prescriptions into profile.prescriptions
    // (exactly what happens when a session is actually opened) — run it against a scratch copy of
    // the dictionary so a read-only preview never touches the shared cached profile.
    const scratch = { ...S, prescriptions: { ...(S.prescriptions || {}) } }
    const built = withCustomsIndexed(S, () => buildSessionExposures(scratch, r, { now, newId: seed => seed, unit }))
    const entries = entriesForExposures(built, scratch.prescriptions)

    const exercises = (r.ex || []).map((occ, i) => {
      const ex = exerciseOf(occ.exerciseId, S)
      const p = scratch.prescriptions[built[i].prescriptionId]
      const mode = modeOfExposure(occ.exerciseId, built[i])
      const configured = planPhase(occ.rule).parameters
      const prescribed = prescribedTargetOf(p)
      const cfg = targetCfgOf(occ.exerciseId, mode, prescribed)

      // Did the generated prescription actually differ from what the rule is configured for
      // right now? Only meaningful for the axis the preset progresses.
      const configuredWeight = configured.load.mode === 'absolute' ? configured.load.value : null
      const prescribedReps = prescribed.reps ?? prescribed.reps_min
      const changed = [
        ...(configuredWeight != null && prescribed.weight != null && prescribed.weight !== configuredWeight ? ['weight'] : []),
        ...(!configured.durationSeconds && prescribedReps != null && prescribedReps !== configured.reps.min ? ['reps'] : []),
        ...(configured.durationSeconds && prescribed.sec != null && prescribed.sec !== configured.durationSeconds.min ? ['sec'] : [])
      ]

      return {
        position: i + 1,
        id: occ.exerciseId,
        name: ex.n,
        mode,
        preset_id: p.preset,
        preset_label: presetLabel(p.preset),
        configured: { ...configured, summary: ruleSummary(occ.rule) },
        prescription: { ...prescribed, why: whyOf(p) },
        opening_sets: entries[i].sets.map(row => {
          const role = row.phase === 'warmup' || row.warmup ? 'warmup' : 'work'
          return {
            role, role_label: setRoleLabel(role), type: row.type || 'straight',
            ...(isFailureSet(row) ? { failure: true } : {}),
            label: setLabel(occ.exerciseId, row, entries[i].target),
            w: Number(row.w) || 0, r: Number(row.r) || 0, sec: Number(row.sec) || 0,
            min: Number(row.min) || 0, speed: Number(row.speed) || 0,
            ...(row.incline != null ? { incline: row.incline } : {})
          }
        }),
        changed
      }
    })

    const differing = exercises.filter(e => e.changed.length)
    return {
      date: iso,
      routine_id: r.id,
      routine_name: r.name,
      unit,
      exercises,
      // Surfaced separately so a coach reading this cannot miss it: these are the exercises
      // where what the routine is configured for and what the athlete will see are two
      // different numbers.
      overridden_count: differing.length,
      overridden: differing.map(e => ({ name: e.name, changed: e.changed, reason: e.prescription.why }))
    }
  }
}

/* ---------- registration list ---------- */

export const TOOLS = [
  listRoutines, getRoutine, previewSession, getWeekPlan, listWorkouts, getWorkout, getBodyweight, estimate1rm, muscleBalance
]
