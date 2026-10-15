import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { energyOf, matchesFood } from '../lib/nutrition/diary.js'
import { asksQuantity } from '../lib/nutrition/log-serving.js'
import { toastLogged, writeErrorText } from '../lib/nutrition/log-feedback.js'
import { mealDraft, mealKcal, mealLoadErrorText } from '../lib/nutrition/meals.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { Tag, ItemRow, SectionTitle } from './blocks.jsx'
import { recipeServingsSheet } from './RecipeServingsSheet.jsx'
import { Button } from './ui.jsx'

const SHOWN = 8

// The "Saved meals" group of the Log food picker: your saved meals and recipes, to log to
// `date`/`meal` the way the meal's own sheet does (store.logMeal). A saved meal expands to its
// ingredients at their saved amounts in one tap, with no prompt, as NutriTrace does. A recipe asks
// for the servings eaten, or logs one when Profile › Diary & meals › Ask for quantity is off
// (Foods.svelte). A draft is kept per meal, slot and servings until it is logged, so a tap after a
// failed write sends the same entries and a save whose answer was lost is not logged twice.
export default function SavedMealsGroup({ query, date, meal: slot, mealName, onLogged }) {
  const meals = useNutrition(s => s.meals)
  const recipes = useNutrition(s => s.recipes)
  const settings = useNutrition(s => s.settings.data)
  const [limit, setLimit] = useState(SHOWN)
  const [busy, setBusy] = useState(false)
  const drafts = useRef(new Map()).current
  const working = useRef(false)

  useEffect(() => {
    const n = useNutrition.getState()
    n.loadMeals({ recipes: false })
    n.loadMeals({ recipes: true })
  }, [])

  const all = [...meals.list, ...recipes.list].filter(m => !query || matchesFood(m, query))
  const failed = (meals.status === 'error' && !meals.list.length) || (recipes.status === 'error' && !recipes.list.length)
  if (!all.length && !failed) return null

  /** @returns {Promise<boolean>} whether it was logged; a failure is a toast. */
  async function log(entry, servings = 1) {
    if (working.current) return false
    working.current = true
    setBusy(true)
    const key = `${entry.is_recipe ? 'r' : 'm'}${entry.id}|${date}|${slot}|${servings}`
    try {
      if (!drafts.has(key)) drafts.set(key, mealDraft(entry, { slot, servings }))
      const items = await useNutrition.getState().logMeal(date, drafts.get(key))
      drafts.delete(key)
      if (onLogged) onLogged()
      toastLogged(t('Logged to {0}', mealName), () => useNutrition.getState().removeItems(date, items.map(i => i.uuid)))
      return true
    } catch (e) {
      if (e?.code === 'invalid') drafts.delete(key)
      useUI.getState().toast(e?.code === 'invalid' ? t('This meal has no ingredients to log.') : writeErrorText(e))
      return false
    } finally {
      working.current = false
      setBusy(false)
    }
  }

  const pick = entry => {
    if (working.current) return
    if (entry.is_recipe && asksQuantity(settings)) recipeServingsSheet({ recipe: entry, mealName, onLog: servings => log(entry, servings) })
    else log(entry)
  }

  const row = entry => {
    const kcal = energyOf(mealKcal(entry), settings)
    const sub = entry.is_recipe ? t('Recipe · 1 serving') : tn('{0} ingredient', '{0} ingredients', entry.items?.length || 0)
    return <ItemRow key={`${entry.is_recipe ? 'r' : 'm'}${entry.id}`} className="food-row" title={entry.name} subtitle={sub}
      trailing={<Tag>{kcal.value} {kcal.unit}</Tag>} onOpen={() => pick(entry)}
      openProps={{ 'aria-busy': busy || undefined, 'aria-disabled': busy || undefined }} />
  }

  return <>
    <SectionTitle>{t('Saved meals')}</SectionTitle>
    {failed && !all.length
      ? <>
        <div className="nt-error small" role="alert">{mealLoadErrorText(meals.status === 'error' ? meals.error : recipes.error)}</div>
        <Button size="sm" variant="tinted" onClick={() => { const n = useNutrition.getState(); n.loadMeals({ recipes: false, force: true }); n.loadMeals({ recipes: true, force: true }) }}>{t('Try again')}</Button>
      </>
      : <div className="list">{all.slice(0, limit).map(row)}</div>}
    {all.length > limit && <Button size="sm" variant="tinted" onClick={() => setLimit(n => n + SHOWN)}>{t('Show more')}</Button>}
  </>
}
