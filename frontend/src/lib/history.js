// Pure helpers over the state object S (ported 1:1 from the vanilla app).
import { todayISO, isoOf, weekKey } from './format.js'

export function lastEntryFor(S, exId) {
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    const en = S.workouts[i].entries.find(e => e.id === exId)
    if (en && en.sets.some(s => s.done)) return { d: S.workouts[i].d, sets: en.sets.filter(s => s.done) }
  }
  return null
}
export function bestWeightFor(S, exId) {
  let best = 0
  S.workouts.forEach(w => w.entries.forEach(e => {
    if (e.id === exId) {
      e.sets.forEach(s => { if (s.done && s.w > best) best = s.w })
      if (e.topW && e.topW > best) best = e.topW
    }
  }))
  return best
}
export function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan[iso]
  if (ov === 'rest') return null
  if (ov && S.routines.some(r => r.id === ov)) return ov
  const wd = new Date(iso + 'T12:00:00').getDay()
  return S.week[wd] || null
}
export function effectiveRoutine(S, iso) {
  const id = effectiveRoutineId(S, iso)
  return id ? S.routines.find(r => r.id === id) || null : null
}
export function buildSets(S, cfg) {
  const last = lastEntryFor(S, cfg.id)
  const conf = S.exWeights[cfg.id]
  const sets = []
  for (let i = 0; i < cfg.sets; i++) {
    const prev = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null
    const w = conf && conf.w > 0 ? conf.w : (prev ? prev.w : cfg.weight)
    sets.push({ w, r: prev ? prev.r : cfg.reps, done: false })
  }
  return sets
}
export function workoutVolume(w) {
  let v = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) v += (s.w || 0) * (s.r || 0) }))
  return v
}
export function setsDone(w) {
  let n = 0
  w.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export function setsDoneActive(A) {
  let n = 0
  if (A) A.entries.forEach(e => e.sets.forEach(s => { if (s.done) n++ }))
  return n
}
export const lastBW = S => (S.bodyweight.length ? S.bodyweight[S.bodyweight.length - 1] : null)

export function streakWeeks(S) {
  if (!S.workouts.length) return 0
  const weeks = new Set(S.workouts.map(w => weekKey(w.d)))
  let streak = 0
  const cur = new Date()
  for (let i = 0; i < 520; i++) {
    const wk = weekKey(isoOf(cur))
    if (weeks.has(wk)) streak++
    else if (i > 0) break
    cur.setDate(cur.getDate() - 7)
  }
  return streak
}
