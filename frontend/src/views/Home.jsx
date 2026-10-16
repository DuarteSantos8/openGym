import { useStore } from '../store/useStore.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { useDiaryTarget } from '../lib/nutrition/selection.js'
import { useDiaryDay } from '../lib/nutrition/use-diary-day.js'
import { Page } from '../components/layout.jsx'
import { TabSection } from '../components/tab-kit.jsx'
import DayNav from '../components/DayNav.jsx'
import HomeHero from '../components/HomeHero.jsx'
import HomeActions from '../components/HomeActions.jsx'
import TodayFastRow from '../components/TodayFastRow.jsx'
import YesterdayMealRow from '../components/YesterdayMealRow.jsx'
import MealPills from '../components/MealPills.jsx'
import HomeWeek from '../components/HomeWeek.jsx'
import WeightCard from '../components/WeightCard.jsx'

// Home is the hub (redesign-native, Owner decision 2; ux-redesign-tabs §1): the selected day at a
// glance and the next thing to log in a tap or two, across training and food. The month and week
// pick the day every tab shares; the hero says how it is going; the action row does the most-used
// things; then what is live right now, the day's meals as pills (the diary is on Nutrition), the
// week and body weight. Every block below the date is a TabSection: the rhythm is the shell's.
export default function Home() {
  const S = useStore(s => s.S)
  const { date } = useDiaryTarget(null)
  const day = useDiaryDay(date)
  const isToday = date === todayISO()
  const { meal } = useDiaryTarget(day.settings)

  return <Page root title={t('Home')}>
    <DayNav />
    <TabSection><HomeHero date={date} day={day} /></TabSection>
    <TabSection><HomeActions date={date} day={day} /></TabSection>
    {/* Only what is true right now: the running fast, yesterday's meal while today's is empty. */}
    <TabSection>
      {day.on && <>
        <TodayFastRow />
        {isToday && <YesterdayMealRow settings={day.settings} meal={meal} whileEmpty />}
      </>}
    </TabSection>
    {day.on && <TabSection><MealPills date={date} day={day} /></TabSection>}
    <TabSection><HomeWeek /></TabSection>
    {S.showWeightCard !== false && <TabSection><WeightCard date={date} /></TabSection>}
  </Page>
}
