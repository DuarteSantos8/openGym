import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDate, isoOf, startOfWeek, todayISO, weekStartOf, DAYN } from '../lib/format.js'
import { effectiveRoutines } from '../lib/history.js'
import { glyphOf } from '../lib/glyphs.js'
import { queueView } from '../lib/queue.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { workoutLabel, workoutsByDay } from '../lib/training-day.js'
import { dayOverrideSheet } from '../sheets.jsx'
import { Card, InlineNote } from './blocks.jsx'
import QueueRow from './QueueRow.jsx'
import { SectionHeader } from './tab-kit.jsx'
import { workoutsSheet } from './TrainingHero.jsx'
import { Row, Section } from './ui.jsx'

// The days of the week `today` is in that hold a session: trained (its workouts), or planned.
function weekSessions(S, today) {
  const start = startOfWeek(today, weekStartOf(S))
  const byDay = workoutsByDay(S.workouts)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const iso = isoOf(d)
    return { iso, weekday: d.getDay(), workouts: byDay.get(iso) ?? [], routines: effectiveRoutines(S, iso) }
  }).filter(d => d.workouts.length || d.routines.length)
}

// Training's "Your plan" (ux-redesign-tabs §4.1): this week's sessions, a row a day, with Edit
// opening Schedule. A day trained opens what was logged; any other opens "change this day" (a
// missed one can be logged from there). A coach week or your own rotation has no weekdays: its
// progress row stands in, its chips starting a session.
export default function TrainPlan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const header = <SectionHeader title={t('Your plan')} link={t('Edit')} onLink={() => nav('/train/schedule')} />

  if (queueView(S, today)) return <>{header}<Card><QueueRow S={S} today={today} /></Card></>
  if (scheduleModeOf(S) === 'rotation') return <>{header}<InlineNote icon="repeat">{t('No rotation yet. Add routines to it in Plan.')}</InlineNote></>

  const sessions = weekSessions(S, today)
  if (!sessions.length) return <>{header}<InlineNote icon="calendar">{t('Nothing planned this week')}</InlineNote></>
  return <>
    {header}
    <Section>
      {sessions.map(d => {
        const done = d.workouts.length > 0
        const names = done ? d.workouts.map(w => workoutLabel(w)) : d.routines.map(r => r.name)
        const when = [t(DAYN[d.weekday]), d.iso === today && t('Today'), done && t('Done'), !done &&d.iso < today && t('Planned, not logged')].filter(Boolean).join(' · ')
        return <Row key={d.iso} glyph={done ? 'checkCircle' : glyphOf(d.routines[0].emoji)} title={names.join(' + ')} subtitle={when}
          accessory={done ? 'check' : 'chevron'}
          onClick={() => (done ? workoutsSheet(fmtDate(d.iso, true), d.workouts) : dayOverrideSheet(d.iso))} />
      })}
    </Section>
  </>
}
