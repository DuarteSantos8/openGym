import { useEffect, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { isoOf, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { useDiarySelection, useDiaryTarget } from '../lib/nutrition/selection.js'
import { useDiaryDay } from '../lib/nutrition/use-diary-day.js'
import { useScrolledPast } from '../lib/use-scrolled-past.js'
import { EmptyState } from '../components/blocks.jsx'
import { Page } from '../components/layout.jsx'
import { LineArt } from '../components/line-art.jsx'
import { SectionHeader, TabSection } from '../components/tab-kit.jsx'
import DayNav from '../components/DayNav.jsx'
import KcalLeftButton from '../components/KcalLeftButton.jsx'
import NutritionHero from '../components/NutritionHero.jsx'
import NutritionMacros from '../components/NutritionMacros.jsx'
import NutritionActions from '../components/NutritionActions.jsx'
import MealsCard from '../components/MealsCard.jsx'
import TodayFastRow from '../components/TodayFastRow.jsx'
import WaterCard from '../components/WaterCard.jsx'
import NutritionLibrary from '../components/NutritionLibrary.jsx'

// The pinned tab-root header (--hdr-h): the hero counts as gone once it passes under it (the hook
// adds the safe-area inset the header sits below).
const HEADER_PX = 56

// "2026-10-13" and a real day.
const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && isoOf(new Date(s + 'T12:00:00')) === s

// The Nutrition tab's root (ux-redesign-tabs §4.2, Owner decision 9): the month and week on the
// date every tab shares (a day to come is dimmed), the energy left as the hero, the action row,
// the macros, then the diary for that day (the meals with their items, yesterday's meal inside
// the empty one it matches, activity, the running fast and water) and the Library list. Once the
// hero scrolls away, "N left" takes the header's context slot and scrolls back to the top. Without
// nutrition (the phone build, a guest) it is one empty state.
// `/food?date=YYYY-MM-DD` opens it on that day (today or before; a day to come is today).
export default function FoodHub() {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const { date } = useDiaryTarget(null)
  const day = useDiaryDay(date)
  const { meal } = useDiaryTarget(day.settings)
  const [heroRef, heroGone] = useScrolledPast(HEADER_PX)
  const isToday = date === todayISO()

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

  if (!day.on) {
    return <Page root title={t('Nutrition')}>
      <EmptyState art={<LineArt scene="plate" />} title={t('Nutrition lives in the web app')}>
        {t('Sign in on the web app to log food and see your day here.')}
      </EmptyState>
    </Page>
  }

  return <Page root title={t('Nutrition')} action={heroGone && day.status === 'ready' ? <KcalLeftButton left={day.left} /> : undefined}>
    <DayNav future="off" />
    <TabSection><NutritionHero date={date} day={day} ref={heroRef} /></TabSection>
    <TabSection><NutritionActions date={date} day={day} /></TabSection>
    {day.status !== 'error' && <TabSection><NutritionMacros day={day} /></TabSection>}
    <TabSection>
      <SectionHeader title={isToday ? t('Today’s diary') : t('Diary')} />
      <MealsCard date={date} day={day} find={find && (!find.date || find.date === date) ? find.uuid : null} again={isToday ? meal : null} />
      {isToday && <TodayFastRow />}
      <WaterCard date={date} water={day.water} ready={day.dayReady} />
    </TabSection>
    <TabSection><NutritionLibrary day={day} /></TabSection>
  </Page>
}
