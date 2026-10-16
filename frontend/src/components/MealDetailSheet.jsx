import { useEffect, useMemo, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { fmtDate } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { energyOf, nutritionOf } from '../lib/nutrition/diary.js'
import { toastLogged, writeErrorText } from '../lib/nutrition/log-feedback.js'
import { mealLabels } from '../lib/nutrition/meal-name.js'
import { amountOf, mealDraft, servingsOf, totalOf } from '../lib/nutrition/meals.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { confirmSheet } from '../sheets.jsx'
import MealNutrition from './MealNutrition.jsx'
import { mealEditSheet } from './MealEditSheet.jsx'
import { EmptyState, ItemRow, SectionTitle, Tag } from './blocks.jsx'
import { SheetActions, SheetHeader } from './sheet-layout.jsx'
import { Button, NumberField, Row, Section } from './ui.jsx'
import { Loading } from './Loader.jsx'

const toast = m => useUI.getState().toast(m)

// A saved meal or recipe: what is in it, and Log. The settings (energy unit, meal names) are read
// live, and the date and meal are the ones the diary has selected, taken once the settings are in
// so the meal count is right and the button says what it logs to. The log is built once per
// amount: Log again after a failure sends the same entries, so a save whose answer was lost does
// not log twice, and a meal's entries go in one diary write, all or none. Reads the meal from the
// store, so an edit shows here at once.
export function MealDetailSheet({ id, recipe, close }) {
  const meal = useNutrition(s => (recipe ? s.recipes : s.meals).list.find(m => m.id === id))
  const settings = useNutrition(s => s.settings.data)
  const settingsStatus = useNutrition(s => s.settings.status)
  const [target, setTarget] = useState(null)
  const [servings, setServings] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const settled = settingsStatus === 'ready' || settingsStatus === 'error'

  useEffect(() => { useNutrition.getState().loadSettings() }, [])
  useEffect(() => { if (settled && !target) setTarget(useDiarySelection.getState().target(settings)) }, [settled, target, settings])

  // Deleted from here (or by a sync): nothing left to show.
  useEffect(() => { if (!meal) close() }, [meal, close])

  const labels = mealLabels(settings)
  const slot = target && target.meal < labels.length ? target.meal : 0
  const draft = useMemo(() => {
    if (!meal || !target) return null
    try { return mealDraft(meal, { slot, servings }) } catch { return null }
  }, [meal, target, slot, servings])

  if (!meal) return null

  const where = labels[slot]
  const per = recipe ? nutritionOf({ nutrition: meal.nutrition }) : totalOf(meal.items)
  const eatenKcal = energyOf(Math.round((per.calories || 0) * (Number(servings) || 0)), settings)

  async function log() {
    if (!draft || busy) return
    setBusy(true)
    setError('')
    try {
      const items = await useNutrition.getState().logMeal(target.date, draft)
      close()
      toastLogged(t('Logged to {0}', where), () => useNutrition.getState().removeItems(target.date, items.map(i => i.uuid)))
    } catch (e) {
      setError(writeErrorText(e))
      setBusy(false)
    }
  }

  function remove() {
    confirmSheet({
      title: recipe ? t('Delete this recipe?') : t('Delete this meal?'),
      message: t('“{0}” is removed. Days you already logged it to keep it.', meal.name),
      confirmText: t('Delete'),
      danger: true,
      onConfirm: async () => {
        try {
          await useNutrition.getState().deleteMeal(meal.id)
          toast(recipe ? t('Recipe deleted') : t('Meal deleted'))
        } catch (e) {
          toast(writeErrorText(e))
        }
      },
    })
  }

  const sub = recipe
    ? [tn('{0} serving', '{0} servings', servingsOf(meal)), `${Math.round((Number(meal.portion) || 0) * 10) / 10} ${meal.unit || 'g'}`].join(' · ')
    : tn('{0} ingredient', '{0} ingredients', meal.items.length)
  return <>
    <SheetHeader title={meal.name} sub={sub} onClose={close} />
    <MealNutrition nutrition={per} settings={settings} label={recipe ? t('Per serving') : t('Total')} />
    {meal.items.length > 0 && <>
      <SectionTitle>{t('Ingredients')}</SectionTitle>
      <div className="list">
        {meal.items.map((item, i) => {
          const kcal = energyOf(nutritionOf(item).calories || 0, settings)
          return <ItemRow key={i} title={item.name} subtitle={amountOf(item)} trailing={<Tag>{Math.round(kcal.value)} {kcal.unit}</Tag>} />
        })}
      </div>
    </>}
    {meal.notes && <div className="small muted">{meal.notes}</div>}
    <SectionTitle>{t('Log')}</SectionTitle>
    {!target
      ? <EmptyState><Loading /></EmptyState>
      : <div className="small muted">{t('Logging to {0} · {1}', where, fmtDate(target.date, true))}</div>}
    {recipe && <label className="measure-date">
      <span>{t('Servings eaten')}</span>
      <NumberField value={servings} onChange={setServings} aria-label={t('Servings eaten')} />
    </label>}
    {target && !draft && <div className="small muted" role="status">{recipe ? t('Enter servings above 0.') : t('This meal has no ingredients to log.')}</div>}
    {draft && recipe && <div className="small muted">{t('{0} in total', `${eatenKcal.value} ${eatenKcal.unit}`)}</div>}
    {error && <div className="small muted" role="alert">{error}</div>}
    <SheetActions>
      <Button variant="primary" onClick={log} disabled={!draft || busy}>{busy ? t('Saving…') : target ? t('Log to {0}', where) : t('Log')}</Button>
    </SheetActions>
    <Section>
      <Row icon="pencil" title={t('Edit')} onClick={() => mealEditSheet({ meal, recipe })} />
      <Row icon="trash" title={t('Delete {0}', meal.name)} danger onClick={remove} />
    </Section>
  </>
}

/** Opens the sheet over the page. */
export function mealDetailSheet(props) {
  useUI.getState().openSheet(close => <MealDetailSheet {...props} close={close} />)
}
