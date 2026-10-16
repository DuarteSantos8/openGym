import { mealLabels } from '../lib/nutrition/meal-name.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { foodPickerSheet } from './FoodPickerSheet.jsx'
import { scanSheet } from './ScanSheet.jsx'

// Scan a barcode to where the + sheet's Scan logs (PlusSheet.jsx): the date every tab shares and
// the meal, as they are at the tap, with "Search foods" going on to the picker. The header's
// barcode button and the Home and Nutrition action rows all scan through this.
export function scanToSelection() {
  const settings = useNutrition.getState().settings.data
  const { date, meal } = useDiarySelection.getState().target(settings)
  const names = mealLabels(settings)
  const slot = meal < names.length ? meal : 0
  scanSheet({ date, meal: slot, mealName: names[slot], onSearch: foodPickerSheet })
}
