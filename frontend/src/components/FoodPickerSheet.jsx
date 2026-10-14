import { useEffect } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { useNutrition } from '../lib/nutrition/store.js'
import FoodPicker from './FoodPicker.jsx'
import LoggingTo, { useSheetTarget } from './LoggingTo.jsx'
import { SheetHeader } from './sheet-layout.jsx'

// Log food from anywhere (the + sheet's tile): the picker for the selected date and meal, the
// meal changeable in its header. It closes once something is logged.
export default function FoodPickerSheet({ close }) {
  const target = useSheetTarget()
  useEffect(() => { useNutrition.getState().loadSettings() }, [])
  return <div className="food-picker-sheet">
    <SheetHeader title={t('Log food')} />
    <LoggingTo target={target} />
    <FoodPicker date={target.date} meal={target.meal} mealName={target.mealName} autoFocus onLogged={close} />
  </div>
}

export function foodPickerSheet() {
  useUI.getState().openSheet(close => <FoodPickerSheet close={close} />)
}
