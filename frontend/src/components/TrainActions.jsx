import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { ActionButton, ActionRow } from './tab-kit.jsx'
import TrainingSlot from './TrainingSlot.jsx'

// Training's action row (ux-redesign-tabs §2), its positions fixed:
//   [Start | Resume | Workout | Log workout] [History] [Exercises] [Check in if on, else Coach if on]
// The last slot depends on settings, not on the day, so it never moves for a given user; with
// neither on the row has three.
export default function TrainActions({ date, showCoach }) {
  const nav = useNavigate()
  const checkIn = useStore(s => s.S.checkIn !== false)
  return <ActionRow>
    <TrainingSlot date={date} />
    <ActionButton icon="history" label={t('History')} onClick={() => nav('/train/history')} />
    <ActionButton icon="bookOpen" label={t('Exercises')} onClick={() => nav('/train/exercises')} />
    {checkIn ? <ActionButton icon="qr" label={t('Check in')} onClick={() => nav('/train/checkin')} />
      : showCoach ? <ActionButton icon="chat" label={t('Coach')} onClick={() => nav('/train/coach')} />
      : null}
  </ActionRow>
}
