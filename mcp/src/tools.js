/* The eight read-only tools. Each handler returns JSON; labels.js pre-substitutes any
   {0}/{1} template the lib returns so the LLM gets final text, not template strings.
   ISO dates are validated on the way in; the handlers never see 'yesterday'. */
import { z } from 'zod'
import { getState, getUser } from './state.js'
import {
  fmt, setLabel, exLine, muscleName, policyName, friendlyDuration, ratio, muscleOrder
} from './labels.js'
import {
  modeOf, workoutVolume, setsDone, effectiveRoutine, effectiveRoutineIds, lastEntryFor
} from '../../frontend/src/lib/history.js'
import { queueView, queueNext, pinState } from '../../frontend/src/lib/queue.js'
import { exOr } from '../../frontend/src/lib/exercises.js'
import { isWarmupRow } from '../../frontend/src/lib/workout-model.js'
import {
  estimate1RM, best1RM, e1rmSeries, DEFAULT_FORMULA, REP_CAP
} from '../../frontend/src/lib/onerm.js'
import { loadOfWorkouts, rankOf, levelsOf } from '../../frontend/src/lib/muscles.js'
import { policyFor } from '../../frontend/src/lib/progression.js'
import { buildSessionEntries } from '../../frontend/src/lib/session-start.js'

/* ---------- helpers ---------- */

// A custom exercise lives in S.customEx and is merged into EXIDX by registerCustom() at
// store load (useStore.js:54). The MCP server deliberately never calls it: http.js serves
// several profiles from one process behind withRemoteState, so mutating the module-global
// index would leak one profile's customs into another's reads.
const customOf = (id, S) => (S.customEx || []).find(ex => ex.id === id)
// exOr's miss is a placeholder object, not null — callers that only need a name are fine
// with it, callers feeding muscle resolution are NOT. Use customOf directly there.
const exerciseOf = (id, S) => customOf(id, S) || exOr(id)

function entryView(e, S) {
  const ex = exerciseOf(e.id, S)
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
// Warm-ups are skipped for the same reason bestSetOf() skips them (onerm.js): a heavy ramp row is not a
// record. Without this the coach's PR and the athlete's PR silently disagree for the same exercise.
function prTable(S, formula) {
  const byId = new Map()
  for (const w of (S.workouts || [])) {
    for (const e of (w.entries || [])) {
      const ex = exerciseOf(e.id, S)
      for (const s of (e.sets || [])) {
        if (!s.done || isWarmupRow(s)) continue
        const est = estimate1RM(s.w, s.r, formula)
        if (est == null) continue
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
        policy: policyFor(null, r, 'reps'),
        exclude_from_progression: r.excludeFromProgression === true
      }))
    }
  }
}

