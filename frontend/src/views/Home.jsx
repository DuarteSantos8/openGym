import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { streakWeeks } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t, tn, dateLocale } from '../lib/i18n.js'
import { BRAND } from '../brand.js'
import { calendarSheet, starterPlanSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Page, Inline, Spacer } from '../components/layout.jsx'
import { Card } from '../components/blocks.jsx'
import TodayCard from '../components/TodayCard.jsx'
import DaySessionCard from '../components/DaySessionCard.jsx'
import DiaryDateStrip from '../components/DiaryDateStrip.jsx'
import CaloriesCard from '../components/CaloriesCard.jsx'
import WaterCard from '../components/WaterCard.jsx'
import MealsCard from '../components/MealsCard.jsx'
import WeightCard from '../components/WeightCard.jsx'
import { weekTally } from '../lib/queue.js'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { useDiaryTarget } from '../lib/nutrition/selection.js'
import { useDiaryDay } from '../lib/nutrition/use-diary-day.js'
import { useScrolledPast } from '../lib/use-scrolled-past.js'

// The sticky date strip's height: the calories card counts as gone once it passes under it
// (the hook adds the safe-area inset the strip sits below).
const STRIP_PX = 52

// Home is the day (ia-proposal §2): a date strip, the day's session, then the diary (energy and
// macros, water, meals with their activity), weight and the week. On a day other than today
// every card shows that day and logs go to it.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { date } = useDiaryTarget(null)
  const day = useDiaryDay(date)
  const isToday = date === todayISO()
  const [kcalRef, kcalGone] = useScrolledPast(STRIP_PX)

  const { done: doneThisWeek, planned: plannedPerWeek } = weekTally(S, todayISO())

  return <Page root title={user ? t('Hi {0}', user.name) : BRAND.name}
    sub={new Date().toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}>

    <DiaryDateStrip date={date} left={day.on && kcalGone && day.status === 'ready' ? day.left : null} />

    {isToday ? <TodayCard fasting /> : <DaySessionCard date={date} />}

    {/* Jump to the gym check-in cards (QR membership codes). Shown here as a quick tap on
        arrival at the gym; folds away per user via the "Gym check-in" switch in Settings. */}
    {isToday && S.checkIn !== false && (
      <Card className="tappable home-tap" {...tappable(() => nav('/train/checkin'))}>
        <Inline justify="between">
          <Inline gap={4}>
            <span className="lrow-i tint-blue"><Icon name="qr" /></span>
            <div>
              <div className="lbl2">{t('At the gym')}</div>
              <div className="ttl">{t('Check in')}</div>
            </div>
          </Inline>
          <Icon name="chevronRight" className="chev" />
        </Inline>
      </Card>
    )}

    {!S.routines.length && !S.active && (
      <Card>
        <Inline gap={5} className="mb-3">
          <span className="lrow-i"><Icon name="calendar" /></span>
          <div className="fs-title2 fw-semibold">{t('Welcome!')}</div>
        </Inline>
        <div className="muted small mb-6">{t('Set up your weekly routine to get going, or grab a ready-made starter plan.')}</div>
        <Button variant="primary" icon="clipboard" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <Spacer size={4} /><Button onClick={() => nav('/train/routines')}>{t('Build my own plan')}</Button>
      </Card>
    )}

    {day.on && <>
      <CaloriesCard ref={kcalRef} day={day} />
      <WaterCard date={date} water={day.water} ready={day.dayReady} />
      <MealsCard date={date} day={day} />
    </>}

    {S.showWeightCard !== false && <WeightCard date={date} />}

    <Card className="tappable home-tap" {...tappable(() => calendarSheet())}>
      <Inline justify="between">
        <div>
          <Inline gap={3} className="fs-title2 fw-semibold home-streak">
            <Icon name="calendarCheck" className="ink-orange" />
            {t('{0} week streak', streakWeeks(S))}
          </Inline>
          <div className="muted small mt-1">{doneThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {tn('{0} workout total', '{0} workouts total', S.workouts.length)}</div>
        </div>
        <Icon name="calendar" className="chev fs-title3" />
      </Inline>
    </Card>
  </Page>
}
