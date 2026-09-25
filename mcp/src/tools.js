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
import { modeOf, effectiveRoutine, effectiveRoutineId, workoutVolume, setsDone } from '../../frontend/src/lib/history.js'
import { exOr } from '../../frontend/src/lib/exercises.js'
import {
  estimate1RM, best1RM, e1rmSeries, bestSetOf, DEFAULT_FORMULA, REP_CAP
} from '../../frontend/src/lib/onerm.js'
import { loadOf, rankOf, levelsOf } from '../../frontend/src/lib/muscles.js'
import { missingReference } from '../../frontend/src/lib/prescription/index.js'
import { buildSessionExposures } from '../../frontend/src/lib/session-start.js'

/* ---------- helpers ---------- */

// A custom exercise lives in S.customEx and is merged into EXIDX by registerCustom() at
// store load (useStore.js:54). The MCP server deliberately never calls it: http.js serves
// several profiles from one process behind withRemoteState, so mutating the module-global
// index would leak one profile's customs into another's reads.
const customOf = (id, S) => (S.customEx || []).find(ex => ex.id === id)
// exOr's miss is a placeholder object, not null — callers that only need a name are fine
// with it, callers feeding muscle resolution are NOT. Use customOf directly there.
const exerciseOf = (id, S) => customOf(id, S) || exOr(id)

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
        label: setLabel(exposure.exerciseId, legacy, cfg),
        prescribed: planned ? {
          reps_min: planned.reps.min, reps_max: planned.reps.max,
          ...(planned.load ? { weight: planned.load.value } : {}),
          ...(planned.loadTo ? { weight_max: planned.loadTo.value } : {})
        } : null,
        observed: { w: legacy.w, r: legacy.r, sec: legacy.sec, min: legacy.min, speed: legacy.speed }
      }
    })
  }
}

// Best estimate per exercise, mirroring the UI's PR table: every exposure across history,
// biggest wins. bestSetOf (onerm.js) already skips warm-up rows (by their written role) and
// assistance-machine exercises, so this stays a thin fold over it.
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

// Completed, non-warm-up sets for one exposure — the count loadOf() wants per exercise.
// Mirrors muscles.js's own loadOfWorkouts, adapted from legacy `entries` to canonical
// `exposures` (muscles.js itself hasn't been migrated — out of this task's file list).
function exposureSetCount(exposure, pick) {
  return (exposure.performance?.sets || []).filter(row =>
    row.status === 'completed' && row.role !== 'warmup' && (!pick || pick(row))
  ).length
}
function loadOfCanonicalWorkouts(S, workouts, pick) {
  return loadOf(workouts.flatMap(w => (w.exposures || []).map(exposure => ({
    id: exposure.exerciseId,
    ex: customOf(exposure.exerciseId, S) || undefined,
    sets: exposureSetCount(exposure, pick)
  }))))
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
        const mode = occ.rule?.parameters.durationSeconds ? (modeOf({ id: occ.exerciseId }) === 'cardio' ? 'cardio' : 'time') : modeOf({ id: occ.exerciseId })
        return {
          position: i + 1,
          id: occ.exerciseId,
          name: ex.n,
          body_part: ex.bp || null,
          mode,
          preset_id: occ.rule?.preset || null,
          preset_label: occ.rule ? presetLabel(occ.rule.preset) : null,
          params: occ.rule?.parameters || null,
          summary: occ.rule ? ruleSummary(occ.rule) : null,
          rest_sec: occ.rule?.parameters.restSeconds,
          superset_group: occ.sg || null,
          laterality: occ.laterality || 'bilateral'
        }
      })
    }
  }
}

/** get_week_plan — what's scheduled each weekday + today. */
export const getWeekPlan = {
  name: 'get_week_plan',
  description: 'Show the user\'s weekly plan: which routine (if any) is assigned to each weekday, keyed by JS getDay() (Sunday=0, Monday=1, … Saturday=6 — the same convention the openGym state file uses). Also reports today\'s date and what routine applies today, accounting for one-off overrides the user may have set for a specific date (a "rest" override cancels the day).',
  schema: {},
  handler: () => {
    const { S, error } = stateOrError()
    if (error) return error
    const today = new Date()
    const isoToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
    const todayWd = today.getDay()
    return {
      today: isoToday,
      weekdays: [0, 1, 2, 3, 4, 5, 6].map(d => {
        // A weekday can now hold several routines at once ("combined day"); routine_id/name
        // report the first for backward-compatible display, routine_ids the whole list.
        const rids = [].concat(S.week?.[d] || [])
        const rid = rids[0] || null
        const r = rid ? (S.routines || []).find(x => x.id === rid) : null
        const overrideForToday = d === todayWd ? (S.dayPlan?.[isoToday] ?? null) : null
        return {
          weekday: d,
          weekday_name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d],
          routine_id: rid,
          routine_ids: rids,
          routine_name: r?.name || null,
          routine_emoji: r?.emoji || null,
          override_for_today_or_null: overrideForToday
        }
      }),
      today_routine_id: effectiveRoutineId(S, isoToday),
      today_routine_name: effectiveRoutine(S, isoToday)?.name || null
    }
  }
}

