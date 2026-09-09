// The Coach, in the demo build.
//
// The GitHub Pages demo has no backend at all, so there is nothing to run a CLI and nothing
// to poll. Rather than hide the feature there — it is the most interesting thing the app
// does — the demo answers the same calls locally with a canned proposal.
//
// It is built from the demo profile's actual routines rather than hard-coded, so every id
// resolves, the before/after values are real, and applying it exercises exactly the same
// code path as a live instance: validate, snapshot, apply, log, revert. What is faked is the
// provider, not the feature.
//
// Nothing here ships in a self-hosted bundle: every entry point is behind DEMO, which Vite
// replaces at build time.

import { EXIDX, EXDB } from './exercises.js'
import { modeOf, workoutVolume } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { best1RM } from './onerm.js'
import { fmtNum } from './format.js'
import { planHash } from './coach.js'
import { t } from './i18n.js'

const DELAY = 2200      // long enough to see "the Coach is thinking…", short enough to forgive

let pending = null
let job = null
let timer = null

const iso = d => d.toISOString().slice(0, 10)

/** A change-set that reads like a real one, aimed at whatever the demo profile actually has. */
function buildReview(S) {
  const routine = (S.routines || []).find(r => (r.ex || []).length >= 2)
  if (!routine) return null
  const reps = (routine.ex || []).filter(e => modeOf(e) === 'reps')
  const first = reps[0] || routine.ex[0]
  const second = reps[1] || routine.ex[1]
  const other = (S.routines || []).find(r => r.id !== routine.id)

  // Something plausible that is *not* in this routine, from the same body part as the first
  // exercise — a swap the reader can believe rather than a random pick out of 1,324.
  const bp = EXIDX[first.id]?.bp
  const swapTo = EXDB.find(e => e.bp === bp && e.eq === 'dumbbell' && !(routine.ex || []).some(x => x.id === e.id))
    || EXDB.find(e => e.bp === bp && !(routine.ex || []).some(x => x.id === e.id))

  const sessions = (S.workouts || []).slice(-9)
  const changes = []
  if (swapTo) changes.push({
    id: 'd1', type: 'swap-exercise', target: { routineId: routine.id, exId: first.id },
    before: EXIDX[first.id]?.n || first.id, after: { id: swapTo.id, name: swapTo.n },
    why: t('Every top set on this one came in at RPE 9.5 or above for three sessions and the weight has not moved. Swapping the movement for four weeks usually breaks that stall faster than grinding the same one.')
  })
  if (second) changes.push({
    id: 'd2', type: 'sets', target: { routineId: routine.id, exId: second.id },
    before: second.sets ?? 3, after: Math.max(1, (second.sets ?? 3) - 1),
    why: t('Sessions have been running about fifteen minutes over. This is the accessory with the least to lose from one set fewer.')
  })
  if (other) changes.push({
    id: 'd3', type: 'week', target: { weekday: 6 }, before: null, after: other.id,
    why: t('You have moved this session to Saturday three weeks running. Better the plan says so than that you keep overriding it.')
  })

  return {
    id: 'demo-review', kind: 'review', createdAt: Date.now(), expiresAt: Date.now() + 864e5,
    planHash: planHash(S), iteration: 1,
    summary: t('Three things worth changing, and one worth knowing about. Everything else is working — the squat and the pulls are both progressing on schedule.'),
    evidence: { from: sessions[0]?.d || iso(new Date(Date.now() - 28 * 864e5)), to: sessions.at(-1)?.d || iso(new Date()), sessions: sessions.length || 9 },
    changes,
    notes: [t('Body weight has been flat for four weeks while the goal is to gain. That is a kitchen problem rather than a training one — the plan is not what is holding it back.')]
  }
}

/** A small, honest starter plan for the demo's creation flow. */
function buildPlan(S, intake) {
  const pick = (bp, eq) => EXDB.find(e => e.bp === bp && (!eq || e.eq === eq)) || EXDB.find(e => e.bp === bp)
  const days = intake?.preferredDays?.length ? intake.preferredDays.slice(0, 3) : [1, 3, 5]
  const eq = (intake?.equipment || [])[0] || null
  const mk = (id, name, sets, reps, why) => ({ id, sets, reps, mode: 'reps', why })
  const routines = [
    {
      id: 'dr1', name: t('Full body A'), emoji: '💪', prog: 'linear',
      why: t('The two big lower-body and pressing patterns first, while you are fresh.'),
      ex: [
        mk(pick('upper legs', eq)?.id, null, 3, 8, t('The main lower-body driver — where most of the strength comes from.')),
        mk(pick('chest', eq)?.id, null, 3, 10, t('Horizontal pressing, the other half of the session.')),
        mk(pick('back', eq)?.id, null, 3, 10, t('A pull for every press, so the shoulders stay balanced.'))
      ].filter(e => e.id)
    },
    {
      id: 'dr2', name: t('Full body B'), emoji: '🏋️', prog: 'linear',
      why: t('The same patterns, different variations — enough overlap to progress, enough difference to stay fresh.'),
      ex: [
        mk(pick('upper legs', eq)?.id, null, 3, 10, t('Same pattern, higher reps than day A.')),
        mk(pick('shoulders', eq)?.id, null, 3, 10, t('Vertical pressing.')),
        mk(pick('upper arms', eq)?.id, null, 3, 12, t('Direct arm work, since you asked for it.'))
      ].filter(e => e.id)
    }
  ]
  const week = {}
  days.forEach((d, i) => { week[d] = routines[i % routines.length].id })
  return {
    id: 'demo-plan', kind: 'create', createdAt: Date.now(), expiresAt: Date.now() + 864e5, iteration: 1,
    planHash: planHash(S),
    summary: t('A two-day rotation across three sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.'),
    bundle: {
      opengym_plan: 1, name: t('Coach plan'),
      summary: t('A two-day rotation across three sessions a week, built around the equipment you listed. Compounds first, one pull for every press, and enough overlap between the days that nothing goes two weeks without being trained.'),
      basedOn: (S.workouts || []).length ? t('Based on the training already in this demo profile.') : t('No training history yet — starting conservatively.'),
      week, routines, customEx: []
    }
  }
}

