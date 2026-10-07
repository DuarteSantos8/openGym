// Benjamin's coaching layer. Pure functions only: it reads the existing workout log and never
// mutates history.
//
// The workout engine (lib/progression.js) stays the source of truth for what happens next:
// recommendations translate its prescriptions into plain guidance instead of running a
// parallel heuristic, so the Home hint and the session you actually open can never disagree.
// On top of the engine this layer adds the cross-exercise signals the engine does not keep —
// stalling runs, skipped movements, equipment mismatches, alternatives and session-length
// variants — all derived from the same completed sets, and all silent when the evidence is
// thin rather than inventing progress from it.
import { entriesForExercise, metricEntriesForExercise, bestWeightForEntry, completedRepsOf, modeOf, streakWeeks } from './history.js'
import { sessionsFor, stallCount, nextPrescription, policyFor } from './progression.js'
import { betterWeight, EXIDX, exOr, allExercises, isBodyweightEq, isCardio, isAssisted } from './exercises.js'
import { muscleGroupsOf } from './muscles.js'
import { activeProfile, exAvailable } from './equipment.js'
import { isWarmupRow, isSideSet } from './workout-model.js'
import { weeklyWeights } from './bodyweight.js'
import { weekStartOf, weekKey, todayISO, exerciseNameText, isoOf } from './format.js'
import { fatigueOf, strengthOf, fatiguedMuscles, detrainedMuscles, STRENGTH_FLOOR } from './recovery.js'
import { MUSCLES } from './muscles.js'

const startOf = w => Number.isFinite(w?.start) ? w.start : new Date((w?.d || '') + 'T12:00:00').getTime()

const exName = id => (EXIDX[id] ? exerciseNameText(EXIDX[id]) : (exOr(id).n || id))

function targetFor(routine, exId) {
  const x = routine?.ex?.find(e => e?.id === exId)
  return x || null
}

// The engine's [template, ...args] explanation as a plain sentence. Reasons are informational
// (the UI translates labels, not sentences); the numbers stay exact, as logged.
function fillWhy(why) {
  if (!Array.isArray(why) || !why.length) return ''
  return String(why[0]).replace(/\{(\d+)\}/g, (_, i) => (why[+i + 1] ?? ''))
}

// Recorded effort behind the verdict, when there is enough of it to mean something: at least
// two rated sets. Stays on the RIR scale it was logged in, rounded to a logged step — never
// more precise than the taps behind it.
function rirNote(last) {
  const e = last?.effort
  if (!e || e.avg == null || e.rated < 2) return ''
  return ` (avg RIR ${Math.round(e.avg * 2) / 2}).`
}

// The concrete numbers behind a prescription, for the UI to print next to the label.
function nextOf(p) {
  if (!p || p.kind === 'first' || p.kind === 'off') return null
  const out = {}
  for (const k of ['weight', 'reps', 'sets', 'sec']) if (p[k] != null) out[k] = p[k]
  return Object.keys(out).length ? out : null
}

function progressLabel(p, target) {
  if (p.sec != null) return 'Add time'
  if (p.sets != null) return 'Add a set'
  if (isAssisted(target)) return 'Use less help'
  if (p.weight > 0) return 'Increase slightly'
  return 'Make it harder'
}

function translatePrescription(p, last, target) {
  const next = nextOf(p)
  switch (p.kind) {
    case 'first':
      return { status: 'baseline', label: 'Build a baseline', reason: 'Log this exercise once before changing the target.', next: null }
    case 'off':
      return { status: 'repeat', label: 'Repeat the target', reason: 'Automatic progression is off for this exercise — follow the plan.', next: null }
    case 'up': {
      const label = progressLabel(p, target)
      return { status: 'progress', label, reason: fillWhy(p.why) + rirNote(last), next }
    }
    case 'deload':
      return { status: 'regress', label: 'Repeat or reduce', reason: fillWhy(p.why) + rirNote(last), next }
    case 'hold':
    default:
      return { status: 'repeat', label: 'Repeat the target', reason: fillWhy(p.why) + rirNote(last), next }
  }
}