/** get_routine — the full exercise list for one routine, including set/rep targets. */
export const getRoutine = {
  name: 'get_routine',
  description: 'Get the full exercise list for a single routine (the same view the routine editor shows). Returns mode (reps/time/cardio), set/rep/weight targets, superset links, any per-exercise custom increment or Epley deload factor, and each exercise\'s own rest in seconds (absent means it inherits the global rest timer). Use routine_id from list_routines.',
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
      policy: policyFor(null, r, 'reps'),
      policy_name: policyName(policyFor(null, r, 'reps')),
      exclude_from_progression: r.excludeFromProgression === true,
      unit: S.unit || 'kg',
      exercises: (r.ex || []).map((cfg, i) => {
        const ex = exerciseOf(cfg.id, S)
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
          reps_max: mode === 'reps' && cfg.repsMax != null ? cfg.repsMax : undefined,
          sec: mode === 'time' ? (cfg.sec || 0) : undefined,
          min: mode === 'cardio' ? (cfg.min || 0) : undefined,
          speed: mode === 'cardio' ? (cfg.speed || 0) : undefined,
          weight: cfg.weight != null ? cfg.weight : undefined,
          increment: cfg.inc != null ? cfg.inc : undefined,
          deload_factor: cfg.deloadFactor != null ? cfg.deloadFactor : undefined,
          // The exercise's own rest (issue #10). Absent means it inherits the global rest
          // timer; a superset rests once, taking the longest its members ask for.
          rest_sec: cfg.restSec > 0 ? cfg.restSec : undefined,
          policy: policyFor(cfg, r, mode),
          policy_override: cfg.prog || null,
          superset_group: cfg.sg || null,
          summary: exLine(cfg, S.unit || 'kg')
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
    const S = getState()
    if (!S) return noState()
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
      prs: (w.prs || []).map(id => {
        const ex = exerciseOf(id, S)
        return ex.missing ? id : ex.n
      }),
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
      const ex = exerciseOf(exercise_id, S)
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
    // loadOf() resolves each entry through EXIDX, which holds the catalogue only, so a
    // custom exercise's sets score zero here. Attaching the custom itself lets loadOf's own
    // `historical` branch resolve it. Only a *found* custom: exOr's miss placeholder carries
    // no muscle metadata and no muscleSnapshot, so attaching that would displace the entry
    // and silently zero a *deleted* custom, whose snapshot loadOf reads off the entry
    // (muscles.js:245 → metadataOf, snapshot written at sheets.jsx:421-426).
    const load = loadOfWorkouts(workouts.map(w => ({
      ...w,
      entries: (w.entries || []).map(e => {
        const c = e.exercise ? null : customOf(e.id, S)
        return c ? { ...e, exercise: c } : e
      })
    })))
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

// Where a number on the session screen actually came from. A routine's own sets/reps/weight
// are the LAST fallback, not the first: buildSets() prefers the confirmed working weight and
// the previous session's reps, and applyPrescription() then overwrites the weight with
// whatever the progression policy decided. Reporting the winner is the whole point of this
// tool — "the plan says 60" is not an answer to "what will the app show me".
function sourceOf(S, cfg, plan, field) {
  // Progression off (or a deload routine): the session is built from the routine's own target,
  // exactly as session-start.js does with useTarget — history and the confirmed weight are ignored.
  if (!plan || plan.kind === 'off') return 'routine_plan'
  const decided = plan.kind !== 'first' && plan[field] != null
  if (decided) return 'progression'
  if (field === 'weight') {
    const conf = (S.exWeights || {})[cfg.id]
    if (conf && conf.w > 0) return 'confirmed_weight'
  }
  return lastEntryFor(S, cfg.id) ? 'last_session' : 'routine_plan'
}

const SOURCE_TEXT = {
  progression: 'the progression policy overrode the routine',
  confirmed_weight: 'your confirmed working weight for this exercise',
  last_session: 'carried over from the last time you did this exercise',
  routine_plan: "the routine's own target"
}

/** preview_session — what starting this routine will actually put on screen. */
export const previewSession = {
  name: 'preview_session',
  description:
    'Preview the session a routine will actually open with — the numbers the user will see after the progression policy and their training history have overridden the routine\'s own targets. This is NOT the same as get_routine: a routine storing "squat 3x8 @ 60kg" can open at 75kg because the policy deloaded from the last logged session, and reps carry from history rather than from the plan. Always call this (not get_routine) before telling someone what weight they are about to lift, or before judging whether an edit to a routine had any effect. Returns, per exercise, the planned target, the policy\'s decision and its stated reason, the opening set rows, and where each number came from. Defaults to today\'s scheduled routine.',
  schema: {
    routine_id: z.string().min(1).optional().describe('Routine to preview. Defaults to the routine scheduled for `date`.'),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Date the session would be started on, YYYY-MM-DD. Affects which routine is scheduled and any one-off day override. Defaults to today.')
  },
  handler: ({ routine_id, date }) => {
    const S = getState()
    if (!S) return noState()
    const now = new Date()
    const iso = date || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'))

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
    // prescription, step, progression-off targets, deload routines and warm-up ramps all come from
    // there, so the preview cannot drift from what the screen shows.
    const built = buildSessionEntries(S, r)
    const exercises = (r.ex || []).map((cfg, i) => {
      const ex = exerciseOf(cfg.id, S)
      const mode = modeOf({ ...cfg, id: cfg.id })
      const plan = built[i].plan
      const rows = built[i].sets
      const work = rows.filter(s => !isWarmupRow(s))
      const openW = work.length ? (work[0].w || 0) : 0
      const openR = work.length ? (work[0].r || 0) : 0
      const openSec = work.length ? (work[0].sec || 0) : 0
      const openMin = work.length ? (work[0].min || 0) : 0
      const wSrc = sourceOf(S, cfg, plan, 'weight')
      const rSrc = sourceOf(S, cfg, plan, 'reps')
      return {
        position: i + 1,
        id: cfg.id,
        name: ex.n,
        mode,
        policy: plan.policy,
        policy_name: policyName(plan.policy),
        planned: {
          sets: cfg.sets || 1,
          reps: mode === 'reps' ? (cfg.reps || 0) : undefined,
          sec: mode === 'time' ? (cfg.sec || 0) : undefined,
          min: mode === 'cardio' ? (cfg.min || 0) : undefined,
          weight: cfg.weight != null ? cfg.weight : undefined,
          summary: exLine(cfg, unit)
        },
        prescription: {
          kind: plan.kind,
          weight: plan.weight != null ? plan.weight : undefined,
          reps: plan.reps != null ? plan.reps : undefined,
          sets: plan.sets != null ? plan.sets : undefined,
          sec: plan.sec != null ? plan.sec : undefined,
          why: plan.why ? fmt(plan.why[0], plan.why.slice(1)) : null
        },
        opening_sets: rows.map(s => ({
          phase: isWarmupRow(s) ? 'warmup' : 'work',
          type: s.type || 'straight',
          label: setLabel(cfg.id, { ...s, done: undefined }, { ...cfg, id: cfg.id }),
          w: Number(s.w) || 0,
          r: Number(s.r) || 0,
          sec: Number(s.sec) || 0,
          min: Number(s.min) || 0,
          speed: Number(s.speed) || 0
        })),
        weight_source: wSrc,
        weight_source_text: SOURCE_TEXT[wSrc],
        reps_source: mode === 'reps' ? rSrc : undefined,
        reps_source_text: mode === 'reps' ? SOURCE_TEXT[rSrc] : undefined,
        // The headline: did editing the routine change anything the user will see? Tracked per
        // dimension — a bodyweight exercise whose weight is 0 either way still counts when the
        // rep target moved, and saying which one moved saves the caller diffing it themselves.
        changed: [
          ...(mode === 'reps' && cfg.weight != null && openW !== cfg.weight ? ['weight'] : []),
          ...(mode === 'reps' && (cfg.reps || 0) > 0 && openR !== cfg.reps ? ['reps'] : []),
          ...(mode === 'time' && (cfg.sec || 0) > 0 && openSec !== cfg.sec ? ['sec'] : []),
          ...(mode === 'cardio' && (cfg.min || 0) > 0 && openMin !== cfg.min ? ['min'] : [])
        ],
        differs_from_plan:
          (mode === 'reps' && cfg.weight != null && openW !== cfg.weight) ||
          (mode === 'reps' && (cfg.reps || 0) > 0 && openR !== cfg.reps) ||
          (mode === 'time' && (cfg.sec || 0) > 0 && openSec !== cfg.sec) ||
          (mode === 'cardio' && (cfg.min || 0) > 0 && openMin !== cfg.min)
      }
    })

    const differing = exercises.filter(e => e.differs_from_plan)
    return {
      date: iso,
      routine_id: r.id,
      routine_name: r.name,
      unit,
      policy: policyFor(null, r, 'reps'),
      policy_name: policyName(policyFor(null, r, 'reps')),
      exercises,
      // Surfaced separately so a coach reading this cannot miss it: these are the exercises
      // where what the routine stores and what the athlete will see are two different numbers.
      overridden_count: differing.length,
      overridden: differing.map(e => ({
        name: e.name,
        planned_weight: e.planned.weight,
        opening_weight: e.opening_sets.filter(s => s.phase === 'work')[0]?.w ?? null,
        planned_reps: e.planned.reps,
        opening_reps: e.opening_sets.filter(s => s.phase === 'work')[0]?.r ?? null,
        planned_sec: e.planned.sec,
        opening_sec: e.opening_sets.filter(s => s.phase === 'work')[0]?.sec ?? null,
        planned_min: e.planned.min,
        opening_min: e.opening_sets.filter(s => s.phase === 'work')[0]?.min ?? null,
        changed: e.changed,
        reason: e.prescription.why || e.weight_source_text
      }))
    }
  }
}

/* ---------- registration list ---------- */

export const TOOLS = [
  listRoutines, getRoutine, previewSession, getWeekPlan, listWorkouts, getWorkout, getBodyweight, estimate1rm, muscleBalance
]

function noState() {
  return {
    error: 'no synced state yet — sign in at least once from a device so the openGym api can save a state file for this profile',
    unit: 'kg'
  }
}
