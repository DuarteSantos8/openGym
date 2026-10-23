import {
  fmt, setLabel, exLine, muscleName, policyName, friendlyDuration, ratio, muscleOrder
} from '../../mcp/src/labels.js'
import {
  modeOf, workoutVolume, setsDone, effectiveRoutine, effectiveRoutineIds, lastEntryFor, workoutAt
} from '../../frontend/src/lib/history.js'
import { queueView, queueNext, pinState } from '../../frontend/src/lib/queue.js'
import { CATALOGUE, exOr, EXIDX } from '../../frontend/src/lib/exercises.js'
import { exAvailable } from '../../frontend/src/lib/equipment.js'
import { readFileSync } from 'node:fs'
import { baseLang } from '../../frontend/src/lib/i18n-core.js'
import { EXERCISE_NAME_LANGS } from '../../frontend/src/lib/catalogue-langs.js'
import { isWarmupRow, isFailureSet } from '../../frontend/src/lib/workout-model.js'
import { bestSetOf, best1RM, e1rmSeries, DEFAULT_FORMULA, REP_CAP } from '../../frontend/src/lib/onerm.js'
import { loadOfWorkouts, rankOf, levelsOf } from '../../frontend/src/lib/muscles.js'
import { policyFor } from '../../frontend/src/lib/progression.js'
import { buildSessionEntries, startsFromLast } from '../../frontend/src/lib/session-start.js'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const FORMULAS = new Set(['epley', 'brzycki', 'lombardi'])
const PERIODS = new Set(['week', 'month', 'all'])
const routineUrl = (origin, id) => `${origin}/#/plan/r/${encodeURIComponent(id)}`

const localIso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const todayIso = () => localIso(new Date())

function requireIso(value, optional) {
  if (value == null || value === '') {
    if (optional) return undefined
    throw new Error('invalid date')
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('invalid date')
  const d = new Date(value + 'T12:00:00')
  if (Number.isNaN(d.getTime()) || localIso(d) !== value) throw new Error('invalid date')
  return value
}

function requireId(value) {
  if (typeof value !== 'string' || !value) throw new Error('invalid id')
  return value
}

function optionalId(value) {
  if (value == null) return undefined
  return requireId(value)
}

// EXIDX is a plain object shared by the whole process. These ids would reach Object.prototype
// (or shadow what inherits from it) when used as keys, so a profile carrying one is refused.
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype'])

function customList(raw) {
  const list = (Array.isArray(raw) ? raw : []).filter(e => e && typeof e === 'object' && e.id != null)
  for (const e of list) {
    if (typeof e.id !== 'string' || !e.id || RESERVED_IDS.has(e.id)) throw new Error('invalid custom exercise id')
  }
  return list
}

function shape(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    ...s,
    routines: Array.isArray(s.routines) ? s.routines : [],
    workouts: Array.isArray(s.workouts) ? s.workouts : [],
    week: s.week && typeof s.week === 'object' && !Array.isArray(s.week) ? s.week : {},
    dayPlan: s.dayPlan && typeof s.dayPlan === 'object' && !Array.isArray(s.dayPlan) ? s.dayPlan : {},
    bodyweight: Array.isArray(s.bodyweight) ? s.bodyweight : [],
    customEx: customList(s.customEx),
  }
}

const customOf = (id, S) => S.customEx.find(ex => ex.id === id)
// exOr reads EXIDX[id] on a plain object, so 'toString' or 'constructor' would come back as an
// inherited function. Only an own entry counts as known; anything else is the unknown placeholder.
const exerciseOf = (id, S) => customOf(id, S) ||
  (typeof id === 'string' && Object.hasOwn(EXIDX, id) ? exOr(id) : { ...exOr(UNKNOWN_KEY), id })
const UNKNOWN_KEY = '\u0000unknown'

