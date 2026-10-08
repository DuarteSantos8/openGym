import { programmeCycleItems, updateActiveProgrammeCycleInState } from './programmes.js'
import { routineFromSession, sessionForRoutine, sessionChangeFields } from './session-routines.js'

export function applySessionToFutureProgramme(state, session) {
  const cycleId = session.programmeInstance?.cycleId || session.cycleId
  const cycle = state.programmes?.cycles.find(c => c.id === cycleId && c.status === 'active')
  if (!cycle) throw new Error('The active Programme is no longer available.')
  const currentId = session.programmeInstance?.instanceId || session.programmeInstanceId
  const items = programmeCycleItems(state, cycle)
  const currentIndex = items.findIndex(item => item.instanceId === currentId)
  if (currentIndex < 0) throw new Error('The source Programme session is no longer available.')
  const source = items[currentIndex]
  const future = items.slice(currentIndex + 1).filter(item => item.routineId === source.routineId && !item.done && item.status !== 'completed' && !state.workouts.some(w => (w.programmeInstanceId || w.programmeInstance?.instanceId) === item.instanceId))
  if (!future.length) throw new Error('No future sessions use this routine.')
  const weeks = structuredClone(cycle.snapshot.weeks)
  const sourceRoutine = { ...source.routineSnapshot, id: source.routineId }
  const updated = routineFromSession(sessionForRoutine(session, sourceRoutine), session.name, [sourceRoutine])
  for (const item of future) {
    const day = weeks[item.weekIndex - 1]?.days.find(d => d.weekday === item.weekday)
    const target = day?.sessions.find(s => (s.sessionTemplateId || s.id) === item.sessionTemplateId)
    if (!target) throw new Error('A future session is no longer available.')
    target.routineSnapshot = { ...target.routineSnapshot, ex: structuredClone(updated.ex) }
  }
  updateActiveProgrammeCycleInState(state, cycleId, { weeks })
  return future.length
}

export function programmeSessionChangeFields(state, session) {
  const cycle = state.programmes?.cycles.find(c => c.id === (session.programmeInstance?.cycleId || session.cycleId))
  const item = cycle && programmeCycleItems(state, cycle).find(i => i.instanceId === (session.programmeInstance?.instanceId || session.programmeInstanceId))
  if (!item) return []
  const routine = { ...item.routineSnapshot, id: item.routineId }
  return sessionChangeFields({ ...state, routines: [routine] }, session, routine.id)
}
