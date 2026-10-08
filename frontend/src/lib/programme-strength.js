import { estimate1RM } from './onerm.js'
import { isWarmupRow, modeForSet } from './workout-model.js'
import { modeOf } from './history.js'
// Programme suggestions use explicit load provenance. Older untagged loads remain visible
// in history, but cannot establish a kg/lb starting prescription.
export function programmeTargetHistory(state, cfg) {
  return (state.workouts || []).filter(workout => !workout.partial && workout.complete !== false && !workout.owed).flatMap(workout => {
    const entries = (workout.entries || []).filter(entry => {
      if (entry.id !== cfg.id || modeOf(entry.target || entry) !== modeOf(cfg)) return false
      const units = [workout,entry,entry.target,...(entry.sets || [])].flatMap(value => ['unit','weightUnit','loadUnit'].map(key => value?.[key]).filter(unit => unit != null && unit !== ''))
      const weighted = (entry.sets || []).some(row => Number(row.w) > 0) || Number(entry.target?.weight) > 0
      return modeOf(cfg) !== 'reps' || ((!weighted || units.length > 0) && units.every(unit => unit === (state.unit || 'kg')))
    })
    return entries.length ? [{...workout,entries}] : []
  })
}
// Live adaptive algorithm: median best estimate from the newest three eligible
// sessions, retaining full strength for 21 days then decaying with a 60-day half-life
// and a 50% floor. Use current estimator and mode/phase guards.
export function programmeAdaptiveEstimate(workouts, now = Date.now()) {
  now = typeof now === 'number' ? now : Date.parse(now)
  const sessions = workouts.flatMap(workout => {
    const estimates = workout.entries.flatMap(entry => (entry.sets || []).filter(row => row.done && !isWarmupRow(row) && modeForSet(row,entry.target || entry) === 'reps').map(row => estimate1RM(row.w,row.r))).filter(value => value > 0)
    const timestamp = /^\d{4}-\d{2}-\d{2}/.test(workout.d || '') ? Date.parse(workout.d.slice(0,10)+'T12:00:00Z') : Number(workout.start)
    return estimates.length && Number.isFinite(timestamp) && timestamp <= now ? [{timestamp,estimate:Math.max(...estimates)}] : []
  }).sort((a,b) => b.timestamp-a.timestamp).slice(0,3)
  if (!sessions.length) return null
  const ordered = sessions.map(session => session.estimate).sort((a,b) => a-b)
  const median = Math.round((ordered.length === 2 ? (ordered[0]+ordered[1])/2 : ordered[Math.floor(ordered.length/2)])*10)/10
  const ageDays = Math.max(0,(now-sessions[0].timestamp)/86400000)
  const retention = ageDays <= 21 ? 1 : Math.max(.5,.5**((ageDays-21)/60))
  return Math.round(median*retention*10)/10
}
