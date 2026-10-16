import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { useDiaryTarget } from '../lib/nutrition/selection.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { waterButtons } from '../lib/nutrition/water.js'
import { bwSheet } from '../sheets.jsx'
import { foodPickerSheet } from './FoodPickerSheet.jsx'
import { scanSheet } from './ScanSheet.jsx'
import { addWater, waterAria } from './WaterCard.jsx'
import { ActionButton, ActionRow } from './tab-kit.jsx'
import TrainingSlot from './TrainingSlot.jsx'

// Home's action row (ux-redesign-tabs §1.2), its positions fixed:
//   [Start | Resume | Workout | Log workout] [Log food] [+250 ml] [Check in if on, else Scan]
// On a past day the last is Weigh in for that day. Without nutrition (the phone build, a guest):
//   [Start…] [Weigh in] [Check in if on, else History].
// The first slot is TrainingSlot, Training's too. Every button runs the flow the rest of the
// app already runs for it: the same start, weigh-in, water and food sheets as the + sheet.
export default function HomeActions({ date, day }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const units = useUnits()
  const { meal } = useDiaryTarget(day.settings)
  const [watering, setWatering] = useState(false)
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

  const glass = waterButtons(day.settings)[0]
  const water = async () => { setWatering(true); await addWater(date, glass.ml); setWatering(false) }
  const names = mealLabels(day.settings)
  const scan = () => scanSheet({ date, meal, mealName: names[meal] ?? names[0], onSearch: foodPickerSheet })
  return <ActionRow>
    {first}
    <ActionButton icon="utensils" label={t('Log food')} onClick={foodPickerSheet} />
    {/* The visible label is the amount; the name says what it does, as the + sheet's button does. */}
    <ActionButton icon="droplet" label={'+' + units.water(glass.ml)} ariaLabel={waterAria(glass, units)} onClick={water}
      busy={watering} disabled={watering || !day.dayReady} />
    {past ? weighIn
      : checkIn ? <ActionButton icon="qr" label={t('Check in')} onClick={() => nav('/train/checkin')} />
      : <ActionButton icon="scanBarcode" label={t('Scan')} onClick={scan} />}
  </ActionRow>
}
