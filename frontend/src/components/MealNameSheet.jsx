import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { mealsOf } from '../lib/nutrition/diary.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { MEAL_NAME_MAX, MEAL_NAMES_MAX, moveMeal, removeMeal, setMealName } from '../lib/nutrition/settings-lists.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useSheetSave } from '../lib/nutrition/use-nt-settings.js'
import { confirmSheet } from '../sheets.jsx'
import { Button, TextField } from './ui.jsx'
import { SheetHeader, SheetActions } from './sheet-layout.jsx'

const errorOf = code => ({
  name: t('Give the meal a name of up to {0} characters.', MEAL_NAME_MAX),
  full: t('There can be at most {0} meals.', MEAL_NAMES_MAX),
  last: t('A day needs at least one meal.'),
  slot: t('That meal is not there any more.'),
  stale: t('The meals changed somewhere else. Close this and open it again.'),
})[code]

// NutriTrace's meal names (Diary.svelte): rename a meal, move it up or down, or take it out;
// `slot` equal to the number of meals adds a new one. The change is made over the names as the
// server has them when you press the button, and only if the meal is still the one you opened.
// Only what you typed is saved as yours: the default names (Breakfast, Lunch...) show in the app's
// language, and stay NutriTrace's defaults in the list unless you rename them. What was logged
// stays in its slot (the diary files an entry by its meal's place in the list), so moving or
// removing a meal moves that slot's entries with it.
export default function MealNameSheet({ slot, close }) {
  const opened = useNutrition.getState().settings.data
  const meals = mealsOf(opened)
  const shown = mealLabels(opened)
  const adding = slot >= meals.length
  const original = adding ? null : meals[slot]
  const [name, setName] = useState(adding ? '' : shown[slot])
  const { busy, error, submit } = useSheetSave(close)
  const run = build => submit('mealNames', data => {
    const now = mealsOf(data)
    if (!adding && now[slot]?.name !== original.name) return { error: 'stale' }
    return build(now.map(m => m.name))
  }, errorOf)
  // A default name left as it was shown is not typed by anyone: keep NutriTrace's own.
  const typed = name.trim()
  const kept = !adding && original.isDefault && typed === shown[slot] ? original.name : name
  const confirmRemove = () => confirmSheet({
    title: t('Remove {0}?', shown[slot]),
    message: t('What was logged under it moves to the meal that takes its place.'),
    confirmText: t('Remove'),
    danger: true,
    onConfirm: () => run(list => removeMeal(list, slot)),
  })

  return <div className="quick-sheet">
    <SheetHeader title={adding ? t('Add a meal') : t('Edit meal')} />
    <label className="portion-f">
      <span className="small muted">{t('Name')}</span>
      <TextField value={name} maxLength={MEAL_NAME_MAX} onChange={e => setName(e.target.value)} aria-label={t('Name')} autoFocus />
    </label>
    {error && <div className="nt-error small" role="alert">{error}</div>}
    <SheetActions>
      <Button variant="primary" onClick={() => run(list => setMealName(list, slot, kept))} disabled={busy}>{busy ? t('Saving…') : t('Save')}</Button>
      {!adding && <Button icon="arrowUp" onClick={() => run(list => moveMeal(list, slot, -1))} disabled={busy || slot === 0}>{t('Move up')}</Button>}
      {!adding && <Button icon="arrowDown" onClick={() => run(list => moveMeal(list, slot, 1))} disabled={busy || slot === meals.length - 1}>{t('Move down')}</Button>}
      {!adding && <Button variant="danger" icon="trash" onClick={confirmRemove} disabled={busy || meals.length <= 1}>{t('Remove')}</Button>}
    </SheetActions>
  </div>
}

export function mealNameSheet(slot) {
  useUI.getState().openSheet(close => <MealNameSheet slot={slot} close={close} />)
}
