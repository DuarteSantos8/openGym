import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { workoutDay } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { hasEffort, hasEstimableEffort } from '../lib/effort.js'
import { loadOfWeeklyPlan } from '../lib/muscles.js'
import { calendarSheet, dayOverrideSheet, workoutDetailSheet } from '../sheets.jsx'
import { Page } from '../components/layout.jsx'
import { Card, EmptyState } from '../components/blocks.jsx'
import Heatmap from '../components/Heatmap.jsx'
import Icon from '../components/Icon.jsx'
import EffortCard from '../components/EffortCard.jsx'
import MuscleBalance from '../components/MuscleBalance.jsx'
import WeeklyPlanVolume from '../components/WeeklyPlanVolume.jsx'
import { TabSection } from '../components/tab-kit.jsx'
import { Segmented } from '../components/ui.jsx'

const LEGACY_FOCUS = 'weekly-volume'

// Progress › Training load (ux-redesign-tabs §4.3, ui-redesign-components §4): Activity (the year's
// heatmap), Muscles (the muscle maps), Plan (the weekly volume the plan programs) and, once there
// is effort to read, Effort. The calendar is the page action.
//
// Deep link: /progress/load?view=activity|muscles|plan|effort opens on that segment; a segment is
// switched in place (replace), so back goes to Progress. Plan's old link, ?focus=weekly-volume,
// lands on view=plan. Without ?view= (or with one not offered) it opens on Activity.
export default function TrainingLoad() {
  const nav = useNavigate()
  const { search } = useLocation()
  const S = useStore(s => s.S)
  const workouts = S.workouts
  const focus = new URLSearchParams(search).get('focus') === LEGACY_FOCUS
  const [asked, setAsked] = useState(() => (focus ? 'plan' : new URLSearchParams(search).get('view')))
  const views = [
    { value: 'activity', label: t('Activity') },
    { value: 'muscles', label: t('Muscles') },
    { value: 'plan', label: t('Plan') },
  ]
  if (hasEffort(S) || hasEstimableEffort(S)) views.push({ value: 'effort', label: t('Effort (short)'), ariaLabel: t('Effort') })
  const view = views.some(v => v.value === asked) ? asked : 'activity'

  const go = value => {
    setAsked(value)
    const q = new URLSearchParams(search)
    q.delete('focus')
    q.set('view', value)
    nav('/progress/load?' + q, { replace: true })
  }
  useEffect(() => { if (focus) go('plan') }, [])

  const calendar = <button type="button" className="iconbtn" aria-label={t('Calendar')} onClick={() => calendarSheet(todayISO())}><Icon name="calendar" /></button>
  const hasMuscles = workouts.length > 0 || Object.keys(loadOfWeeklyPlan(S)).length > 0

  return <Page title={t('Training load')} action={calendar}>
    <TabSection>
      <Segmented tone="strong" size="lg" ariaLabel={t('Training load')} value={view} onChange={go} options={views} />
    </TabSection>
    {view === 'activity' && <Card title={t('Activity (last 12 months)')}>
      <Heatmap
        S={S}
        metric={S.heatmapMetric === 'vol' ? 'vol' : 'time'}
        onMetricChange={metric => useStore.getState().update(s => { s.heatmapMetric = metric })}
        onDay={iso => { const ws = workouts.filter(w => workoutDay(w) === iso); if (ws.length === 1) workoutDetailSheet(ws[0]); else if (ws.length) calendarSheet(iso); else dayOverrideSheet(iso) }}
      />
    </Card>}
    {view === 'muscles' && (hasMuscles ? <MuscleBalance S={S} />
      : <EmptyState icon="dumbbell" title={t('No workouts yet')}>{t('Log a workout and the muscles it worked light up here.')}</EmptyState>)}
    {view === 'plan' && (S.routines.length > 0 ? <WeeklyPlanVolume S={S} />
      : <EmptyState icon="clipboard" title={t('No routines yet')}
        secondary={{ icon: 'clipboard', label: t('Routines'), onClick: () => nav('/train/routines') }}>
        {t('Build a routine and the muscle volume it plans each week shows up here.')}
      </EmptyState>)}
    {view === 'effort' && <EffortCard S={S} />}
  </Page>
}
