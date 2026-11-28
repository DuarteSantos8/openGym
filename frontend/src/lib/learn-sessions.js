import { todayISO, uid } from './format.js'
import { effectiveRoutineIds, nextTrainingDay } from './history.js'
import { t } from './i18n.js'
import { useCircuit } from '../store/useCircuit.js'
import { useUI } from '../store/useUI.js'

const files = import.meta.glob('../../../routines/learn/*.json', { eager: true, import: 'default' })
export const LEARN_SESSIONS = Object.entries(files).map(([path, routine]) => {
  const id = path.split('/').pop().replace(/\.json$/, '')
  const kind = id.startsWith('warmup') ? 'warmup' : id.startsWith('cooldown') ? 'cooldown' : 'mobility'
  return { id, kind, minutes: routine.duration, title: routine.title, routine }
})

export const learnSessionById = id => LEARN_SESSIONS.find(session => session.id === id) || null

export function startLearnSession(id, store) {
  const session = learnSessionById(id)
  if (!session || store.getState().S.active) return false
  const exercises = session.routine.sessions[0].exercises
  const sgCircuit = { mode: 'circuit', rounds: exercises[0].sets, gap: 0 }
  const entries = exercises.map(({ id: exerciseId, sec, sets }) => ({
    id: exerciseId, sg: id,
    target: { id: exerciseId, mode: 'time', sec, sets, sgCircuit },
    sets: Array.from({ length: sets }, () => ({ sec, w: 0, done: false })),
  }))
  store.getState().update(s => {
    const d = todayISO()
    const restDay = session.kind === 'mobility' && !effectiveRoutineIds(s, d).length &&
      (s.dayPlan[d] === 'rest' || nextTrainingDay(s, d))
    s.active = { id: uid(), d, start: Date.now(), routineIds: [], name: t(session.title),
      ...(restDay ? { restDayMobility: d } : {}),
      learnSession: id, cur: 0, entries, workoutView: s.workoutView || 'cards' }
  })
  useUI.getState().stopRest()
  return useCircuit.getState().openAt(0, { preview: true })
}