export function recommendationFor(S, routine, exId) {
  const target = targetFor(routine, exId)
  if (!target) return { status: 'baseline', label: 'Build a baseline', reason: 'Log this exercise once before changing the target.', next: null }
  const mode = modeOf(target)
  const sessions = sessionsFor(S, target.id, target, routine?.id).filter(s => s.mode === mode)
  // No completed session on this line yet — not even a no-progression exercise has a
  // target to repeat. (The engine answers 'off' before it looks at history.)
  if (!sessions.length) return { status: 'baseline', label: 'Build a baseline', reason: 'Log this exercise once before changing the target.', next: null }
  // The verdict is the engine's (nextPrescription reads completed reps, load, the plan the
  // last session was built from, and recorded effort); this layer only words it.
  const p = nextPrescription(S, target, routine)
  return translatePrescription(p, sessions.at(-1), target)
}

export function routineCoaching(S, routine, limit = 3) {
  return (routine?.ex || [])
    .map(e => ({ id: e.id, name: exName(e.id), target: e, recommendation: recommendationFor(S, routine, e.id) }))
    .slice(0, limit)
}

// Flag a run at two straight misses: the engine deloads at three, so this is the early,
// still-cheap moment to notice — repeat once more, then back off.
export const STALL_FLAG = 2
// Skipped means trained before, but nothing completed in the window while training happened:
// at least this many workouts logged in the last this many days.
export const ATTENTION_WINDOW_DAYS = 30
export const ATTENTION_MIN_WORKOUTS = 2

function countDoneIn(S, exId, cutoff) {
  let n = 0
  for (const w of S?.workouts || []) {
    if (!w?.d || w.d < cutoff) continue
    for (const e of entriesForExercise(w, exId)) {
      for (const s of e?.sets || []) {
        if (isWarmupRow(s)) continue
        if (isSideSet(s)) { if (s.sides?.L?.done === true || s.sides?.R?.done === true) n++ }
        else if (s?.done === true) n++
      }
    }
  }
  return n
}

// Exercises in a routine that deserve a look, each with the evidence for why. At most one
// flag per exercise, most actionable first: a movement planned around unavailable equipment
// explains a stall, so equipment is checked before performance, and a stalling run explains
// itself, so it wins over the skipped check. Strength (reps-mode) work only — holds and
// cardio progress by fixed steps and carry no stall signal.
export function exerciseAttention(S, routine, opts = {}) {
  const out = []
  const windowDays = opts.windowDays ?? ATTENTION_WINDOW_DAYS
  const minWorkouts = opts.minWorkouts ?? ATTENTION_MIN_WORKOUTS
  const cutoff = isoOf(new Date(Date.now() - windowDays * 86400000))
  const recent = (S?.workouts || []).filter(w => w?.d && w.d >= cutoff)
  const profile = activeProfile(S)
  for (const cfg of routine?.ex || []) {
    if (!cfg?.id || modeOf(cfg) !== 'reps') continue
    const name = exName(cfg.id)
    if (profile && !exAvailable(S, exOr(cfg.id))) {
      out.push({ id: cfg.id, name, kind: 'equipment', eq: exOr(cfg.id).eq || null })
      continue
    }
    const sessions = sessionsFor(S, cfg.id, cfg, routine?.id).filter(s => s.mode === 'reps')
    const stalls = stallCount(sessions, policyFor(cfg, routine, 'reps'))
    if (stalls >= STALL_FLAG) {
      out.push({ id: cfg.id, name, kind: 'stalling', stalls, sessions: sessions.length })
      continue
    }
    if (sessions.length > 0 && recent.length >= minWorkouts && countDoneIn(S, cfg.id, cutoff) === 0) {
      out.push({ id: cfg.id, name, kind: 'skipped', sessions: sessions.length, workouts: recent.length, days: windowDays })
    }
  }
  return out
}

