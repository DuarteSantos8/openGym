import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtDur } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { progressOf } from '../lib/nutrition/fasting.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useFasting, useNow } from '../lib/nutrition/use-fasting.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { SectionHeader } from './tab-kit.jsx'
import { Row, Section } from './ui.jsx'

// The places nutrition lives, under the diary (Owner decision 9: no Diary/Recipes switch, so this
// list is the way into Recipes): Foods, Saved meals, Recipes, Goals and Fasting, each with what
// it holds. Fasting is always there: its page is where fasting is switched on. `day` is
// useDiaryDay's.
export default function NutritionLibrary({ day }) {
  const nav = useNavigate()
  const units = useUnits()
  const foods = useNutrition(s => s.foods)
  const meals = useNutrition(s => s.meals)
  const recipes = useNutrition(s => s.recipes)
  const { settings, status, target } = day
  const fastingOn = settings?.fastingEnabled === true
  const fasting = useFasting()
  const now = useNow(!!fasting.active, 30_000)

  useEffect(() => {
    const n = useNutrition.getState()
    n.loadFoods()
    n.loadMeals({ recipes: false })
    n.loadMeals({ recipes: true })
  }, [])
  useEffect(() => {
    if (fastingOn) useFasting.getState().load()
  }, [fastingOn])

  const fastingSub = !settings ? t('Loading…')
    : !fastingOn ? t('Off')
    : fasting.active ? fmtDur(progressOf(fasting.active, now).elapsedMs) : t('Start a fast')
  const rows = [
    { path: '/food/foods', glyph: 'apple', title: t('Foods'), sub: foods.status === 'ready' ? tn('{0} food', '{0} foods', foods.list.length) : t('Your own foods') },
    { path: '/food/meals', glyph: 'bookOpen', title: t('Saved meals'), sub: meals.status === 'ready' ? tn('{0} meal', '{0} meals', meals.list.length) : t('Loading…') },
    { path: '/food/recipes', glyph: 'cookingPot', title: t('Recipes'), sub: recipes.status === 'ready' ? tn('{0} recipe', '{0} recipes', recipes.list.length) : t('Loading…') },
    { path: '/food/goals', glyph: 'target', title: t('Goals'), sub: status === 'ready' ? units.energy(target.base) : t('Daily target') },
    { path: '/food/fasting', glyph: 'timer', title: t('Fasting'), sub: fastingSub },
  ]
  return <>
    <SectionHeader title={t('Library')} />
    <Section>
      {rows.map(r => <Row key={r.path} glyph={r.glyph} title={r.title} subtitle={r.sub} accessory="chevron" onClick={() => nav(r.path)} />)}
    </Section>
  </>
}
