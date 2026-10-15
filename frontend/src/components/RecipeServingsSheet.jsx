import { useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { energyOf } from '../lib/nutrition/diary.js'
import { mealKcal } from '../lib/nutrition/meals.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { Stat } from './blocks.jsx'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, NumberField } from './ui.jsx'

// How many servings of a recipe, then Log (NutriTrace's quantity prompt for a recipe). `onLog(servings)`
// resolves to whether it was logged and tells the person when it was not; the sheet then stays, and
// Log again sends the same entries.
export default function RecipeServingsSheet({ recipe, mealName, onLog, close }) {
  const settings = useNutrition(s => s.settings.data)
  const [servings, setServings] = useState(1)
  const [busy, setBusy] = useState(false)
  const valid = Number(servings) > 0
  const total = energyOf(Math.round(mealKcal(recipe) * (Number(servings) || 0)), settings)

  async function log() {
    if (!valid || busy) return
    setBusy(true)
    if (await onLog(Number(servings))) close()
    else setBusy(false)
  }

  return <>
    <SheetHeader title={recipe.name} sub={mealName} onClose={close} />
    <label className="measure-date">
      <span>{t('Servings eaten')}</span>
      <NumberField value={servings} onChange={setServings} aria-label={t('Servings eaten')} />
    </label>
    {valid ? <Stat value={`${total.value} ${total.unit}`} /> : <div className="muted small" role="status">{t('Enter servings above 0.')}</div>}
    <SheetActions>
      <Button variant="primary" onClick={log} disabled={!valid || busy}>{busy ? t('Saving…') : t('Log to {0}', mealName)}</Button>
    </SheetActions>
  </>
}

/** Opens the sheet over the page. */
export function recipeServingsSheet(props) {
  useUI.getState().openSheet(close => <RecipeServingsSheet {...props} close={close} />)
}
