import { programmeCycleItems, programmeWeekMode } from './programmes.js'
import { lastEntryFor, modeOf } from './history.js'
import { nextPrescription, POLICIES_FOR } from './progression.js'
import { EXIDX } from './exercises.js'

const sourceOf = workout => workout.programmeInstance || workout.programmeStep || workout.programme || workout
export function programmeHistoryForExercise(state, cycle, item, cfg, index, configs) {
  const mode = modeOf(cfg), occurrence = cfg.occurrenceId || cfg.id + '#' + (index + 1)
  const ordinal = configs.slice(0, index).filter(entry => entry.id === cfg.id).length
  return (state.workouts || []).filter(workout => {
    const source = sourceOf(workout)
    if ((source.cycleId || workout.cycleId) !== cycle.id || workout.partial === true || workout.complete === false || workout.owed === true) return false
    if ((source.instanceId || workout.programmeInstanceId) === item.instanceId) return true
    const week = Number(source.weekIndex)
    if (week && week !== item.weekIndex) return week < item.weekIndex
    const date = String(source.nominalDate || source.date || workout.d || '').slice(0, 10)
    if (date !== item.date) return date && date < item.date
    const order = Number(source.ordinal || workout.ordinal)
    return order ? order < Number(item.ordinal || 1) : false
  }).flatMap(workout => {
    const matches = (workout.entries || []).filter(entry => entry.id === cfg.id)
    const entry = matches.some(entry => entry.occurrenceId) ? matches.find(entry => entry.occurrenceId === occurrence) : matches[ordinal]
    if (!entry || modeOf(entry.target || entry) !== mode) return []
    // Weighted history with unknown or different units cannot establish a kg/lb baseline.
    if (mode === 'reps' && (entry.sets || []).some(row => Number(row.w) > 0)) {
      const units = [workout, entry, entry.target, ...(entry.sets || [])].flatMap(value => ['unit','weightUnit','loadUnit'].map(key => value?.[key]).filter(unit => unit != null && unit !== ''))
      if (!units.length || units.some(unit => unit !== (state.unit || 'kg'))) return []
    }
    return [{ ...workout, entries: [entry] }]
  })
}
function targetText(target, cfg, mode, unit) {
  const value = { ...cfg, ...target }
  if (mode === 'time') return (Number(value.sec || value.seconds) || 0) + 's'
  if (mode === 'cardio') return (Number(value.min) || 0) + 'm'
  const reps = Number(value.reps ?? value.r) || 0, weight = Number(value.weight ?? value.w) || 0
  return weight > 0 ? weight + ' ' + unit + ' × ' + reps : reps + ' reps'
}
export function programmeTimelineForCycle(state, cycle, options = {}) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: cycle.timeZone || 'UTC', year:'numeric',month:'2-digit',day:'2-digit' }).formatToParts(new Date(options.now ?? Date.now()))
  const part = type => parts.find(value => value.type === type).value
  const today = part('year') + '-' + part('month') + '-' + part('day')
  const currentWeek = Math.max(1, Math.min(cycle.lengthWeeks || 1, Math.floor((Date.parse(today)-Date.parse(cycle.week1StartDate))/604800000)+1))
  const items = programmeCycleItems(state, cycle)
  const weeks = (cycle.snapshot?.weeks || []).map((week,index) => ({ index:index+1, mode:programmeWeekMode(week.mode), items:items.filter(item=>item.weekIndex===index+1).map(item=>{
    const routine = item.routineSnapshot || {}, configs = routine.ex || []
    return { ...item, projectedDate:item.date, exercises:configs.map((cfg,index)=>{
      const mode=modeOf(cfg), source={...state,workouts:programmeHistoryForExercise(state,cycle,item,cfg,index,configs)}
      const requested=cfg.prog || routine.prog || cycle.progression || 'off', policy=(POLICIES_FOR[mode] || []).includes(requested)?requested:'off'
      const last=lastEntryFor(source,cfg.id)
      const plan=programmeWeekMode(week.mode)==='deload'?{kind:'hold'}:nextPrescription(source,{...cfg,prog:policy},routine)
      const lastTarget=last?.target || (last?.sets?.length ? { weight:last.sets.at(-1).w,reps:last.sets.at(-1).r,sec:last.sets.at(-1).sec,min:last.sets.at(-1).min } : null)
      return {key:item.instanceId+':'+index,id:cfg.id,name:cfg.name || cfg.n || state.customEx?.find(ex=>ex.id===cfg.id)?.n || EXIDX[cfg.id]?.n || cfg.id,
        last:lastTarget?targetText(lastTarget,cfg,mode,state.unit || 'kg'):'–',next:targetText(plan,cfg,mode,state.unit || 'kg'),notes:cfg.notes,sg:cfg.sg,rest:cfg.workRestSec}
    }) }
  }) }))
  return {cycle,currentWeek,totalWeeks:weeks.length || 1,weeks}
}