// The session builder reads each exercise's equipment from the shared EXIDX, so this profile's
// customs are put there for the length of one synchronous build and the previous own values are
// put back before returning: same values, same key order, nothing left behind, no await between.
// No registerCustom call: it tracks ids in module state and rebuilds from the catalogue, which
// cannot restore what a nested or failed call found there.
function withCustomsIndexed(S, build) {
  const saved = []
  try {
    for (const e of S.customEx) {
      if (!saved.some(s => s.id === e.id)) {
        const had = Object.hasOwn(EXIDX, e.id)
        saved.push({ id: e.id, had, desc: had ? Object.getOwnPropertyDescriptor(EXIDX, e.id) : null })
      }
      Object.defineProperty(EXIDX, e.id, { value: e, writable: true, enumerable: true, configurable: true })
    }
    return build()
  } finally {
    for (let i = saved.length - 1; i >= 0; i--) {
      const { id, had, desc } = saved[i]
      if (had) Object.defineProperty(EXIDX, id, desc)
      else delete EXIDX[id]
    }
  }
}

function scalarList(value, accept) {
  if (!Array.isArray(value) || !value.length) return undefined
  return value.filter(accept)
}

const finite = item => typeof item === 'number' && Number.isFinite(item)
const repTarget = item => finite(item) || item === 'max'

function plannedSets(w) {
  let n = 0
  for (const e of (w.entries || [])) n += (e.sets || []).length
  return n
}

function entryView(e, S) {
  const ex = exerciseOf(e.id, S)
  const cfg = { ...(e.target || {}), id: e.id }
  const mode = modeOf(cfg)
  return {
    id: e.id,
    name: nameOf(S, ex),
    body_part: ex.bp || null,
    ...(ex.missing ? { unknown: true } : {}),
    mode,
    sets: (e.sets || []).map(s => ({
      done: !!s.done,
      label: setLabel(e.id, { ...s, done: undefined }, cfg),
      ...(isFailureSet(s) ? { failure: true } : {}),
      w: Number(s.w) || 0,
      r: Number(s.r) || 0,
      sec: Number(s.sec) || 0,
      min: Number(s.min) || 0,
      speed: Number(s.speed) || 0
    }))
  }
}

