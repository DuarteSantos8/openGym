import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { effectiveRoutineIds } from '../lib/history.js'
import { trainingDay } from '../lib/training-day.js'
import { logPastWorkoutSheet, startFlow } from '../sheets.jsx'
import { ActionButton } from './tab-kit.jsx'

// The training slot that opens Home's and Training's action rows (ux-redesign-tabs §1.1, §2), for
// the selected day: Edit (an open editor) or Resume while a session is on, whatever the day; Log
// workout on a past day, with a missed plan's routines picked; Start on a planned day; otherwise
// Workout, the Start screen to pick one.
export default function TrainingSlot({ date }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const toWorkout = () => nav('/train/workout')
  if (S.active?.editingWorkoutId) return <ActionButton icon="pencil" label={t('Edit')} onClick={toWorkout} />
  if (S.active) return <ActionButton icon="play" label={t('Resume')} onClick={toWorkout} />
  const training = trainingDay(S, date, today)
  if (date < today) {
    return <ActionButton icon="history" label={t('Log workout')}
      onClick={() => logPastWorkoutSheet(training.kind === 'past-missed' ? { iso: date, routineIds: effectiveRoutineIds(S, date) } : { iso: date })} />
  }
  if (training.kind === 'planned') return <ActionButton icon="play" label={t('Start')} onClick={() => startFlow(training.ids)} />
  return <ActionButton icon="dumbbell" label={t('Workout')} onClick={toWorkout} />
}
