import { t } from '../i18n.js'
import { useUI } from '../../store/useUI.js'
import { toastLogged, writeErrorText } from './log-feedback.js'
import { useNutrition } from './store.js'
import { settingOf } from './use-nt-settings.js'

// Whether picking a food asks how much first (Profile › Diary & meals › Ask for quantity when
// adding). Off, a pick logs one serving at the food's own portion: logServing.
export const asksQuantity = settings => settingOf(settings, 'diaryPromptQuantity') !== false

// The draft of a serving whose write failed, by day, meal and food: tapping the food again sends
// that same entry, so a save whose answer was lost is not logged twice.
const drafts = new Map()

/** Logs one serving of `food` (at its own portion and unit) to the date and meal, with Undo.
 *  A failure is a toast. @returns {Promise<boolean>} */
export async function logServing(food, { date, meal, mealName, onLogged }) {
  const n = useNutrition.getState()
  const key = [date, meal, food.id ?? food.client_key ?? food.name].join('|')
  try {
    if (!drafts.has(key)) drafts.set(key, n.draftFood({ food, meal, portion: Number(food.portion) || 100, unit: food.unit || 'g', servings: 1 }))
    const item = await n.logFood(date, drafts.get(key))
    drafts.delete(key)
    if (onLogged) onLogged()
    toastLogged(t('Logged to {0}', mealName), () => useNutrition.getState().removeItem(date, item.uuid))
    return true
  } catch (e) {
    useUI.getState().toast(writeErrorText(e))
    return false
  }
}
