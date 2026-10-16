import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { bwSheet } from '../sheets.jsx'
import { foodPickerSheet } from './FoodPickerSheet.jsx'
import { scanToSelection } from './scan-to-selection.js'
import { ActionButton, ActionRow } from './tab-kit.jsx'
import TrainingSlot from './TrainingSlot.jsx'
import WaterAction from './WaterAction.jsx'

// Home's action row (ux-redesign-tabs §1.2), its positions fixed:
//   [Start | Resume | Workout | Log workout] [Log food] [+250 ml] [Check in if on, else Scan]
// On a past day the last is Weigh in for that day. Without nutrition (the phone build, a guest):
//   [Start…] [Weigh in] [Check in if on, else History].
// The first slot is TrainingSlot, Training's too. Every button runs the flow the rest of the
// app already runs for it: the same start, weigh-in, water and food sheets as the + sheet.
export default function HomeActions({ date, day }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const past = date < today
  const checkIn = S.checkIn !== false
  const first = <TrainingSlot key="t" date={date} />
  const weighIn = <ActionButton key="w" icon="scale" label={t('Weigh in')} onClick={() => bwSheet({ date })} />

  if (!day.on) {
    return <ActionRow>
      {first}
      {weighIn}
      {checkIn
        ? <ActionButton key="c" icon="qr" label={t('Check in')} onClick={() => nav('/train/checkin')} />
        : <ActionButton key="h" icon="history" label={t('History')} onClick={() => nav('/train/history')} />}
    </ActionRow>
  }

  return <ActionRow>
    {first}
    <ActionButton icon="utensils" label={t('Log food')} onClick={foodPickerSheet} />
    <WaterAction date={date} day={day} />
    {past ? weighIn
      : checkIn ? <ActionButton icon="qr" label={t('Check in')} onClick={() => nav('/train/checkin')} />
      : <ActionButton icon="scanBarcode" label={t('Scan')} onClick={scanToSelection} />}
  </ActionRow>
}
