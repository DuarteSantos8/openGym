import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay } from '../lib/history.js'
import { todayISO, isoOf, weekStartOf, weekDayOffset, DAYS, DAYN } from '../lib/format.js'
import { t, dateLocale } from '../lib/i18n.js'
import { dayOverrideSheet, startFlow } from '../sheets.jsx'
import { queueOf, queueView, pinState } from '../lib/queue.js'
import { scheduleModeOf } from '../lib/rotation.js'
import { workoutRunning } from '../lib/tab-route.js'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'
import { dayNoteOf } from '../lib/day-notes.js'
import Icon from './Icon.jsx'
import QueueRow from './QueueRow.jsx'
import Elapsed from './Elapsed.jsx'
import { Button } from './ui.jsx'

// Today's session with the week around it: Start / Resume (with the time it has run) / Done /
// Rest day, one tap. The same card leads Home and the Training hub.
export default function TodayCard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  // A weekday can hold several routines. `todayRoutines` is the whole day; `routine` is the
  // first, kept for the one-routine glyph. The derived session name joins them (§9).
  const todayRoutines = effectiveRoutines(S, todayISO())
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  // A fulfilled pin (a coach session pinned to today and since done) reads as no override.
  const todayOvr = S.dayPlan[todayISO()] !== undefined && pinState(S, S.dayPlan[todayISO()]) !== 'done'
  // An open editor on a saved workout (lib/session-edit.js) holds S.active too, but it is not a
  // session in progress: the row takes you back to it as an edit.
  const editingSaved = !!S.active?.editingWorkoutId
  const live = workoutRunning(S)

  const ws = weekStartOf(S)
  // The first day of the shown week. Named for the role, not for Monday — which day that is
  // is the setting.
  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  // The last session logged for today, if any — what the row below reports instead of asking
  // you to start the one you already did. Last wins, so a second session names itself. Only once
  // today's plan is covered, though: a freestyle session on a planned day, or the rotation's
  // first session done when its next one is today's too, leaves the row offering what is still
  // to do, as Start and the progress row already do. A queue session is never "covered" by an
  // earlier workout: the queue only names one it does not count as done yet.
  const loggedToday = S.workouts.filter(w => w.d === todayISO())
  const queueIds = queueOf(S)?.ids || []
  const coveredToday = id => !queueIds.includes(id) && loggedToday.some(w => (Array.isArray(w.routineIds) ? w.routineIds : [w.routineId]).includes(id))
  const doneToday = (todayRoutines.every(r => coveredToday(r.id)) && loggedToday.at(-1)) || null
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineIds(S, iso).length > 0, ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    // A day off with a note (#261) reads as excused, not as a plan that went by.
    const dot = done ? ' done' : dayNoteOf(S, iso) ? ' noted' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} {...tappable(() => dayOverrideSheet(iso))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  // A coach week (S.queue) read through the same tolerant reader QueueRow uses, so a malformed
  // queue from another client shows the weekday dots, never an empty card.
  const queue = queueView(S, todayISO())
  // This card shows one thing or the other — QueueRow for a live queue, or Rotation chosen with
  // nothing built yet (S.scheduleMode), in which case there is no queue for QueueRow to render and
  // an empty-state card takes its place. Schedule does the same in rotation mode: no weekday grid,
  // only the days that add a routine the loop does not have (Plan.jsx, "Also on fixed days").
  const rotating = scheduleModeOf(S) === 'rotation'
  // A planner-written queue (no rotationId) still names its weekday when it hasn't started yet —
  // that copy predates rotation and stays as it is. Our own rotation has no weekday of its own
  // (lib/rotation.js): naming one here — including on the pass's own one-day empty gap (THE
  // ONE-DAY BOUNDARY, rotation.js) or before a first routine is even added — would be the
  // fixed-week model leaking into a schedule that was never weekday-based.
  const liveQ = queueOf(S)
  const plannerQueue = !!queue && !liveQ?.rotationId
  // Ownership, not mere presence of a rotationId: a stale id left over from a rebuilt rotation
  // would otherwise still read as "this app manages it" (lib/rotation.js).
  const managedQueue = !!liveQ && !!S.rotation && liveQ.rotationId === S.rotation.id
  // On a rest day, saying when you train next beats leaving the row as a full stop.
  const next = !S.active && !todayRoutines.length && !(rotating && !plannerQueue) ? nextTrainingDay(S, todayISO()) : null

  const onToday = () => { if (S.active) nav('/train/workout'); else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, todayISO())); else dayOverrideSheet(todayISO()) }
  // A chip on the coach week's progress row starts that one routine, in any order. A session
  // already in progress wins, as on the today row — starting another would overwrite it.
  const onQueueStart = id => { if (S.active) nav('/train/workout'); else startFlow([id]) }

  return <div className="card">
    {/* A coach week runs by order, not by weekday, so its progress row stands in for the
        seven dots (components/QueueRow.jsx). The today row below stays as it is: the queue's
        next session reaches it through effectiveRoutineIds like any planned routine. */}
    {rotating ? (queue ? <QueueRow S={S} today={todayISO()} onStart={onQueueStart} managed={managedQueue} /> : <div className="empty">
      {t('No rotation yet. Add routines to it in Plan.')}
      <div style={{ marginTop: 10 }}><Button size="sm" variant="tinted" onClick={() => nav('/train/schedule')}>{t('Set up in Plan')}</Button></div>
    </div>) : <>
      <div className="row between" style={{ marginBottom: 8 }}>
        {/* 32px and the iconbtn's 6px reach on each side: a 44px target. */}
        <button className="iconbtn wk-nav" onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn wk-nav" onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
    </>}
    {/* Once today's session is logged the row stops asking for it. The week strip already
        knew (its dot goes 'done'); this row did not, so a finished day kept showing the
        routine name behind a green Start tag and read as still outstanding (issue #4).
        An in-progress session still wins — that one is happening right now. Tapping the
        row keeps working, so a second session in one day is a tap away, just not urged. */}
    <div className="today-row" {...tappable(onToday)}>
      <div className="row" style={{ gap: 9, minWidth: 0 }}>
        <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
          <Icon name={S.active ? (editingSaved ? 'pencil' : 'play') : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
            style={doneToday && !S.active ? { color: 'var(--green-ink)' } : undefined} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="lbl2">{t('Today')}</div>
          <div className="ttl">{S.active ? (editingSaved ? S.active.name : t('{0} (in progress)', S.active.name))
            : doneToday ? (doneToday.name ? t('{0} (done)', doneToday.name) : t('Workout done'))
            : routine ? todayName : t('Rest day')}{todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''}</div>
          {next && !doneToday && <div className="ss">{t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</div>}
        </div>
      </div>
      {S.active ? <span className="tag" style={{ color: 'var(--orange-ink)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>
          {editingSaved ? t('Edit') : <>{t('Resume')}{live && <> · <Elapsed start={S.active.start} /></>}</>}</span>
        : doneToday ? <span className="tag" style={{ color: 'var(--green-ink)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
        : routine ? <span className="tag acc">{t('Start')}</span>
        : <Icon name="plus" className="chev" />}
    </div>
    {/* The row above starts today's plan in one tap, and so does Start / Resume on the +. Both
        jump straight into the planned session whenever there is one, so the Start screen (a
        freestyle session, and your other routines) is only reachable on a day with nothing
        planned. The one other way in, "Choose a different workout" on the weigh-in sheet, does
        not exist when the weigh-in is switched off. This is that door, and it starts nothing. */}
    {!S.active && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 4 }}>
      <Button size="sm" variant="ghost" className="dim" icon="swap" onClick={() => nav('/train/workout')}>
        {t('Choose a different workout')}
      </Button>
    </div>}
  </div>
}