// Sensible replacements for one exercise: same primary muscle, never itself, never across
// the cardio/strength line. Ranked for a home setup — usable with the active equipment
// profile first, then bodyweight (needs nothing), then the same equipment as the original —
// in catalogue order within each tier, so the list is stable. Applied through the existing
// Replace/Swap flows; nothing here edits the plan.
export function alternativesFor(S, exId, { count = 3 } = {}) {
  const src = exOr(exId)
  if (!src || src.missing) return []
  const groups = muscleGroupsOf(src)
  const primary = groups[0]
  if (!primary) return []
  const srcCardio = isCardio(src)
  const srcEq = src.eq || null
  const ranked = []
  for (const c of allExercises(S)) {
    if (!c || c.id === exId || c.missing) continue
    if (isCardio(c) !== srcCardio) continue
    const g = muscleGroupsOf(c)
    if (!g.includes(primary)) continue
    ranked.push({
      id: c.id,
      name: exName(c.id),
      eq: c.eq || null,
      bodyweight: isBodyweightEq(c),
      available: exAvailable(S, c),
      sameEq: !!(srcEq && c.eq === srcEq),
      shared: g.filter(x => groups.includes(x)).length,
    })
  }
  ranked.sort((a, b) =>
    (b.available - a.available) || (b.bodyweight - a.bodyweight) ||
    (b.sameEq - a.sameEq) || (b.shared - a.shared) || 0)
  return ranked.slice(0, Math.max(0, count))
    .map(({ id, name, eq, bodyweight, available }) => ({ id, name, eq, bodyweight, available }))
}

// How long the routine usually takes its owner: the median of its own logged durations.
// Needs two timed sessions; with fewer there is no estimate rather than a guessed one. A
// short session keeps the routine's name, so it joins this pool once logged.
function routineMinutes(S, routine) {
  if (!routine?.id) return null
  const ds = []
  for (const w of S?.workouts || []) {
    const ids = [].concat(w?.routineIds ?? [])
    if (!ids.includes(routine.id) && w?.name !== routine.name) continue
    if (!(w.end > w.start)) continue
    ds.push(Math.round((w.end - w.start) / 60000))
  }
  if (ds.length < 2) return null
  ds.sort((a, b) => a - b)
  return ds[Math.floor(ds.length / 2)]
}

// Short, normal and longer variants of one routine. Short keeps one movement per primary
// muscle group — the important work first — preferring the best-evidenced movement in each
// group, in routine order, about three-fifths of the exercises; routines of three exercises
// or fewer are already short. Longer combines with one other routine through the existing
// combine mechanism (lib/session-merge.js), preferring what the week already schedules.
export function sessionVariants(routine, S) {
  const ex = (routine?.ex || []).filter(e => e?.id)
  const setsOf = list => list.reduce((n, e) => n + Math.max(1, e?.sets || 1), 0)
  const full = { key: 'full', exerciseIds: ex.map(e => e.id), sets: setsOf(ex), minutes: routineMinutes(S, routine) }
  let short = null
  if (ex.length > 3) {
    const target = Math.max(2, Math.min(4, Math.ceil(ex.length * 0.6)))
    // Cover the routine's muscle groups first: within each primary group keep the movement
    // with the most completed sessions (routine order breaks ties), then rank the groups
    // the same way and take the top `target`. Picking by raw count alone would let a
    // well-trained group crowd out a whole body region — the short session would skip
    // the important work rather than shorten it.
    const byGroup = new Map()
    ex.forEach((e, i) => {
      const key = muscleGroupsOf(EXIDX[e.id] || e)[0] ?? 'id:' + e.id
      const done = sessionsFor(S, e.id, e, routine?.id).length
      const cur = byGroup.get(key)
      if (!cur || done > cur.done || (done === cur.done && i < cur.i)) byGroup.set(key, { e, i, done })
    })
    const kept = [...byGroup.values()]
      .sort((a, b) => b.done - a.done || a.i - b.i)
      .slice(0, target)
      .sort((a, b) => a.i - b.i)
      .map(x => x.e)
    const shortSets = setsOf(kept)
    short = {
      key: 'short',
      exerciseIds: kept.map(e => e.id),
      sets: shortSets,
      minutes: full.minutes != null && full.sets > 0
        ? Math.max(5, Math.round(full.minutes * shortSets / full.sets / 5) * 5)
        : null,
    }
  }
  return { short, full, longer: longerVariant(S, routine, setsOf) }
}