function prTable(S, formula) {
  const byId = new Map()
  for (const w of S.workouts) {
    for (const e of (w.entries || [])) {
      const best = bestSetOf(e, formula)
      if (!best) continue
      const prev = byId.get(e.id)
      if (!prev || best.est > prev.est) {
        const ex = exerciseOf(e.id, S)
        byId.set(e.id, { exId: e.id, exName: nameOf(S, ex), bp: ex.bp || null, est: best.est, w: best.w, r: best.r, date: w.d })
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.est - a.est)
}

function sourceOf(S, cfg, plan, field, routine) {
  if (!plan || plan.kind === 'off') return 'routine_plan'
  const decided = plan.kind !== 'first' && plan[field] != null
  if (decided) return field !== 'weight' && plan[field] === cfg[field] ? 'routine_plan' : 'progression'
  const last = lastEntryFor(S, cfg.id, routine && routine.id)
  if (field === 'reps') return startsFromLast(S) && last ? 'last_session' : 'routine_plan'
  if (last) return 'last_session'
  const conf = (S.exWeights || {})[cfg.id]
  return conf && conf.w > 0 ? 'confirmed_weight' : 'routine_plan'
}

const SOURCE_TEXT = {
  progression: 'the progression policy overrode the routine',
  confirmed_weight: 'your confirmed working weight for this exercise',
  last_session: 'carried over from the last time this routine had this exercise (or any routine, if this one never has)',
  routine_plan: "the routine's own target"
}

const namePacks = new Map()
function namesFor(lang) {
  const base = baseLang(lang)
  if (base === 'en' || !EXERCISE_NAME_LANGS.includes(base)) return null
  if (!namePacks.has(base)) {
    const url = new URL(`../../frontend/src/exercise-names/${base}.js`, import.meta.url)
    try { namePacks.set(base, JSON.parse(readFileSync(url, 'utf8').replace(/^.*?export default /s, ''))) }
    catch { namePacks.set(base, null) }
  }
  return namePacks.get(base)
}

// Name packs are data, not a process-global language toggle. Custom exercises have no translated id.
function nameOf(S, ex) {
  const translated = S.names && !S.customEx.some(custom => custom.id === ex.id) && S.names[ex.id]
  return typeof translated === 'string' && translated ? translated : ex.n
}

function searchExercises(S, { query, limit = 20 } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 80 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('invalid exercise search')
  const needle = query.trim().toLocaleLowerCase(S.lang || 'en')
  const matches = [...CATALOGUE, ...S.customEx].filter(ex => ex && typeof ex.id === 'string' &&
    exAvailable(S, ex) && (nameOf(S, ex).toLocaleLowerCase(S.lang || 'en').includes(needle) || ex.n?.toLocaleLowerCase(S.lang || 'en').includes(needle)))
  return { unit: S.unit || 'kg', exercises: matches.slice(0, limit).map(ex => ({ id: ex.id, name: nameOf(S, ex), body_part: ex.bp || null, equipment: ex.eq || null })) }
}

function listRoutines(S) {
  return {
    unit: S.unit || 'kg',
    routines: S.routines.map(r => ({
      id: r.id,
      name: r.name,
      url: routineUrl(S.origin, r.id),
      emoji: r.emoji || null,
      exercise_count: (r.ex || []).length,
      superset_groups: [...new Set((r.ex || []).map(e => e.sg).filter(Boolean))].length || 0,
      policy: policyFor(null, r, 'reps'),
      exclude_from_progression: r.excludeFromProgression === true
    }))
  }
}

function getRoutine(S, { routine_id } = {}) {
  const id = requireId(routine_id)
  const r = S.routines.find(x => x.id === id)
  if (!r) { const e = new Error(`no routine with id ${JSON.stringify(id)}`); e.code = 'ENOENT'; throw e }
  const unit = S.unit || 'kg'
  return {
    id: r.id,
    name: r.name,
    url: routineUrl(S.origin, r.id),
    emoji: r.emoji || null,
    policy: policyFor(null, r, 'reps'),
    policy_name: policyName(policyFor(null, r, 'reps')),
    exclude_from_progression: r.excludeFromProgression === true,
    unit,
    exercises: (r.ex || []).map((cfg, i) => {
      const ex = exerciseOf(cfg.id, S)
      const mode = modeOf(cfg)
      return {
        position: i + 1,
        id: cfg.id,
        name: nameOf(S, ex),
        body_part: ex.bp || null,
        ...(ex.missing ? { unknown: true } : {}),
        mode,
        sets: cfg.sets || 1,
        reps: mode === 'reps' ? (cfg.reps || 0) : undefined,
        reps_min: mode === 'reps' && cfg.repsMin != null ? cfg.repsMin : undefined,
        reps_max: mode === 'reps' && cfg.repsMax != null ? cfg.repsMax : undefined,
        pyramid: mode === 'reps' ? scalarList(cfg.pyramid, repTarget) : undefined,
        pyramid_rest_sec: mode === 'reps' ? scalarList(cfg.pyramidRest, finite) : undefined,
        pyramid_weight: mode === 'reps' ? scalarList(cfg.pyramidWeight, finite) : undefined,
        sec: mode === 'time' ? (cfg.sec || 0) : undefined,
        min: mode === 'cardio' ? (cfg.min || 0) : undefined,
        speed: mode === 'cardio' ? (cfg.speed || 0) : undefined,
        weight: cfg.weight != null ? cfg.weight : undefined,
        increment: cfg.inc != null ? cfg.inc : undefined,
        deload_factor: cfg.deloadFactor != null ? cfg.deloadFactor : undefined,
        rest_sec: cfg.restSec > 0 ? cfg.restSec : undefined,
        policy: policyFor(cfg, r, mode),
        policy_override: cfg.prog || null,
        superset_group: cfg.sg || null,
        summary: exLine({ ...cfg, pyramid: scalarList(cfg.pyramid, repTarget) }, unit)
      }
    })
  }
}

function getWeek(S) {
  const today = new Date()
  const isoToday = localIso(today)
  const todayWd = today.getDay()
  const nameOf = id => S.routines.find(x => x.id === id)?.name || null
  const weekdayIds = d => [].concat(S.week[d] || []).filter(id => S.routines.some(x => x.id === id))
  const todayIds = effectiveRoutineIds(S, isoToday, isoToday)
  const view = queueView(S, isoToday)
  const plannedBy = (iso, ids) => {
    const ov = S.dayPlan[iso]
    if (ov === 'rest') return 'rest_override'
    const pin = pinState(S, ov)
    if (pin === 'open') return 'pinned'
    if (!pin && ov && S.routines.some(x => x.id === ov)) return 'override'
    if (ids.length && queueNext(S, iso, isoToday) === ids[0]) return 'coach'
    return ids.length ? 'weekday' : 'rest'
  }
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i, 12)
    const iso = localIso(d)
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
      sessions: view.items.map(i => ({ routine_id: i.id, routine_name: i.name, state: i.state, pinned_to: i.on ?? null }))
    } : null,
    days,
    weekdays: [0, 1, 2, 3, 4, 5, 6].map(d => {
      const ids = weekdayIds(d)
      return {
        weekday: d,
        weekday_name: DAY_NAMES[d],
        routine_ids: ids,
        routine_names: ids.map(nameOf),
        routine_id: ids[0] ?? null,
        routine_name: ids.length ? nameOf(ids[0]) : null,
        routine_emoji: ids.length ? (S.routines.find(x => x.id === ids[0])?.emoji || null) : null,
        override_for_today_or_null: d === todayWd && typeof S.dayPlan[isoToday] === 'string' ? S.dayPlan[isoToday] : null
      }
    })
  }
}

