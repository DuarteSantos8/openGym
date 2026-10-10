/* The eight read-only tools. Each handler returns JSON; labels.js pre-substitutes any
   {0}/{1} template the lib returns so the LLM gets final text, not template strings.
   ISO dates are validated on the way in; the handlers never see 'yesterday'. */
import { z } from 'zod'
import { getState, getUser } from './state.js'
import {
  fmt, setLabel, exLine, muscleName, policyName, friendlyDuration, ratio, muscleOrder
} from './labels.js'
import {
  modeOf, workoutVolume, setsDone, effectiveRoutine, effectiveRoutineIds, lastEntryFor, workoutAt
} from '../../frontend/src/lib/history.js'
import { queueView, queueNext, pinState } from '../../frontend/src/lib/queue.js'
import { exOr, registerCustom } from '../../frontend/src/lib/exercises.js'
import { isWarmupRow, isFailureSet } from '../../frontend/src/lib/workout-model.js'
import {
  bestSetOf, best1RM, e1rmSeries, DEFAULT_FORMULA, REP_CAP
} from '../../frontend/src/lib/onerm.js'
import { loadOfWorkouts, rankOf, levelsOf } from '../../frontend/src/lib/muscles.js'
import { policyFor } from '../../frontend/src/lib/progression.js'
import { buildSessionEntries, startsFromLast } from '../../frontend/src/lib/session-start.js'
import { t } from './i18n.js'

/* ---------- helpers ---------- */

// A 'YYYY-MM-DD' the calendar actually has. The regex alone let 2026-02-30 through, and
// new Date('2026-02-30T12:00:00') rolls over to March 2 — so preview_session answered for
// March 2 while echoing February 30 back as the date it had answered for. Round-trip the string
// through the same local-noon construction the handlers use and insist it comes back unchanged;
// as a zod refine that is a -32602 at the SDK boundary instead of a confident wrong answer.
const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const todayIso = () => localIso(new Date())
const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('date_format')).refine(
  v => { const d = new Date(v + 'T12:00:00'); return !Number.isNaN(d.getTime()) && localIso(d) === v },
  { message: t('invalid_date') }
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
      // Taken to failure (the app's "F"): RIR 0 for effort when nothing was rated by hand.
      ...(isFailureSet(s) ? { failure: true } : {}),
      w: Number(s.w) || 0,
      r: Number(s.r) || 0,
      sec: Number(s.sec) || 0,
      min: Number(s.min) || 0,
      speed: Number(s.speed) || 0
    }))
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
    for (const e of (w.entries || [])) {
      const best = bestSetOf(e, formula)
      if (!best) continue
      const prev = byId.get(e.id)
      if (!prev || best.est > prev.est) {
        const ex = exerciseOf(e.id, S)
        // exId as well as exName: the consumer needs an id, not a name — exOr() treats any
        // string as both, so passing exName where exId belongs would silently "work" wrong.
        byId.set(e.id, { exId: e.id, exName: ex.n, bp: ex.bp || null, est: best.est, w: best.w, r: best.r, date: w.d })
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.est - a.est)
}

/* ---------- the 8 tools ---------- */