function longerVariant(S, routine, setsOf) {
  const others = (S?.routines || []).filter(r => r?.id && r.id !== routine?.id && (r.ex || []).length)
  if (!others.length) return null
  const scheduled = new Set(Object.values(S?.week || {}).flatMap(ids => [].concat(ids ?? [])))
  const ranked = [...others].sort((a, b) =>
    ((scheduled.has(b.id) ? 1 : 0) - (scheduled.has(a.id) ? 1 : 0)) || (setsOf(b.ex) - setsOf(a.ex)))
  const pick = ranked[0]
  return { key: 'longer', routineIds: [routine?.id, pick.id].filter(Boolean), name: pick.name, sets: setsOf(routine?.ex || []) + setsOf(pick.ex) }
}

export function bodyweightTrend(S) {
  const weeks = weeklyWeights(S?.bodyweight || [], weekStartOf(S))
  if (weeks.length < 2) return { status: 'baseline', delta: null, weeks, rate: null, weeksUsed: weeks.length, noise: null, meaningful: false }
  const delta = weeks[0].avg - weeks[1].avg
  if (weeks.length === 2) {
    const status = delta < -0.15 ? 'down' : delta > 0.15 ? 'up' : 'steady'
    return { status, delta, weeks, rate: delta, weeksUsed: 2, noise: null, meaningful: status !== 'steady' }
  }
  // Three or more logged weeks: fit the slope over the latest four so one salty evening
  // cannot flip the verdict. `rate` is unit/week (x = 0 at the latest week); `noise` is the
  // mean miss of the weekly averages against that line — the scale day-to-day fluctuation
  // lives on. A trend only counts as meaningful when the fitted change clears both a floor
  // (0.3) and twice that noise.
  const fit = weeks.slice(0, 4)
  const n = fit.length
  const xs = fit.map((_, i) => -i)
  const ys = fit.map(w => w.avg)
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  const rate = den > 0 ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : 0
  const noise = ys.reduce((a, y, i) => a + Math.abs(y - (my + rate * (xs[i] - mx))), 0) / n
  const status = rate < -0.15 ? 'down' : rate > 0.15 ? 'up' : 'steady'
  const meaningful = status !== 'steady' && Math.abs(rate) * (n - 1) >= Math.max(0.3, 2 * noise)
  return { status, delta, weeks, rate, weeksUsed: n, noise, meaningful }
}

// Where the weight trend points relative to intent: toward a set goal, or — with no goal
// set — toward the profile's standing intent, fat loss (see ben-profile.js). 'flat' covers
// steady and within-noise movement alike; only the review decides whether that matters.
export function weightDirection(S, trend) {
  if (!trend || trend.status === 'baseline' || trend.delta == null) return 'unknown'
  const latestAvg = trend.weeks?.[0]?.avg
  if (S?.targetW > 0 && latestAvg != null) {
    if (Math.abs(latestAvg - S.targetW) < 0.05) return 'at-goal'
    const toward = (latestAvg > S.targetW && trend.status === 'down') || (latestAvg < S.targetW && trend.status === 'up')
    return toward ? 'toward' : trend.status === 'steady' ? 'flat' : 'away'
  }
  if (trend.status === 'steady') return 'flat'
  return trend.status === 'down' ? 'toward' : 'away'
}

