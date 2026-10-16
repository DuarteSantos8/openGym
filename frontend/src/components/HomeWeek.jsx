import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { routineCount, todayISO, DAYN } from '../lib/format.js'
import { streakWeeks } from '../lib/history.js'
import { queueOf, queueView, weekTally } from '../lib/queue.js'
import { nameOf, nextSession, trainingDay } from '../lib/training-day.js'
import { starterPlanSheet, startFlow } from '../sheets.jsx'
import { Card, EmptyState } from './blocks.jsx'
import { LineArt } from './line-art.jsx'
import QueueRow from './QueueRow.jsx'
import { MediaRow, SectionHeader } from './tab-kit.jsx'

// Home's "This week" (ux-redesign-tabs §1.6): sessions done against planned, the streak and the
// next session, opening Training. A coach week or your own rotation adds its progress row, whose
// chips start a session. Empty: Welcome (a starter plan or your own), or routines with nothing
// scheduled.
export default function HomeWeek() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()

  if (!S.routines.length && !S.active) {
    return <Card>
      <EmptyState art={<LineArt scene="routine" state={{ days: 0 }} />} title={t('Welcome!')}
        action={{ label: t('Load starter plan'), icon: 'clipboard', onClick: starterPlanSheet }}
        secondary={{ label: t('Build my own plan'), onClick: () => nav('/train/routines') }}>
        {t('Set up your weekly routine to get going, or grab a ready-made starter plan.')}
      </EmptyState>
    </Card>
  }

  const { done, planned } = weekTally(S, today)
  const queue = queueView(S, today)
  const liveQ = queueOf(S)
  const header = <SectionHeader title={t('This week')} link={t('View plan')} onLink={() => nav('/train')} />
  const total = S.workouts.length ? tn('{0} workout total', '{0} workouts total', S.workouts.length) : null

  if (!planned && !queue) {
    return <>
      {header}
      <Card>
        <MediaRow art={<LineArt scene="routine" state={{ days: S.routines.length, scheduled: false }} />}
          title={routineCount(S.routines.length)}
          subtitle={[t('Not scheduled'), done > 0 && t('{0} this week', done), total].filter(Boolean).join(' · ')}
          link={{ icon: 'calendar', label: t('Schedule'), onClick: () => nav('/train/schedule') }} />
      </Card>
    </>
  }

  // The progress row of a coach week or a rotation names its own next session.
  let next = null
  if (!queue) {
    const day = trainingDay(S, today, today)
    const after = day.kind === 'planned' ? null : nextSession(S, today)
    if (day.kind === 'planned') next = { when: t('Today'), name: day.name }
    else if (after) next = { when: t(DAYN[after.weekday]), name: nameOf(after.routines) }
  }
  const streak = streakWeeks(S)
  // A session in progress wins over a chip, as everywhere: starting another would overwrite it.
  const onQueueStart = id => { if (S.active) nav('/train/workout'); else startFlow([id]) }
  return <>
    {header}
    <Card>
      <MediaRow art={<LineArt scene="routine" state={{ days: planned, next: next ? 0 : null }} />}
        title={t('{0} of {1} this week', done, planned)}
        subtitle={[streak > 0 && t('{0} week streak', streak), next && t('Next session: {0}, {1}', next.when, next.name), total].filter(Boolean).join(' · ') || null}
        onOpen={() => nav('/train')} chevron />
      {queue && <QueueRow S={S} today={today} onStart={onQueueStart} managed={!!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id} />}
    </Card>
  </>
}
