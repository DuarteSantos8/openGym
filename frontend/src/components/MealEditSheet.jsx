import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { energyOf, newUuid, nutritionOf } from '../lib/nutrition/diary.js'
import { writeErrorText } from '../lib/nutrition/log-feedback.js'
import { amountOf, formOf, mealOf, problemText, totalOf, withItems } from '../lib/nutrition/meals.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { confirmSheet } from '../sheets.jsx'
import { ItemRow, SectionTitle, Tag } from './blocks.jsx'
import { ingredientSheet } from './IngredientSheet.jsx'
import MealNutrition from './MealNutrition.jsx'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, TextArea, TextField } from './ui.jsx'

const toast = (m, opts) => useUI.getState().toast(m, opts)

// Create (no `meal`) or edit a saved meal or recipe. Nothing is sent until Save; a failed save keeps
// everything typed. A new one carries one key for as long as the sheet is open, so a retry after a
// lost answer saves it once. A recipe's total weight follows its ingredients until you type it.
// Tapping an ingredient changes its amount or takes it out (Undo brings it back). The sheet opens
// locked, so a tap outside, a swipe, Escape or back cannot lose what was typed: closing it asks
// first when there is something to lose. An edit sends only what changed (meals.js mealOf).
export function MealEditSheet({ meal = null, recipe, close }) {
  const editing = typeof meal?.id === 'number'
  const settings = useNutrition(s => s.settings.data)
  const [form, setForm] = useState(() => formOf(meal, { recipe }))
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const key = useRef(newUuid())
  const start = useRef(JSON.stringify(form))

  useEffect(() => { useNutrition.getState().loadSettings() }, [])

  const set = patch => setForm(f => ({ ...f, ...patch }))
  const setItems = change => setForm(f => withItems(f, change(f.items), { recipe }))
  const addIngredient = ingredient => setItems(items => [...items, ingredient])
  const changeIngredient = (i, ingredient) => setItems(items => items.map((x, j) => (j === i ? ingredient : x)))
  const removeIngredient = i => {
    const gone = form.items[i]
    setItems(items => items.filter((_, j) => j !== i))
    toast(t('Removed {0}', gone.name), {
      action: t('Undo'),
      onAction: () => setItems(items => [...items.slice(0, i), gone, ...items.slice(i)]),
    })
  }

  const servings = form.servings === '' && editing ? 1 : Number(form.servings)
  const perServing = recipe && Number.isInteger(servings) && servings >= 1
    ? Object.fromEntries(Object.entries(totalOf(form.items)).map(([k, v]) => [k, v / servings]))
    : null

  const cancel = () => {
    if (JSON.stringify(form) === start.current) { close(); return }
    confirmSheet({
      title: t('Discard changes?'),
      message: t('Your changes are not saved.'),
      confirmText: t('Discard'),
      cancelText: t('Keep editing'),
      danger: true,
      onConfirm: close,
    })
  }

  async function save() {
    if (busy) return
    const made = mealOf(form, { recipe, clientKey: editing ? null : key.current, original: editing ? meal : null })
    if (made.error) { setProblem(problemText(made.error)); return }
    setProblem('')
    if (editing && Object.keys(made.meal).length === 0) { close(); return }
    setBusy(true)
    try {
      await useNutrition.getState().saveMeal(editing ? { ...made.meal, id: meal.id } : made.meal)
      close()
      toast(recipe ? t('Recipe saved') : t('Meal saved'))
    } catch (e) {
      setProblem(writeErrorText(e))
      setBusy(false)
    }
  }

  const title = recipe ? (editing ? t('Edit recipe') : t('New recipe')) : (editing ? t('Edit meal') : t('New meal'))
  return <>
    <SheetHeader title={title} onClose={cancel} />
    <label className="measure-date">
      <span>{t('Name')}</span>
      <TextField value={form.name} maxLength={120} autoFocus={!editing} onChange={e => set({ name: e.target.value })} />
    </label>
    {recipe && <div className="measure-form">
      <label className="measure-field">
        <span>{t('Servings')}</span>
        <span className="measure-input">
          <input className="num" inputMode="numeric" placeholder="1" value={form.servings} onChange={e => set({ servings: e.target.value.replace(/\D/g, '') })} aria-label={t('Servings')} />
        </span>
      </label>
      <label className="measure-field">
        <span>{t('Total weight')}</span>
        <span className="measure-input">
          <input className="num" inputMode="decimal" value={form.amount} onChange={e => set({ amount: e.target.value, amountTyped: true })} aria-label={t('Total weight')} />
          <i>{form.unit}</i>
        </span>
      </label>
    </div>}
    <SectionTitle>{t('Ingredients')}</SectionTitle>
    {form.items.length > 0 && <div className="list">
      {form.items.map((item, i) => {
        const kcal = energyOf(nutritionOf(item).calories || 0, settings)
        return <ItemRow key={i} title={item.name} subtitle={amountOf(item)} trailing={<Tag>{Math.round(kcal.value)} {kcal.unit}</Tag>} chevron
          onClick={() => ingredientSheet({ item, onDone: x => changeIngredient(i, x), onRemove: () => removeIngredient(i) })} />
      })}
    </div>}
    <div className="measure-options">
      <Button size="sm" variant="tinted" icon="plus" onClick={() => ingredientSheet({ onDone: addIngredient })}>{t('Add ingredient')}</Button>
    </div>
    {form.items.length > 0 && <MealNutrition nutrition={recipe ? perServing : totalOf(form.items)} settings={settings} label={recipe ? t('Per serving') : t('Total')} />}
    <label className="measure-date">
      <span>{t('Notes')}</span>
      <TextArea value={form.notes} maxLength={500} onChange={e => set({ notes: e.target.value })} />
    </label>
    {problem && <div className="small muted" role="alert">{problem}</div>}
    <SheetActions>
      <Button variant="primary" onClick={save} disabled={busy}>{busy ? t('Saving…') : t('Save')}</Button>
    </SheetActions>
  </>
}

/** Opens the editor over the page. */
export function mealEditSheet(opts) {
  useUI.getState().openSheet(close => <MealEditSheet {...opts} close={close} />, { locked: true })
}