// Strength retention is deliberately conservative. It compares exercise-level bests between
// two windows, but only exercises present in both windows count. A small drop is treated as
// noise rather than declaring strength loss.
export function strengthRetention(S, days = 30) {
  const now = Date.now()
  const recent = new Map()
  const previous = new Map()

  const record = (map, id, value, metric) => {
    if (!(value > 0)) return
    const old = map.get(id)
    if (!old || (metric === 'load' ? betterWeight(id, old.value, value) : value > old.value)) {
      map.set(id, { value, metric })
    }
  }

  for (const w of S?.workouts || []) {
    const age = (now - startOf(w)) / 86400000
    if (age < 0 || age > days * 2) continue

    for (const e of w.entries || []) {
      const items = metricEntriesForExercise(w, e.id).filter(x => x.mode === 'reps')
      if (!items.length) continue

      const weighted = items.some(x => bestWeightForEntry(x.entry) > 0)
      const map = age <= days ? recent : previous

      if (weighted) {
        const value = items.reduce((best, item) => {
          const candidate = bestWeightForEntry(item.entry)
          return candidate > 0 && (best === 0 || betterWeight(e.id, best, candidate)) ? candidate : best
        }, 0)
        record(map, e.id, value, 'load')
      } else {
        const value = Math.max(0, ...items.flatMap(x => x.rows).map(completedRepsOf))
        record(map, e.id, value, 'reps')
      }
    }
  }

  const comparisons = []
  for (const [id, current] of recent) {
    const old = previous.get(id)
    if (!old || old.metric !== current.metric || !(old.value > 0)) continue

    // Assisted movements are unusual: less assistance is better, so invert the ratio.
    const assisted = EXIDX[id]?.assisted === true
    const ratio = assisted ? old.value / current.value : current.value / old.value
    comparisons.push({ id, ratio, metric: current.metric })
  }

  if (comparisons.length < 2) {
    return { status: 'baseline', compared: comparisons.length, holding: null, comparisons }
  }

  const holding = comparisons.filter(x => x.ratio >= 0.95).length / comparisons.length
  return {
    status: holding >= 0.7 ? 'holding' : holding >= 0.5 ? 'mixed' : 'attention',
    compared: comparisons.length,
    holding,
    // Direction counts for the review: clearly up (>2%, past noise) vs down with the
    // holding boundary (<0.95). Between them is maintenance, which is the goal while
    // losing fat — neither progress to celebrate nor loss to chase.
    improved: comparisons.filter(x => x.ratio > 1.02).length,
    declined: comparisons.filter(x => x.ratio < 0.95).length,
    comparisons,
  }
}

// Training consistency over the last four weeks: completed workouts against the plan's own
// scheduled days. Overrides for single days are ignored — over a month the pattern matters,
// not any one reschedule. No scheduled days means no plan to keep, not a failure.
export const CONSISTENCY_DAYS = 28
export function consistency(S, opts = {}) {
  const days = opts.days ?? CONSISTENCY_DAYS
  const cutoff = isoOf(new Date(Date.now() - days * 86400000))
  const done = (S?.workouts || []).filter(w => w?.d && w.d >= cutoff).length
  const perWeek = Object.values(S?.week || {}).filter(ids => [].concat(ids ?? []).length).length
  const expected = perWeek * days / 7
  const rate = expected > 0 ? done / expected : null
  return {
    done, expected: Math.round(expected * 10) / 10, rate,
    streak: streakWeeks(S),
    status: expected <= 0 ? 'baseline' : rate >= 1 ? 'on-track' : rate >= 0.5 ? 'close' : 'behind',
  }
}

// Records the engine awarded in the window (w.prs is written once, at finish, against the
// all-time best) — the review's "notable improvements" straight from the source of truth.
function recentPRs(S, days) {
  const cutoff = isoOf(new Date(Date.now() - days * 86400000))
  const seen = new Set()
  const out = []
  for (const w of S?.workouts || []) {
    if (!w?.d || w.d < cutoff) continue
    for (const id of w.prs || []) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ id, name: exName(id) })
    }
  }
  return out
}

function allAttention(S) {
  const seen = new Set()
  const out = []
  for (const r of S?.routines || []) {
    for (const a of exerciseAttention(S, r)) {
      const key = a.id + ':' + a.kind
      if (seen.has(key)) continue
      seen.add(key)
      out.push(a)
    }
  }
  return out
}

