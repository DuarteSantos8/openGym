import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { fmtDur, isoOf, todayISO } from '../lib/format.js'
import { t, tn } from '../lib/i18n.js'
import { useDiarySelection, useDiaryTarget } from '../lib/nutrition/selection.js'
import { progressOf } from '../lib/nutrition/fasting.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useFasting, useNow } from '../lib/nutrition/use-fasting.js'
import { useDiaryDay } from '../lib/nutrition/use-diary-day.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { useScrolledPast } from '../lib/use-scrolled-past.js'
import { Card, EmptyState, StatTile, Tiles } from '../components/blocks.jsx'
import { Page } from '../components/layout.jsx'
import { SectionHeader, TabSection } from '../components/tab-kit.jsx'
import DayNav from '../components/DayNav.jsx'
import KcalLeftBar from '../components/KcalLeftBar.jsx'
import CaloriesCard from '../components/CaloriesCard.jsx'
import WaterCard from '../components/WaterCard.jsx'
import MealsCard from '../components/MealsCard.jsx'
import YesterdayMealRow from '../components/YesterdayMealRow.jsx'

// The pinned tab-root header (--hdr-h): the calories card counts as gone once it passes under it
// (the hook adds the safe-area inset the header sits below).
const HEADER_PX = 56

// "2026-10-13" and a real day.
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(new Date(s + 'T12:00:00')) === s

// The Nutrition tab's root: the diary for the day every tab shares (ux-redesign-tabs §4.2) —
// energy and macros, water, the meals with their items and activity, yesterday's meal to log
// again — then the places nutrition lives. A place gets a tile when its page exists.
// `/food?date=YYYY-MM-DD` opens it on that day (today or before; a day to come is today).
export default function FoodHub() {
  const nav = useNavigate()
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { date } = useDiaryTarget(null)
  const day = useDiaryDay(date)
  const { on, status, settings, target, left } = day
  const units = useUnits()
  const foods = useNutrition(s => s.foods)
  const meals = useNutrition(s => s.meals)
  const recipes = useNutrition(s => s.recipes)
  const { meal } = useDiaryTarget(settings)
  const [kcalRef, kcalGone] = useScrolledPast(HEADER_PX)

  const fastingOn = on && settings?.fastingEnabled === true
  const fasting = useFasting()
  const now = useNow(!!fasting.active, 30_000)

  // The deep link picks the day once, then leaves the address as the tab's own. `find` (a search's
  // Day result, `?date=&find=<uuid>`) is kept for that day: its meal opens and the entry flashes
  // once the day has loaded. The router state goes along with the replace: a search visit's
  // `searchVisit` is what keeps this page on the stack of the tab it was opened from, and the
  // date picked is the visit's, put back when it ends (lib/search/session.js).
  const linked = params.get('date')
  const findParam = params.get('find')
  const [find, setFind] = useState(null)
  useEffect(() => {
    if (linked == null && findParam == null) return
    if (linked != null && isDay(linked)) useDiarySelection.getState().setDate(linked)
    setFind(findParam ? { date: linked != null && isDay(linked) ? linked : null, uuid: findParam } : null)
    setParams({}, { replace: true, state: location.state })
  }, [linked, findParam, setParams, location.state])

  useEffect(() => {
    if (!on) return
    const n = useNutrition.getState()
    n.loadFoods()
    n.loadMeals({ recipes: false })
    n.loadMeals({ recipes: true })
  }, [on])
  useEffect(() => {
    if (fastingOn) useFasting.getState().load()
  }, [fastingOn])

  if (!on) {
    return <Page root title={t('Nutrition')}>
      <Card>
        <EmptyState icon="utensils" title={t('Nutrition lives in the web app')}>{t('Sign in on the web app to log food and see your day here.')}</EmptyState>
      </Card>
    </Page>
  }

  const fastingSub = !settings ? t('Loading…')
    : !fastingOn ? t('Off')
    : fasting.active ? fmtDur(progressOf(fasting.active, now).elapsedMs) : t('Start a fast')

  // One entry per page that exists.
  const targets = [
    { path: '/food/foods', icon: 'apple', title: t('Foods'), sub: foods.status === 'ready' ? tn('{0} food', '{0} foods', foods.list.length) : t('Your own foods') },
    { path: '/food/meals', icon: 'bookOpen', title: t('Saved meals'), sub: meals.status === 'ready' ? tn('{0} meal', '{0} meals', meals.list.length) : t('Loading…') },
    { path: '/food/recipes', icon: 'cookingPot', title: t('Recipes'), sub: recipes.status === 'ready' ? tn('{0} recipe', '{0} recipes', recipes.list.length) : t('Loading…') },
    { path: '/food/goals', icon: 'target', title: t('Goals'), sub: status === 'ready' ? units.energy(target.base) : t('Daily target') },
    // Always there: the Fasting page is where fasting is switched on, so the way in cannot depend on it.
    { path: '/food/fasting', icon: 'timer', title: t('Fasting'), sub: fastingSub },
  ]

  return <Page root title={t('Nutrition')}>
    <DayNav future="off" />
    <KcalLeftBar left={kcalGone && status === 'ready' ? left : null} />
    <TabSection>
      <SectionHeader title={date === todayISO() ? t('Today’s diary') : t('Diary')} />
      <CaloriesCard ref={kcalRef} day={day} />
      <WaterCard date={date} water={day.water} ready={day.dayReady} />
      <MealsCard date={date} day={day} find={find && (!find.date || find.date === date) ? find.uuid : null} />
      {date === todayISO() && <YesterdayMealRow settings={settings} meal={meal} />}
    </TabSection>
    <Tiles className="hub-tiles">
      {targets.map(x => <StatTile key={x.path} className="hub-tile" icon={x.icon} label={x.title} value={x.sub} onClick={() => nav(x.path)} />)}
    </Tiles>
  </Page>
}
