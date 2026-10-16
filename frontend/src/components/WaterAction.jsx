import { useState } from 'react'
import { useUnits } from '../lib/nutrition/use-units.js'
import { waterButtons } from '../lib/nutrition/water.js'
import { addWater, waterAria } from './WaterCard.jsx'
import { ActionButton } from './tab-kit.jsx'

// The action rows' water button (Home, Nutrition): the first container, or a glass, logged to
// the shown day with Undo, as the + sheet's button does. The visible label is the amount; the
// name says what it does. `day` is useDiaryDay's.
export default function WaterAction({ date, day }) {
  const units = useUnits()
  const [watering, setWatering] = useState(false)
  const glass = waterButtons(day.settings)[0]
  const water = async () => { setWatering(true); await addWater(date, glass.ml); setWatering(false) }
  return <ActionButton icon="droplet" label={'+' + units.water(glass.ml)} ariaLabel={waterAria(glass, units)} onClick={water}
    busy={watering} disabled={watering || !day.dayReady} />
}