// One clear recommendation for the coming week, first match wins — in the order the levers
// actually work: no training, no progress to judge, so consistency outranks everything past
// setup; a concrete stalling or missing movement outranks a slow-moving scale; the scale
// outranks strength noise only when the trend is meaningful.
function decideRecommendation(S, r) {
  const routines = S?.routines || []
  if (!routines.length) return { kind: 'setup', why: ['No plan yet — build the weekly routine in Plan, then log the first session.'] }
  const scheduled = Object.values(S?.week || {}).filter(ids => [].concat(ids ?? []).length).length
  if (!scheduled) return { kind: 'setup', why: ['Nothing is scheduled — put the routines on training days in Plan.'] }
  if (!(S?.workouts || []).length) return { kind: 'start', why: ['Log the first session to start the history.'] }
  if (r.consistency.status === 'behind') {
    return { kind: 'consistency', why: ['Training ran at {0}% of plan over the last 4 weeks — start the next planned session.', Math.round(r.consistency.rate * 100)] }
  }
  const [top] = r.attention
  if (top) {
    if (top.kind === 'stalling') {
      const alt = alternativesFor(S, top.id, { count: 1 })[0]
      return alt
        ? { kind: 'attention', exerciseId: top.id, why: ['{0} missed the target {1} sessions running — repeat it at the same load, or swap in {2}.', top.name, top.stalls, alt.name] }
        : { kind: 'attention', exerciseId: top.id, why: ['{0} missed the target {1} sessions running — repeat it at the same load.', top.name, top.stalls] }
    }
    if (top.kind === 'skipped') return { kind: 'attention', exerciseId: top.id, why: ['{0} has no completed sets in the last {1} days — train it next session or replace it.', top.name, top.days] }
    return { kind: 'attention', exerciseId: top.id, why: ['{0} needs {1}, which is not in the active equipment profile — swap it or update the profile.', top.name, top.eq] }
  }
  if (r.bodyweight.direction === 'away' && r.bodyweight.meaningful) {
    const signed = (r.bodyweight.rate > 0 ? '+' : '') + (Math.round(r.bodyweight.rate * 10) / 10)
    return { kind: 'weight', why: ['Weight is working against the goal ({0} {1}/week over {2} weeks) — review training consistency and intake.', signed, S.unit, r.bodyweight.weeksUsed] }
  }
  if (r.strength.status === 'attention') {
    return { kind: 'strength', why: ['Strength is down in {0} of {1} compared exercises — repeat current loads and recover before pushing further.', r.strength.declined, r.strength.compared] }
  }
  return { kind: 'progress', why: ['On track — the next raises are already in the session targets.'] }
}

// The weekly review: training completed, bodyweight trend, strength trend, notable
// improvements, anything needing attention, and one recommendation for the coming week.
// Training covers the current week-to-date; trends and records read the trailing windows
// behind them. Every number names its evidence; thin evidence reads as baseline, never as
// a verdict.
export function weeklyReview(S) {
  const ws = weekStartOf(S)
  const wk = weekKey(todayISO(), ws)
  const weekWorkouts = (S?.workouts || []).filter(w => w?.d && weekKey(w.d, ws) === wk)
  const planned = Object.values(S?.week || {}).filter(ids => [].concat(ids ?? []).length).length
  const training = {
    done: weekWorkouts.length, planned, extra: Math.max(0, weekWorkouts.length - planned),
    status: planned <= 0 ? 'baseline' : weekWorkouts.length >= planned ? 'complete' : 'open',
  }
  const bw = bodyweightTrend(S)
  const bodyweight = {
    status: bw.status, delta: bw.delta, rate: bw.rate, weeksUsed: bw.weeksUsed,
    noise: bw.noise, meaningful: bw.meaningful, direction: weightDirection(S, bw),
  }
  const st = strengthRetention(S)
  const strength = { status: st.status, compared: st.compared, improved: st.improved ?? 0, declined: st.declined ?? 0 }
  const con = consistency(S)
  const improvements = recentPRs(S, 14)
  const attention = allAttention(S)
  const recommendation = decideRecommendation(S, { consistency: con, attention, bodyweight, strength })
  return { weekKey: wk, training, bodyweight, strength, consistency: con, improvements, attention, recommendation }
}

