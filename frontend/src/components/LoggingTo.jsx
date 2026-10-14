import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { menuSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

/** Where a sheet's logs go, taken once when it opens (the selection's date and meal then) and
 *  kept, so it does not change under the person's finger. Picking another meal here changes it
 *  for this sheet and for the next half hour (selection.js setMeal).
 *  @returns {{ date: string, meal: number, mealName: string, names: string[], setMeal: (slot: number) => void }} */
export function useSheetTarget() {
  const settings = useNutrition(s => s.settings.data)
  const [snap, setSnap] = useState(() => useDiarySelection.getState().target(settings))
  const names = mealLabels(settings)
  // Settings that arrive after the sheet opened can only name the meal; the date stays.
  const meal = snap.meal < names.length ? snap.meal : 0
  const setMeal = slot => { useDiarySelection.getState().setMeal(slot); setSnap(s => ({ ...s, meal: slot })) }
  return { date: snap.date, meal, mealName: names[meal], names, setMeal }
}

// "Logging to Tue 13 Oct · Lunch ▾" (ia-proposal §4): where this sheet's logs go. Tapping it
// picks another meal.
export default function LoggingTo({ target }) {
  const { date, meal, mealName, names, setMeal } = target
  const dateText = date === todayISO() ? t('Today') : fmtDate(date, true)
  const pickMeal = () => menuSheet({
    title: t('Log to which meal?'),
    items: names.map((n, i) => ({ label: n, on: i === meal, onClick: () => setMeal(i) })),
  })
  return <button type="button" className="logging-to" onClick={pickMeal}
    aria-label={t('Logging to {0}, {1}. Change meal', dateText, mealName)}>
    <span className="muted">{t('Logging to')}</span>
    <span className="logging-to-v">{dateText} · {mealName}</span>
    <Icon name="chevronDown" />
  </button>
}