/** One session, read back with its own numbers — no plan changes, just what a coach would say after. */
function buildDebrief(S, workoutId) {
  const all = (S.workouts || []).filter(w => w && w.d)
  const w = all.find(x => x.id === workoutId) || all[all.length - 1]
  if (!w) return null
  const done = (w.entries || []).reduce((n, en) => n + (en.sets || []).filter(s => s.done && !isWarmupRow(s)).length, 0)
  const planned = (w.entries || []).reduce((n, en) => n + (en.sets || []).filter(s => !isWarmupRow(s)).length, 0)
  const vol = Math.round(Number.isFinite(w.vol) ? w.vol : workoutVolume(w))
  const prs = (w.prs || []).length
  const minutes = w.end && w.start ? Math.round((w.end - w.start) / 60000) : null
  const complete = planned > 0 && done >= planned
  const score = complete ? (prs ? 9 : 8) : 7
  const highlights = [
    complete ? t('Every planned set done — {0} of {1}.', done, planned) : t('{0} of {1} planned sets done.', done, planned),
    t('{0} {1} moved in total.', fmtNum(vol), S.unit)
  ]
  if (prs) highlights.push(t('{0} new personal records.', prs))
  const watch = minutes && minutes > 80 ? [t('{0} minutes is long — rest periods may be creeping up.', minutes)] : [t('Top sets logged without an effort rating; add RIR so the next review can read how hard they were.')]
  const nextTime = [complete ? t('Add the next load step on the main lift.') : t('Repeat the same loads and get every set.'), t('Keep the session under an hour and a quarter.')]
  return {
    id: 'demo-debrief', kind: 'debrief', createdAt: Date.now(), expiresAt: Date.now() + 864e5,
    planHash: planHash(S), iteration: 1,
    workout: { id: w.id, d: w.d, name: w.name || null, minutes, vol, sets: done, prs },
    summary: complete
      ? t('A clean session: everything on the sheet got done and the loads held. This is exactly what progress looks like from the inside — unremarkable, repeated.')
      : t('Most of the work got done. One or two sets fell short, which is fine once — it becomes a signal if the same sets miss next time.'),
    score, highlights, watch, nextTime
  }
}

/** What "the room" would say on a busy instance — five people, plausible medians, your real bests. */
export function demoCohort(S) {
  const since = Date.now() - 56 * 864e5
  const you = Math.round((S.workouts || []).filter(w => (w.start || new Date(w.d).getTime()) > since).length / 8 * 10) / 10
  const ids = [...new Set((S.routines || []).flatMap(r => (r.ex || []).map(e => e.id)))].slice(0, 5)
  const exercises = ids.map(id => {
    const b = best1RM(S, id)
    const mine = b ? Math.round(b.est * 10) / 10 : null
    return { id, name: EXIDX[id]?.n || id, people: 4, median: mine ? Math.round(mine * 0.92) : 60, you: mine }
  })
  return { ok: true, enabled: true, sharing: true, people: 5, minPeople: 3, unit: S.unit, sessionsPerWeek: { median: 3, you }, exercises, rankPct: 62 }
}

/* ---------------- the API surface the demo stands in for ---------------- */

export const demoStatus = () => ({ job, pending, cap: { used: 0, limit: 0 } })

function start(kind, make) {
  if (job) throw Object.assign(new Error(t('The Coach is already thinking about your training.')), { status: 409 })
  job = { id: 'demo-' + kind, kind, state: 'running', startedAt: Date.now() }
  clearTimeout(timer)
  timer = setTimeout(() => { pending = make(); job = null }, DELAY)
  return { job }
}
export const demoReview = S => start('review', () => buildReview(S))
export const demoPlan = (S, intake) => start('create', () => buildPlan(S, intake))
export const demoRefine = S => start('create', () => {
  const p = buildPlan(S, null)
  return { ...p, iteration: (pending?.iteration || 1) + 1, summary: t('Revised as you asked. Everything you did not question is exactly as it was.') + ' ' + p.summary }
})
export const demoDebrief = (S, workoutId) => {
  if (!(S.workouts || []).some(w => w && w.d)) throw Object.assign(new Error(t('There is no workout to look at yet — log one first.')), { status: 409, code: 'noworkout' })
  return start('debrief', () => buildDebrief(S, workoutId))
}
export const demoResolve = () => { pending = null; return { ok: true } }
export const demoDisclosure = () => ({
  provider: 'demo', providerLabel: t('the configured AI provider'),
  categories: ['plan', 'training', 'bodyweight', 'profile', 'prefs'], version: 1
})