function listWorkouts(S, { from, to, limit } = {}) {
  const start = requireIso(from, true)
  const hi = requireIso(to, true) || todayIso()
  if (limit != null && (!Number.isInteger(limit) || limit < 1 || limit > 200)) throw new Error('invalid limit')
  const lim = limit || 25
  const all = S.workouts.slice().sort((a, b) => (b.d || '').localeCompare(a.d || ''))
  const matching = all.filter(w => !(start && w.d < start) && !(w.d > hi))
  const filtered = matching.slice(0, lim)
  return {
    unit: S.unit || 'kg',
    total_count: all.length,
    matching_count: matching.length,
    returned_count: filtered.length,
    truncated: filtered.length < matching.length,
    workouts: filtered.map(w => ({
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

function getWorkout(S, { date, workout_id } = {}) {
  const id = optionalId(workout_id)
  const day = requireIso(date, true)
  let w
  if (id) {
    w = S.workouts.find(x => x.id === id)
    if (!w) { const e = new Error(`no workout with id ${id}`); e.code = 'ENOENT'; throw e }
  } else if (day) {
    const sameDay = S.workouts.filter(x => x.d === day)
    if (!sameDay.length) { const e = new Error(`no workout on ${day}`); e.code = 'ENOENT'; throw e }
    if (sameDay.length > 1) {
      return {
        ambiguous: true,
        date: day,
        message: `${sameDay.length} workouts were logged on ${day} — call get_workout again with one of these workout_id values.`,
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
    prs: (w.prs || []).map(pid => {
      const ex = exerciseOf(pid, S)
      return ex.missing ? pid : nameOf(S, ex)
    }),
    entries: (w.entries || []).map(e => entryView(e, S))
  }
}

function getBodyweight(S, { from, to } = {}) {
  const start = requireIso(from, true)
  const hi = requireIso(to, true) || todayIso()
  const goal = S.targetW || null
  const bw = S.bodyweight.filter(b => !(start && b.d < start) && !(b.d > hi)).sort((a, b) => (a.d || '').localeCompare(b.d || ''))
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

function estimateOneRm(S, { exercise_id, formula } = {}) {
  const f = formula == null ? DEFAULT_FORMULA : formula
  if (!FORMULAS.has(f)) throw new Error('invalid formula')
  const exerciseId = optionalId(exercise_id)
  if (exerciseId) {
    const ex = exerciseOf(exerciseId, S)
    const best = best1RM(S, exerciseId, f)
    const series = e1rmSeries(S, exerciseId, f)
    const trainedAtAll = S.workouts.some(w =>
      (w.entries || []).some(e => e.id === exerciseId && (e.sets || []).some(s => s.done)))
    const unknown = !!ex.missing && !trainedAtAll
    return {
      exercise: { id: exerciseId, name: nameOf(S, ex), body_part: ex.bp || null, ...(unknown ? { unknown: true } : {}) },
      formula: f,
      formula_note: `Estimates use the ${f} formula. Cap at ${REP_CAP} reps applies; r=1 is treated as the measurement, not an estimate.`,
      best: best ? { est: best.est, w: best.w, r: best.r, date: best.d } : null,
      no_estimate_reason: best ? null
        : trainedAtAll
          ? `This exercise has logged sets, but none of them qualify: every set was above the ${REP_CAP}-rep cap, or carried no weight. That is not the same as never having trained it.`
          : unknown
            ? `No exercise with id ${JSON.stringify(exerciseId)} exists — not in the catalogue, not among this profile's custom exercises, and nothing is logged against it. Check the id against list_routines or a get_workout entry.`
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

function muscleBalance(S, { period } = {}) {
  if (!PERIODS.has(period)) throw new Error('invalid period')
  const now = new Date()
  const midnightDaysBack = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() - n).getTime()
  const cutoff = period === 'week' ? midnightDaysBack(6)
    : period === 'month' ? midnightDaysBack(29)
      : Number.NEGATIVE_INFINITY
  const workouts = S.workouts.filter(w => workoutAt(w) >= cutoff)
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
    cutoff_iso: period === 'all' ? null : localIso(new Date(cutoff)),
    workouts_in_period: workouts.length,
    worked: worked.map(slug => ({ slug, name: muscleName(slug), level: levels[slug], effective_sets: Math.round((load[slug] || 0) * 10) / 10 })),
    neglected: missed.map(slug => ({ slug, name: muscleName(slug) })),
    muscle_order_head_to_toe: muscleOrder()
  }
}

function previewSession(S, { routine_id, date } = {}) {
  const iso = requireIso(date, true) || todayIso()
  const id = optionalId(routine_id)
  let r
  if (id) {
    r = S.routines.find(x => x.id === id)
    if (!r) { const e = new Error(`no routine with id ${JSON.stringify(id)}`); e.code = 'ENOENT'; throw e }
  } else {
    r = effectiveRoutine(S, iso)
    if (!r) return { date: iso, routine_id: null, routine_name: null, rest_day: true, note: 'no routine is scheduled for this date (rest day)', exercises: [] }
  }
  const unit = S.unit || 'kg'
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
      name: nameOf(S, ex),
      ...(ex.missing ? { unknown: true } : {}),
      mode,
      policy: plan.policy,
      policy_name: policyName(plan.policy),
      planned: {
        sets: cfg.sets || 1,
        reps: mode === 'reps' ? (cfg.reps || 0) : undefined,
        sec: mode === 'time' ? (cfg.sec || 0) : undefined,
        min: mode === 'cardio' ? (cfg.min || 0) : undefined,
        weight: cfg.weight != null ? cfg.weight : undefined,
        summary: exLine({ ...cfg, pyramid: scalarList(cfg.pyramid, repTarget) }, unit)
      },
      prescription: {
        kind: plan.kind,
        weight: plan.weight != null ? plan.weight : undefined,
        reps: plan.reps != null ? plan.reps : undefined,
        sets: plan.sets != null ? plan.sets : undefined,
        row_reps: scalarList(plan.rowReps, finite),
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
    starts_from: startsFromLast(S) ? 'last_session' : 'plan',
    policy: policyFor(null, r, 'reps'),
    policy_name: policyName(policyFor(null, r, 'reps')),
    exercises,
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

export function createReadModel(profile, { origin = 'https://gym.areum.cl' } = {}) {
  const S = shape(structuredClone(profile))
  S.origin = origin
  S.names = namesFor(S.lang)
  return {
    listRoutines: () => listRoutines(S),
    searchExercises: args => searchExercises(S, args),
    getRoutine: args => getRoutine(S, args),
    getWeek: () => getWeek(S),
    listWorkouts: args => listWorkouts(S, args),
    getWorkout: args => getWorkout(S, args),
    getBodyweight: args => getBodyweight(S, args),
    estimateOneRm: args => estimateOneRm(S, args),
    muscleBalance: args => muscleBalance(S, args),
    previewSession: args => previewSession(S, args)
  }
}
