import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { coachAvailable } from '../lib/coach.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { useDiaryTarget } from '../lib/nutrition/selection.js'
import { Page } from '../components/layout.jsx'
import { SectionHeader, TabSection } from '../components/tab-kit.jsx'
import DayNav from '../components/DayNav.jsx'
import TrainingHero from '../components/TrainingHero.jsx'
import TrainActions from '../components/TrainActions.jsx'
import TrainPlan from '../components/TrainPlan.jsx'
import TrainRoutines from '../components/TrainRoutines.jsx'
import { Row, Section } from '../components/ui.jsx'

// The Training tab's root (ux-redesign-tabs §4.1): the month and week on the date every tab
// shares, the day's session, the action row, this week's plan, the first routines and freestyle,
// then the places that are not training itself. Schedule, Routines and History stay pages of
// their own, reached from Your plan's Edit, Routines' See all and the row.
export default function TrainHub() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const coachMode = useStore(s => s.coachLocal?.mode)
  const showCoach = coachAvailable(config, user, { demo: DEMO, mobile: MOBILE, coachMode })
  const { date } = useDiaryTarget(null)
  // The row's last slot is Check in when it is on, so Coach keeps its way in here.
  const coachRow = showCoach && S.checkIn !== false

  return <Page root title={t('Training')}>
    <DayNav />
    <TabSection><TrainingHero date={date} /></TabSection>
    <TabSection><TrainActions date={date} showCoach={showCoach} /></TabSection>
    {S.routines.length > 0 && <TabSection><TrainPlan /></TabSection>}
    <TabSection><TrainRoutines /></TabSection>
    <TabSection>
      <SectionHeader title={t('More')} />
      <Section>
        {coachRow && <Row glyph="chat" title={t('Coach')} accessory="chevron" onClick={() => nav('/train/coach')} />}
        <Row glyph="kettlebell" title={t('Equipment')} accessory="chevron" onClick={() => nav('/me/equipment')} />
        <Row glyph="gear" title={t('Training settings')} accessory="chevron" onClick={() => nav('/me/workout')} />
      </Section>
    </TabSection>
  </Page>
}