/* ============================ optional 4th session ============================ */

// Muscles that matter most for a full-body strength-and-conditioning program — the ones the
// Home Plan hits directly. Recovery is read per-muscle; these are the ones whose signal is
// worth acting on for the optional session.
const KEY_MUSCLES = ['chest', 'deltoids', 'upper-back', 'biceps', 'triceps', 'quadriceps', 'hamstring', 'gluteal', 'abs']

// The routines currently on the schedule, in weekday order — used to pick a 4th-session routine
// that matches the program's session roles.
function scheduledRoutines(S) {
  const ids = new Set()
  for (const day of Object.keys(S?.week || {}))
    for (const id of [].concat(S?.week[day] || [])) ids.add(id)
  return (S?.routines || []).filter(r => r && ids.has(r.id))
}

// Identify a routine by its role prefix (Strength A, Volume B, Conditioning C).
function routineByRole(routines, role) {
  const prefix = role === 'strength' ? 'Strength' : role === 'volume' ? 'Volume' : role === 'conditioning' ? 'Conditioning' : null
  return routines.find(r => prefix && (r.name || '').startsWith(prefix)) || null
}

/**
 * Recommend an optional 4th session for the week, based on recovery + recent training +
 * program goals. The Home Plan has three scheduled sessions (Strength / Volume / Conditioning);
 * a 4th is only advised when recovery and training history point to a specific, useful purpose.
 *
 * Returns null when there is not enough evidence to give a recommendation (no workouts yet,
 * no scheduled routines, or the program structure is not recognised).
 *
 * @param {object} S Full state object.
 * @returns {{kind:string,label:string,note:string,routineId:string|null}|null}
 *   kind is one of 'recovery', 'strength', 'conditioning', 'volume', or 'extra'.
 */
export function optionalSession(S) {
  const now = Date.now()
  const workouts = S?.workouts || []
  if (!workouts.length) return null

  const routines = scheduledRoutines(S)
  if (!routines.length) return null

  const fatigue = fatigueOf(workouts, now, { unit: S?.unit })
  const strength = strengthOf(workouts, now)

  // Average fatigue and strength retention across the key muscle groups.
  const avgFatigue = KEY_MUSCLES.reduce((s, m) => s + (fatigue[m] || 0), 0) / KEY_MUSCLES.length
  const avgStrength = KEY_MUSCLES.reduce((s, m) => s + (strength[m] || STRENGTH_FLOOR), 0) / KEY_MUSCLES.length

  // Muscles whose strength has fallen below full retention (14 days since last work).
  const detrained = detrainedMuscles(workouts, now)
  const hasDetraining = detrained.some(m => KEY_MUSCLES.includes(m))

  // Recovered enough to train? Below 0.3 average fatigue reads as ready.
  if (avgFatigue > 0.35) {
    // Still recovering from recent sessions — a rest or light-movement day is the useful 4th.
    return {
      kind: 'recovery',
      label: 'Rest day',
      note: 'Key muscles are still recovering from recent training — rest or light movement.',
      routineId: null,
    }
  }

  // Strength is declining on at least one key muscle → a maintenance session helps hold it.
  if (hasDetraining) {
    const routine = routineByRole(routines, 'strength')
    if (routine) {
      return {
        kind: 'strength',
        label: routine.name,
        note: 'Some strength is fading — a maintenance session helps you hold it on a deficit.',
        routineId: routine.id,
      }
    }
  }

  // Fully recovered and strength is holding → a conditioning session keeps fat-loss momentum.
  const condRoute = routineByRole(routines, 'conditioning')
  if (condRoute) {
    return {
      kind: 'conditioning',
      label: condRoute.name,
      note: 'Fully recovered — conditioning supports the fat-loss goal.',
      routineId: condRoute.id,
    }
  }

  // Fallback: no role-matched routine found (e.g. user renamed routines). Offer the first
  // scheduled routine as a safe default.
  return {
    kind: 'extra',
    label: routines[0].name,
    note: 'Pick whichever session fits your day and energy.',
    routineId: routines[0].id,
  }
}
