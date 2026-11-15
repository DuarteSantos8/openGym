// Lift goals: one target weight per exercise with a horizon of 3, 6 or 12 months.
//
//   S.exGoals = { '<exId>': { w: 100, u: 'kg', h: 6, d: '2026-11-15', b: 80 }, … }
//
// `w` is the target in unit `u` (the exercise's own unit when it was set), `h` the months to
// reach it, `d` the day it was set and `b` the best weight at that moment, so progress is measured
// from where you started and not from zero. An exercise has one goal; setting another replaces it.
// Like S.exNotes it is a per-exercise map: two devices that set goals on different exercises keep
// both (lib/sync-merge.js PER_KEY, api/sync-stamps.js), and the same exercise keeps the newer edit.
//
// Pure: no store, no clock. The caller passes today and the best weight it already has
// (bestWeightFor), in the unit it shows. Only a loaded rep exercise has a goal: a cardio or
// assisted one has no "heavier is better" number to aim at (the exercise sheet never offers it).
import { convertWeight } from './units.js'

export const GOAL_HORIZONS = [3, 6, 12]
export const GOAL_W_MAX = 1000
const ISO = /^\d{4}-\d{2}-\d{2}$/
const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v)

/** The goal on an exercise, cleaned up, or null when there is none or it is not readable. */
export function goalFor(S, exId) {
  const g = isMap(S?.exGoals) ? S.exGoals[exId] : null
  if (!isMap(g)) return null
  const w = Number(g.w)
  if (!Number.isFinite(w) || w <= 0 || w > GOAL_W_MAX) return null
  if (!GOAL_HORIZONS.includes(g.h) || !ISO.test(String(g.d))) return null
  const u = g.u === 'lb' ? 'lb' : 'kg'
  const b = Number(g.b)
  return { w, u, h: g.h, d: g.d, b: Number.isFinite(b) && b > 0 ? b : 0 }
}

/** `d` plus `months`, as a day; a 31st that the later month lacks lands on that month's last day. */
export function dueDay(d, months) {
  const [y, m, day] = d.split('-').map(Number)
  const first = new Date(y, m - 1 + months, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const out = new Date(first.getFullYear(), first.getMonth(), Math.min(day, last))
  return out.getFullYear() + '-' + String(out.getMonth() + 1).padStart(2, '0') + '-' + String(out.getDate()).padStart(2, '0')
}

const dayNo = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000) }

/** The goals map with `goal` ({ w, u, h, d, b }) set on the exercise, or removed for null. */
export function withGoal(map, exId, goal) {
  const out = { ...(isMap(map) ? map : {}) }
  if (!goal) delete out[exId]
  else out[exId] = { w: Number(goal.w), u: goal.u === 'lb' ? 'lb' : 'kg', h: goal.h, d: goal.d, b: Number(goal.b) || 0 }
  return out
}

/**
 * Where a goal stands today.
 *   best, bestUnit  the best weight logged and the unit it is in (0 when nothing is logged)
 * Returns { target, best, base, pct, done, dueISO, daysLeft, status, perWeek }, in the goal's unit:
 *   pct      0–100, the part of the way from where you started to the target
 *   status   'done' (best reached the target), 'overdue' (past the day, not there), else 'ahead',
 *            'on' or 'behind' — your share of the climb against your share of the time gone
 *   perWeek  what is still to gain each week to arrive on the day, null once done or overdue
 */
export function goalProgress(goal, best, bestUnit, today) {
  const have = best > 0 ? convertWeight(best, bestUnit === 'lb' ? 'lb' : 'kg', goal.u) : 0
  const base = Math.min(goal.b || 0, goal.w)
  const dueISO = dueDay(goal.d, goal.h)
  const total = Math.max(1, dayNo(dueISO) - dayNo(goal.d))
  const daysLeft = dayNo(dueISO) - dayNo(today)
  const done = have >= goal.w
  const climbed = goal.w > base ? (have - base) / (goal.w - base) : 1
  const pct = Math.max(0, Math.min(100, Math.round(climbed * 100)))
  const timeFrac = Math.max(0, Math.min(1, (dayNo(today) - dayNo(goal.d)) / total))
  let status
  if (done) status = 'done'
  else if (daysLeft < 0) status = 'overdue'
  else if (climbed >= timeFrac + 0.15) status = 'ahead'
  else if (climbed >= timeFrac) status = 'on'
  else status = 'behind'
  const weeks = daysLeft / 7
  const perWeek = done || daysLeft < 0 ? null : Math.round(((goal.w - have) / Math.max(weeks, 1)) * 10) / 10
  return { target: goal.w, best: have, base, pct, done, dueISO, daysLeft, status, perWeek }
}
