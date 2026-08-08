/* The eight read-only tools. Each handler returns JSON; labels.js pre-substitutes any
   {0}/{1} template the lib returns so the LLM gets final text, not template strings.
   ISO dates are validated on the way in; the handlers never see 'yesterday'. */
import { z } from 'zod'
import { getState, getUser } from './state.js'
import {
  setLabel, exLine, muscleName, policyName, friendlyDuration, ratio, muscleOrder
} from './labels.js'
import {
  modeOf, workoutVolume, setsDone, effectiveRoutineIds, effectiveRoutines
} from '../../frontend/src/lib/history.js'
import { EXIDX, exOr } from '../../frontend/src/lib/exercises.js'
import {
  estimate1RM, best1RM, e1rmSeries, DEFAULT_FORMULA, REP_CAP
} from '../../frontend/src/lib/onerm.js'
import { loadOfWorkouts, rankOf, levelsOf } from '../../frontend/src/lib/muscles.js'

/* ---------- helpers ---------- */

function entryView(e, S) {
  const ex = exOr(e.id)
  // Spread id into the cfg the way every call site in the app does (Workout.jsx, Stats.jsx,
  // progression.js) — the sheet saves a cardio target as {sets, min, speed} with no id and no
  // mode, so modeOf needs the id to fall through to isCardio(id).
  const cfg = { ...(e.target || {}), id: e.id }
  const mode = modeOf(cfg)
  return {
    id: e.id,
    name: ex.n,
    body_part: ex.bp || null,
    mode,
    target: e.target || null,
    sets: (e.sets || []).map(s => ({
      done: !!s.done,
      label: setLabel(e.id, { ...s, done: undefined }, cfg),
      w: Number(s.w) || 0,
      r: Number(s.r) || 0,
      sec: Number(s.sec) || 0,
      min: Number(s.min) || 0,
      speed: Number(s.speed) || 0
    }))
  }
}

// Best estimate per exercise, mirroring the UI's PR table: every eligible set across history, biggest wins.
function prTable(S, formula) {
  const byId = new Map()
  for (const w of (S.workouts || [])) {
    for (const e of (w.entries || [])) {
      for (const s of (e.sets || [])) {
        if (!s.done) continue
        const est = estimate1RM(s.w, s.r, formula)
        if (est == null) continue
        const ex = exOr(e.id)
        const prev = byId.get(e.id)
        if (!prev || est > prev.est) {
          // exId as well as exName: the consumer needs an id, not a name — exOr() treats any
          // string as both, so passing exName where exId belongs would silently "work" wrong.
          byId.set(e.id, { exId: e.id, exName: ex.n, bp: ex.bp || null, est, w: Number(s.w), r: Math.round(Number(s.r)), date: w.d })
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.est - a.est)
}

/* ---------- the 8 tools ---------- */

/** list_routines — names + counts of each routine in the user's plan. */
export const listRoutines = {
  name: 'list_routines',
  description: 'List the workout routines saved in the user\'s openGym profile (the same list the Plan screen shows). Each routine is a named set of exercises with set/rep targets. Use this to discover the plan structure before diving into a specific routine or today\'s workout.',
  schema: {},
  handler: () => {
    const S = getState()
    if (!S) return noState()
    return {
      unit: S.unit || 'kg',
      routines: (S.routines || []).map(r => ({
        id: r.id,
        name: r.name,
        emoji: r.emoji || null,
        exercise_count: (r.ex || []).length,
        superset_groups: [...new Set((r.ex || []).map(e => e.sg).filter(Boolean))].length || 0,
        policy: r.policy || 'off'
      }))
    }
  }
}

/** get_routine — the full exercise list for one routine, including set/rep targets. */
export const getRoutine = {
  name: 'get_routine',
  description: 'Get the full exercise list for a single routine (the same view the routine editor shows). Returns mode (reps/time/cardio), set/rep/weight targets, superset links, and any per-exercise custom increment you can override. Use routine_id from list_routines.',
  schema: { routine_id: z.string().min(1) },
  handler: ({ routine_id }) => {
    const S = getState()
    if (!S) return noState()
    const r = (S.routines || []).find(x => x.id === routine_id)
    if (!r) { const e = new Error(`no routine with id ${JSON.stringify(routine_id)}`); e.code = 'ENOENT'; throw e }
    return {
      id: r.id,
      name: r.name,
      emoji: r.emoji || null,
      policy: r.policy || 'off',
      policy_name: policyName(r.policy || 'off'),
      unit: S.unit || 'kg',
      exercises: (r.ex || []).map((cfg, i) => {
        const ex = exOr(cfg.id)
        const mode = modeOf(cfg)
        return {
          position: i + 1,
          id: cfg.id,
          name: ex.n,
          body_part: ex.bp || null,
          mode,
          sets: cfg.sets || 1,
          reps: mode === 'reps' ? (cfg.reps || 0) : undefined,
          reps_min: mode === 'reps' && cfg.repsMin != null ? cfg.repsMin : undefined,
          sec: mode === 'time' ? (cfg.sec || 0) : undefined,
          min: mode === 'cardio' ? (cfg.min || 0) : undefined,
          speed: mode === 'cardio' ? (cfg.speed || 0) : undefined,
          weight: cfg.weight != null ? cfg.weight : undefined,
          increment: cfg.inc != null ? cfg.inc : undefined,
          policy_override: cfg.policy || null,
          superset_group: cfg.sg || null,
          summary: exLine(cfg, S.unit || 'kg')
        }
      })
    }
  }
}

/** get_week_plan — what's scheduled each weekday + today. */
export const getWeekPlan = {
  name: 'get_week_plan',
  description: 'Show the user\'s weekly plan: which routine (if any) is assigned to each weekday, keyed by JS getDay() (Sunday=0, Monday=1, … Saturday=6 — the same convention the openGym state file uses). Also reports today\'s date and every routine that applies today, accounting for one-off overrides the user may have set for a specific date (a "rest" override cancels the day). Singular today_routine_id/name fields remain as the first routine for compatibility.',
  schema: {},
  handler: () => {
    const S = getState()
    if (!S) return noState()
    const today = new Date()
    const isoToday = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
    const todayWd = today.getDay()
    const todayRoutineIds = effectiveRoutineIds(S, isoToday)
    const todayRoutines = effectiveRoutines(S, isoToday)
    return {
      today: isoToday,
      weekdays: [0, 1, 2, 3, 4, 5, 6].map(d => {
        const rid = S.week?.[d] || null
        const r = rid ? (S.routines || []).find(x => x.id === rid) : null
        // Surface today's override only (not the whole dayPlan dict — usually empty, but might
        // have grown from repeated "move this day" actions).
        const overrideForToday = d === todayWd ? (S.dayPlan?.[isoToday] ?? null) : null
        return {
          weekday: d,
          weekday_name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d],
          routine_id: rid,
          routine_name: r?.name || null,
          routine_emoji: r?.emoji || null,
          override_for_today_or_null: overrideForToday
        }
      }),
      // Keep the original singular fields for existing MCP clients; the plural fields expose
      // every startable plan when a date has a multi-routine override.
      today_routine_ids: todayRoutineIds,
      today_routine_names: todayRoutines.map(r => r.name),
      today_routine_id: todayRoutineIds[0] || null,
      today_routine_name: todayRoutines[0]?.name || null
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
    const S = getState()
    if (!S) return noState()
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
        routine_id: w.routineId || null,
        routine_name: w.name || null,
        exercise_count: (w.entries || []).length,
        sets_done: setsDone(w),
        sets_planned: plannedSets(w),
        sets_ratio: ratio(setsDone(w), plannedSets(w)),
        volume: workoutVolume(w),
        duration_ms: w.end && w.start ? (w.end - w.start) : null,
        duration: w.end && w.start ? friendlyDuration(w.end - w.start) : null,
        prs: (w.prs || []).length,
        bodyweight_at_workout: w.bw || null
      }))
    }
  }
}