/** list_workouts — newest-first summary of recent sessions. */
export const listWorkouts = {
  name: 'list_workouts',
  description: 'List recent finished workouts, newest first. Each item summarises the date, exercise count, sets done / planned, total volume (in the user\'s unit), duration and whether PRs were set. Use this before drilling into a specific date with get_workout.',
  schema: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive start date YYYY-MM-DD. Defaults to no lower bound (list most recent).'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.'),
    limit: z.number().int().min(1).max(200).optional().describe('Max items to return. Defaults to 25.')
  },
  handler: ({ from, to, limit }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const lim = Math.min(Math.max(limit || 25, 1), 200)
    const all = (S.workouts || []).slice().sort((a, b) => (b.d || '').localeCompare(a.d || ''))
    const filtered = all.filter(w => {
      if (from && w.d < from) return false
      if (to && w.d > to) return false
      return true
    }).slice(0, lim)
    return {
      unit: S.unit || 'kg',
      total_count: all.length,
      returned_count: filtered.length,
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
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('The workout date as YYYY-MM-DD. If two sessions share that date, the answer lists them instead and asks for a workout_id.'),
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
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive start date YYYY-MM-DD.'),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Inclusive end date YYYY-MM-DD. Defaults to today.')
  },
  handler: ({ from, to }) => {
    const { S, error } = stateOrError()
    if (error) return error
    const goal = S.targetW || null
    const bw = (S.bodyweight || []).filter(b => {
      if (from && b.d < from) return false
      if (to && b.d > to) return false
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
    exercise_id: z.string().optional().describe('An exercise id from list_routines or get_workout entries. If omitted, returns a full PR table.'),
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
      return {
        exercise: { id: exercise_id, name: ex.n, body_part: ex.bp || null },
        formula: f,
        formula_note: `Estimates use the ${f} formula. Cap at ${REP_CAP} reps applies; r=1 is treated as the measurement, not an estimate.`,
        best: best ? { est: best.est, w: best.w, r: best.r, date: best.d } : null,
        no_estimate_reason: best ? null
          : trainedAtAll
            ? `This exercise has logged sets, but none of them qualify: every set was above the ${REP_CAP}-rep cap, or carried no weight. That is not the same as never having trained it.`
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
    const now = Date.now()
    const cutoff = period === 'week' ? now - 7 * 86400000
      : period === 'month' ? now - 30 * 86400000
        : Number.NEGATIVE_INFINITY
    const workouts = (S.workouts || []).filter(w => (w.start || new Date(w.d + 'T12:00:00').getTime()) >= cutoff)
    const load = loadOfCanonicalWorkouts(S, workouts)
    const { worked, missed } = rankOf(load)
    const levels = levelsOf(load)
    return {
      period,
      cutoff_iso: period === 'all' ? null : new Date(cutoff).toISOString().slice(0, 10),
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
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date the session would be started on, YYYY-MM-DD. Affects which routine is scheduled, any one-off day override, and which training references are visible. Defaults to today.')
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
    const built = buildSessionExposures(scratch, r, { now, newId: seed => seed, unit })

    const exercises = (r.ex || []).map((occ, i) => {
      const ex = exerciseOf(occ.exerciseId, S)
      const p = scratch.prescriptions[built[i].prescriptionId]
      const mode = modeOfExposure(occ.exerciseId, built[i])
      const configured = occ.rule.parameters
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
        opening_sets: p.rows.map(row => {
          const legacyRow = { r: row.reps.min, sec: p.prefill.durationSeconds ?? 0, min: 0, speed: 0, w: row.load?.value ?? 0 }
          return {
            role: 'work',
            role_label: setRoleLabel('work'),
            label: setLabel(occ.exerciseId, legacyRow, cfg),
            w: legacyRow.w, r: legacyRow.r, sec: legacyRow.sec
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
