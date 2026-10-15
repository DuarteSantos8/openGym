import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { todayISO } from '../lib/format.js'
import { dateLocale, t, tn } from '../lib/i18n.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useDiarySelection, useDiaryTarget } from '../lib/nutrition/selection.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiaryDay } from '../lib/nutrition/use-diary-day.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { Card, EmptyState, Stat, StatTile, Tiles } from '../components/blocks.jsx'
import { Inline, Page } from '../components/layout.jsx'
import YesterdayMealRow from '../components/YesterdayMealRow.jsx'
import { Button } from '../components/ui.jsx'

const grams = n => Math.round(n || 0).toLocaleString(dateLocale())

const MACROS = [
  { id: 'proteins', label: () => t('Protein') },
  { id: 'carbohydrates', label: () => t('Carbs') },
  { id: 'fat', label: () => t('Fat') },
]

// The Nutrition tab's root: today in one card (it opens the diary on Home), yesterday's meal to
// log again, and the places nutrition lives. A place gets a tile when its page exists.
export default function FoodHub() {
  const nav = useNavigate()
  const { on, status, settings, totals, target, macros, left, reload } = useDiaryDay(todayISO())
  const units = useUnits()
  const foods = useNutrition(s => s.foods)
  const meals = useNutrition(s => s.meals)
  const recipes = useNutrition(s => s.recipes)
  const { meal } = useDiaryTarget(settings)

  useEffect(() => {
    if (!on) return
    const n = useNutrition.getState()
    n.loadFoods()
    n.loadMeals({ recipes: false })
    n.loadMeals({ recipes: true })
  }, [on])

  if (!on) {
    return <Page root title={t('Nutrition')}>
      <Card>
        <EmptyState icon="utensils" title={t('Nutrition lives in the web app')}>{t('Sign in on the web app to log food and see your day here.')}</EmptyState>
      </Card>
    </Page>
  }

  // One entry per page that exists.
  const targets = [
    { path: '/food/foods', icon: 'apple', title: t('Foods'), sub: foods.status === 'ready' ? tn('{0} food', '{0} foods', foods.list.length) : t('Your own foods') },
    { path: '/food/meals', icon: 'bookOpen', title: t('Saved meals'), sub: meals.status === 'ready' ? tn('{0} meal', '{0} meals', meals.list.length) : t('Loading…') },
    { path: '/food/recipes', icon: 'cookingPot', title: t('Recipes'), sub: recipes.status === 'ready' ? tn('{0} recipe', '{0} recipes', recipes.list.length) : t('Loading…') },
    { path: '/food/goals', icon: 'target', title: t('Goals'), sub: status === 'ready' ? units.energy(target.base) : t('Daily target') },
  ]

  // The card says today, so it opens Home on today, whichever date Home was left on.
  const openToday = () => {
    useDiarySelection.getState().setDate(null)
    nav('/home')
  }

  return <Page root title={t('Nutrition')}>
    {status === 'error'
      ? <Card>
        <div className="small muted" role="alert">{t('Today’s diary did not load.')}</div>
        <Button size="sm" variant="tinted" className="mt-4" onClick={reload}>{t('Try again')}</Button>
      </Card>
      : <Card {...tappable(openToday)}>
        {status === 'ready' ? <>
          <Stat value={units.energyValue(Math.abs(left))} />
          <div className="small muted">{left >= 0 ? t('{0} left today', units.energyUnit) : t('{0} over today', units.energyUnit)}</div>
          <Inline gap={10} className="mt-6">
            {MACROS.map(m => {
              const eaten = grams(totals[m.id])
              const goal = macros[m.id]
              return <div key={m.id} className="small">
                <div className="muted">{m.label()}</div>
                <b>{goal != null ? t('{0} of {1} g', eaten, grams(goal)) : t('{0} g', eaten)}</b>
              </div>
            })}
          </Inline>
        </> : <div className="small muted" role="status">{t('Loading…')}</div>}
      </Card>}
    <YesterdayMealRow settings={settings} meal={meal} />
    <Tiles className="hub-tiles">
      {targets.map(x => <StatTile key={x.path} className="hub-tile" icon={x.icon} label={x.title} value={x.sub} onClick={() => nav(x.path)} />)}
    </Tiles>
  </Page>
}