function plannedSets(w) {
  let n = 0
  ;(w.entries || []).forEach(e => { n += (e.sets || []).length })
  return n
}

/** get_workout — full entry/set breakdown for one date. */
export const getWorkout = {
  name: 'get_workout',
  description: 'Get the full breakdown of one workout: every exercise, its mode (reps/time/cardio), the target, and per-set labels (e.g. "5 @ 60 kg", "1:30 · 20 kg"). Identify it by workout_id (from list_workouts) or by date. Use list_workouts first if you don\'t know either.',
  schema: {
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('The workout date as YYYY-MM-DD. If two sessions share that date, the answer lists them instead and asks for a workout_id.'),
    workout_id: z.string().min(1).optional().describe('The id from list_workouts. Preferred: it names one session even on a day with two.')
  },
  handler: ({ date, workout_id }) => {
    const S = getState()
    if (!S) return noState()
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
            volume: workoutVolume(x),
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
      routine_id: w.routineId || null,
      routine_name: w.name || null,
      unit: S.unit || 'kg',
      bodyweight_at_workout: w.bw || null,
      volume: workoutVolume(w),
      sets_done: setsDone(w),
      sets_planned: plannedSets(w),
      duration: w.end && w.start ? friendlyDuration(w.end - w.start) : null,
      prs: (w.prs || []).map(id => EXIDX[id]?.n || id),
      entries: (w.entries || []).map(e => entryView(e, S))
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
    const S = getState()
    if (!S) return noState()
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
    const S = getState()
    if (!S) return noState()
    const f = formula || DEFAULT_FORMULA
    if (exercise_id) {
      const ex = exOr(exercise_id)
      const best = best1RM(S, exercise_id, f)
      const series = e1rmSeries(S, exercise_id, f)
      // A null best has two very different causes: never trained, or trained only above the
      // rep cap. Without saying which, an exercise logged for years at 15 reps reads as "no
      // records for calf raise" — a confident statement about the opposite of the truth.
      const trainedAtAll = (S.workouts || []).some(w =>
        (w.entries || []).some(e => e.id === exercise_id && (e.sets || []).some(s => s.done)))
      // w/r (not weight/reps) matches pr_table and entry-view — every set in the API surface uses the same couple.
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
    const S = getState()
    if (!S) return noState()
    const now = Date.now()
    const cutoff = period === 'week' ? now - 7 * 86400000
      : period === 'month' ? now - 30 * 86400000
        : Number.NEGATIVE_INFINITY
    const workouts = (S.workouts || []).filter(w => (w.start || new Date(w.d + 'T12:00:00').getTime()) >= cutoff)
    const load = loadOfWorkouts(workouts)
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

/* ---------- registration list ---------- */

export const TOOLS = [
  listRoutines, getRoutine, getWeekPlan, listWorkouts, getWorkout, getBodyweight, estimate1rm, muscleBalance
]

function noState() {
  return {
    error: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
    unit: 'kg'
  }
}
