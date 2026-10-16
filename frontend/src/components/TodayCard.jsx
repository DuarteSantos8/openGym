import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { todayISO, DAYN } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayOverrideSheet, startFlow } from '../sheets.jsx'
import { queueOf, queueView } from '../lib/queue.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { trainingDay } from '../lib/training-day.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from './Icon.jsx'
import QueueRow from './QueueRow.jsx'
import Elapsed from './Elapsed.jsx'
import { Button } from './ui.jsx'

// The Training hub's today: Start / Resume (with the time it has run) / Done / Rest day, one tap.
// The day is read by lib/training-day.js, the same reading Home's hero tells. Home's week strip
// and calendar are where a day is picked or changed; a coach week or a rotation shows its
// progress row here.
export default function TodayCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const today = todayISO()
  const day = trainingDay(S, today, today)
  const routine = day.kind === 'planned' ? day.routines[0] : null

  // A coach week (S.queue) read through the same tolerant reader QueueRow uses, so a malformed
  // queue from another client shows nothing here rather than an empty card. Rotation chosen with
  // nothing built yet has no queue for QueueRow to render: an empty state takes its place.
  const queue = queueView(S, today)
  const rotating = scheduleModeOf(S) === 'rotation'
  const liveQ = queueOf(S)
  // Ownership, not mere presence of a rotationId: a stale id left over from a rebuilt rotation
  // would otherwise still read as "this app manages it" (lib/rotation.js).
  const managedQueue = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id

  const onToday = () => { if (S.active) nav('/train/workout'); else if (day.kind === 'planned') startFlow(day.ids); else dayOverrideSheet(today) }
  // A chip on the coach week's progress row starts that one routine, in any order. A session
  // already in progress wins, as on the today row — starting another would overwrite it.
  const onQueueStart = id => { if (S.active) nav('/train/workout'); else startFlow([id]) }

  const title = day.kind === 'editing' ? day.active.name
    : day.kind === 'running' ? t('{0} (in progress)', day.active.name)
    : day.kind === 'done' ? (day.workout.name ? t('{0} (done)', day.workout.name) : t('Workout done'))
    : day.kind === 'planned' ? day.name + (day.rescheduled ? ' · ' + t('rescheduled') : '')
    : t('Rest day')

  return <div className="card">
    {rotating && (queue ? <QueueRow S={S} today={today} onStart={onQueueStart} managed={managedQueue} /> : <div className="empty">
      {t('No rotation yet. Add routines to it in Plan.')}
      <div style={{ marginTop: 10 }}><Button size="sm" variant="tinted" onClick={() => nav('/train/schedule')}>{t('Set up in Plan')}</Button></div>
    </div>)}
    <div className="today-row" {...tappable(onToday)}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : day.kind === 'done' ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
          <Icon name={day.kind === 'editing' ? 'pencil' : day.kind === 'running' ? 'play' : day.kind === 'done' ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
            style={day.kind === 'done' ? { color: 'var(--green-ink)' } : undefined} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Today')}</div>
          <div className="ttl">{title}</div>
          {day.kind === 'rest' && day.next && <div className="ss">{t('Next session: {0}, {1}', t(DAYN[day.next.weekday]), day.next.routine.name)}</div>}
        </div>
      </div>
      {day.kind === 'editing' ? <span className="tag" style={{ color: 'var(--orange-ink)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Edit')}</span>
        : day.kind === 'running' ? <span className="tag" style={{ color: 'var(--orange-ink)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>
          {t('Resume')}{day.live && <> · <Elapsed start={day.active.start} /></>}</span>
        : day.kind === 'done' ? <span className="tag" style={{ color: 'var(--green-ink)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
        : routine ? <span className="tag acc">{t('Start')}</span>
        : <Icon name="plus" className="chev" />}
    </div>
  </div>
}
