import { useEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { unitsFor } from '../lib/nutrition/diary.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { ingredientOf, rescaleIngredient } from '../lib/nutrition/meals.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { Chip, ChipRow } from './blocks.jsx'
import FoodSearch from './FoodSearch.jsx'
import MealNutrition from './MealNutrition.jsx'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, NumberField } from './ui.jsx'

// One ingredient of a meal or recipe: search or scan a food (yours or Open Food Facts) and say how
// much, or (with `item`) change the amount of one already in it, or take it out (`onRemove`).
// Hands the ingredient to `onDone` and closes.
export function IngredientSheet({ item = null, onDone, onRemove = null, close }) {
  const settings = useNutrition(s => s.settings.data)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(null)
  const alive = useRef(true)
  const [picked, setPicked] = useState(item)
  const [amount, setAmount] = useState(item ? (parseFloat(item.portion) || 0) * (parseFloat(item.quantity) || 1) : 0)
  const [unit, setUnit] = useState(item?.unit || 'g')

  useEffect(() => { useNutrition.getState().loadSettings() }, [])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const ingredient = useMemo(() => {
    if (!picked) return null
    try { return item ? rescaleIngredient(item, amount, unit) : ingredientOf(picked, amount, unit) } catch { return null }
  }, [picked, item, amount, unit])

  const pick = food => {
    setPicked(food)
    setAmount(Number(food.portion) || 100)
    setUnit(food.unit || 'g')
  }

  // A food from Open Food Facts or a barcode is saved first (its client_key makes a retry after a
  // lost answer one food), then used: an ingredient points at a saved food.
  // A save that failed keeps its food, key included: Try again sends that same one, since the
  // failed POST may have been saved with its answer lost (a rescan would mint a new key).
  const choose = async food => {
    if (saving) return
    if (typeof food.id === 'number') { pick(food); return }
    setSaving(true)
    setFailed(null)
    try {
      const saved = await useNutrition.getState().saveFood(food)
      if (alive.current) pick(saved)
    } catch (e) {
      if (alive.current) setFailed({ food, text: writeErrorText(e) })
    }
    if (alive.current) setSaving(false)
  }

  const done = () => {
    if (!ingredient) return
    onDone(ingredient)
    close()
  }

  const remove = () => {
    onRemove()
    close()
  }

  if (!picked) {
    return <>
      <SheetHeader title={t('Add ingredient')} onClose={close} />
      {saving && <div className="muted small" role="status">{t('Saving…')}</div>}
      {failed && <>
        <div className="nt-error small" role="alert">{failed.text}</div>
        <Button size="sm" variant="tinted" onClick={() => choose(failed.food)}>{t('Try again')}</Button>
      </>}
      <FoodSearch onPick={choose} scan={{ onPick: choose }} autoFocus disabled={saving} />
    </>
  }

  return <>
    <SheetHeader title={picked.name} onClose={close} />
    <label className="measure-date">
      <span>{t('Amount')}</span>
      <NumberField value={amount} onChange={setAmount} aria-label={t('Amount')} />
    </label>
    <ChipRow role="radiogroup" aria-label={t('Unit')}>
      {unitsFor(picked).map(u => <Chip key={u} nocap on={u === unit} role="radio" aria-checked={u === unit} onClick={() => setUnit(u)}>{u}</Chip>)}
    </ChipRow>
    {ingredient
      ? <MealNutrition nutrition={ingredient.nutrition} settings={settings} />
      : <div className="small muted" role="status">{t('Enter an amount above 0.')}</div>}
    <SheetActions>
      <Button variant="primary" onClick={done} disabled={!ingredient}>{item ? t('Save') : t('Add')}</Button>
      {!item && <Button variant="ghost" onClick={() => setPicked(null)}>{t('Choose another food')}</Button>}
      {item && onRemove && <Button variant="ghost" onClick={remove}>{t('Remove {0}', item.name)}</Button>}
    </SheetActions>
  </>
}

/** Opens the sheet over the editor. */
export function ingredientSheet(props) {
  useUI.getState().openSheet(close => <IngredientSheet {...props} close={close} />)
}