/** list_routines — names + counts of each routine in the user's plan. */
export const listRoutines = {
  name: 'list_routines',
  description: t('tool_list_routines'),
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
  description: t('tool_get_routine'),
  schema: { routine_id: z.string().min(1) },
  handler: ({ routine_id }) => {
    const S = getState()
    if (!S) return noState()
    const r = (S.routines || []).find(x => x.id === routine_id)
    if (!r) { const e = new Error(t('no_routine', { id: JSON.stringify(routine_id) })); e.code = 'ENOENT'; throw e }
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
          // Pyramid sets: one rep target per set, in order; 'max' is as many reps as possible.
          pyramid: mode === 'reps' && Array.isArray(cfg.pyramid) && cfg.pyramid.length ? cfg.pyramid : undefined,
          // Each pyramid set's own rest in seconds, 0 meaning the exercise's rest.
          pyramid_rest_sec: mode === 'reps' && Array.isArray(cfg.pyramid) && cfg.pyramid.length && Array.isArray(cfg.pyramidRest) && cfg.pyramidRest.length ? cfg.pyramidRest : undefined,
          // Each pyramid set's own planned weight (#445), 0 meaning it starts from that set last time.
          pyramid_weight: mode === 'reps' && Array.isArray(cfg.pyramid) && cfg.pyramid.length && Array.isArray(cfg.pyramidWeight) && cfg.pyramidWeight.length ? cfg.pyramidWeight : undefined,
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
const DAY_NAMES = t('weekday_names')
export const getWeekPlan = {
  name: 'get_week_plan',
  description: t('tool_get_week_plan'),
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
  description: t('tool_list_workouts'),
  schema: {
    from: isoDate().optional().describe(t('arg_from_workouts')),
    to: isoDate().optional().describe(t('arg_to')),
    limit: z.number().int().min(1).max(200).optional().describe(t('arg_workout_limit'))
  },
  handler: ({ from, to, limit }) => {
    const S = getState()
    if (!S) return noState()
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
  description: t('tool_get_workout'),
  schema: {
    date: isoDate().optional().describe(t('arg_workout_date')),
    workout_id: z.string().min(1).optional().describe(t('arg_workout_id'))
  },
  handler: ({ date, workout_id }) => {
    const S = getState()
    if (!S) return noState()
    const workouts = S.workouts || []
    let w
    if (workout_id) {
      w = workouts.find(x => x.id === workout_id)
      if (!w) { const e = new Error(t('no_workout_id', { id: workout_id })); e.code = 'ENOENT'; throw e }
    } else if (date) {
      const sameDay = workouts.filter(x => x.d === date)
      if (!sameDay.length) { const e = new Error(t('no_workout_date', { date })); e.code = 'ENOENT'; throw e }
      // Answering with the first of two is how a question about the evening run gets the
      // morning's lifting numbers, stated with total confidence. Say there are two instead.
      if (sameDay.length > 1) {
        return {
          ambiguous: true,
          date,
          message: t('ambiguous_workouts', { count: sameDay.length, date }),
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
      const e = new Error(t('need_workout_selector')); e.code = 'EINVAL'; throw e
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
  description: t('tool_get_bodyweight'),
  schema: {
    from: isoDate().optional().describe(t('arg_from_bodyweight')),
    to: isoDate().optional().describe(t('arg_to'))
  },
  handler: ({ from, to }) => {
    const S = getState()
    if (!S) return noState()
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
  description: t('tool_estimate_1rm', { cap: REP_CAP }),
  schema: {
    // .min(1): an empty string is falsy, so it used to fall through to "no exercise_id given" and
    // answer a question about one exercise with the whole PR table.
    exercise_id: z.string().min(1).optional().describe(t('arg_estimate_exercise')),
    formula: z.enum(['epley', 'brzycki', 'lombardi']).optional().describe(t('arg_formula', { formula: DEFAULT_FORMULA }))
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
      // exOr's miss is a placeholder named "Unknown exercise", not null. A typo'd or made-up id
      // therefore came back as "No completed sets logged for this exercise" — a statement about
      // the athlete's training, when the truth is that no such exercise exists. A deleted custom
      // is unknown to the catalogue too, but it has logged sets, so it keeps the real answer.
      const unknown = !!ex.missing && !trainedAtAll
      // w/r (not weight/reps) matches pr_table and entry-view — every set in the API surface uses the same couple.
      return {
        exercise: { id: exercise_id, name: ex.n, body_part: ex.bp || null, ...(unknown ? { unknown: true } : {}) },
        formula: f,
        formula_note: t('estimate_note', { formula: f, cap: REP_CAP }),
        best: best ? { est: best.est, w: best.w, r: best.r, date: best.d } : null,
        no_estimate_reason: best ? null
          : trainedAtAll
            ? t('no_qualifying_sets', { cap: REP_CAP })
            : unknown
              ? t('unknown_exercise', { id: JSON.stringify(exercise_id) })
              : t('no_completed_sets'),
        trend: series.map(p => ({ date: p.d, est: p.y, w: p.w, r: p.r }))
      }
    }
    return {
      formula: f,
      formula_note: t('estimate_note', { formula: f, cap: REP_CAP }),
      pr_table: prTable(S, f)
    }
  }
}

/** muscle_balance — training distribution per muscle over a period (week/month/all). */
export const muscleBalance = {
  name: 'muscle_balance',
  description: t('tool_muscle_balance'),
  schema: {
    period: z.enum(['week', 'month', 'all']).describe(t('arg_period'))
  },
  handler: ({ period }) => {
    const S = getState()
    if (!S) return noState()
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

// Where a number on the session screen actually came from. A routine's own weight is the LAST
// fallback, not the first: buildSets() takes the weight of this routine's last session of the
// exercise (any routine's, when this one never trained it), then the confirmed working weight,
// and applyPrescription() then overwrites it with whatever the progression policy decided. The
// reps are the routine's own unless the profile starts planned sessions from the last session
// (startFrom 'last'), or a policy that moves reps moved them. Reporting the winner is the whole
// point of this tool — "the plan says 60" is not an answer to "what will the app show me".
function sourceOf(S, cfg, plan, field, routine) {
  // Progression off (or a deload routine): the session is built from the routine's own target,
  // exactly as session-start.js does with useTarget — history and the confirmed weight are ignored.
  if (!plan || plan.kind === 'off') return 'routine_plan'
  const decided = plan.kind !== 'first' && plan[field] != null
  // A policy that settles on the routine's own reps or hold — a restart after the plan was
  // edited, a bodyweight hold at the plan's count — is the plan speaking, not an override.
  if (decided) return field !== 'weight' && plan[field] === cfg[field] ? 'routine_plan' : 'progression'
  const last = lastEntryFor(S, cfg.id, routine && routine.id)
  if (field === 'reps') return startsFromLast(S) && last ? 'last_session' : 'routine_plan'
  if (last) return 'last_session'
  const conf = (S.exWeights || {})[cfg.id]
  return conf && conf.w > 0 ? 'confirmed_weight' : 'routine_plan'
}

const SOURCE_TEXT = Object.fromEntries(['progression', 'confirmed_weight', 'last_session', 'routine_plan'].map(key => [key, t(`source_${key}`)]))

/** preview_session — what starting this routine will actually put on screen. */
export const previewSession = {
  name: 'preview_session',
  description: t('tool_preview_session'),
  schema: {
    routine_id: z.string().min(1).optional().describe(t('arg_preview_routine')),
    date: isoDate().optional().describe(t('arg_preview_date'))
  },
  handler: ({ routine_id, date }) => {
    const S = getState()
    if (!S) return noState()
    const now = new Date()
    const iso = date || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'))

    let r
    if (routine_id) {
      r = (S.routines || []).find(x => x.id === routine_id)
      if (!r) { const e = new Error(t('no_routine', { id: JSON.stringify(routine_id) })); e.code = 'ENOENT'; throw e }
    } else {
      r = effectiveRoutine(S, iso)
      if (!r) return { date: iso, routine_id: null, routine_name: null, rest_day: true, note: t('no_routine_scheduled'), exercises: [] }
    }

    const unit = S.unit || 'kg'
    // The same builder the app starts a session with (sheets.jsx beginWorkout → session-start.js):
    // prescription, step, progression-off targets, deload routines and warm-up ramps all come from
    // there, so the preview cannot drift from what the screen shows.
    const built = withCustomsIndexed(S, () => buildSessionEntries(S, r))
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
      const wSrc = sourceOf(S, cfg, plan, 'weight', r)
      const rSrc = sourceOf(S, cfg, plan, 'reps', r)
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
          // Triple progression aims each set on its own ("12, 12, 12, 9"); `reps` is the first set's.
          row_reps: Array.isArray(plan.rowReps) ? plan.rowReps : undefined,
          sec: plan.sec != null ? plan.sec : undefined,
          why: plan.why ? fmt(plan.why[0], plan.why.slice(1)) : null
        },
        opening_sets: rows.map(s => ({
          phase: isWarmupRow(s) ? 'warmup' : 'work',
          type: s.type || 'straight',
          ...(isFailureSet(s) ? { failure: true } : {}),
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
      // The profile's "Planned sessions start from" setting: 'plan' opens at the routine's own
      // reps, 'last_session' carries them over from the last time.
      starts_from: startsFromLast(S) ? 'last_session' : 'plan',
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
    error: t('no_state'),
    unit: 'kg'
  }
}
