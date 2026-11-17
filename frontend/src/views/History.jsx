import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, tn } from '../lib/i18n.js'
import { WorkoutRow, DayNoteRow, workoutDetailSheet, logPastWorkoutSheet } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { dayNoteOf } from '../lib/day-notes.js'
import { reportSheet } from '../components/ReportSheet.jsx'
import { recoverySessionsOf } from '../lib/recovery-sessions.js'
import { recoverySheet, RecoveryRow } from '../components/RecoverySheet.jsx'
import { activitiesOf } from '../lib/activities.js'
import { ActivityRow } from '../components/ActivitySheet.jsx'

// Newest first: every workout, and in between them the days off you left a note on (#261) and the
// recovery sessions (sauna, ice bath, lib/recovery-sessions.js). A note on a day that has a workout
// too stays in the day sheet; the workout speaks for that day. A recovery session is always its own row,
// and so is an activity (a run, a match: lib/activities.js).
export function historyRows(S) {
  const trained = new Set((S.workouts || []).map(w => w?.d))
  const notes = Object.keys(S.dayNotes || {}).filter(d => !trained.has(d)).map(d => ({ d, note: dayNoteOf(S, d) })).filter(x => x.note)
  const rows = [...(S.workouts || []).map(w => ({ d: w.d, w })), ...notes, ...recoverySessionsOf(S).map(r => ({ d: r.d, rec: r })), ...activitiesOf(S).map(a => ({ d: a.d, act: a }))]
  // Stable, so workouts keep the order they are stored in (by day, then start) within a day.
  return rows.map((r, i) => [r, i]).sort((a, b) => (a[0].d < b[0].d ? 1 : a[0].d > b[0].d ? -1 : b[1] - a[1])).map(([r]) => r)
}

// The list grows as it is scrolled: the first PAGE rows, then PAGE more whenever its end comes
// within a screen or so. A 400-workout history rendered every row (some 1500 components) on each
// open. How far it had grown is kept for the session, so coming back (the back button, the edge
// swipe) renders the same rows and the page lands where it was scrolled to.
export const HISTORY_PAGE = 60
let grownTo = HISTORY_PAGE

export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const rows = historyRows(S)
  const [shown, setShown] = useState(() => Math.max(HISTORY_PAGE, grownTo))
  const end = useRef(null)
  const more = rows.length > shown
  useEffect(() => { grownTo = Math.max(grownTo, shown) }, [shown])
  useEffect(() => {
    if (!more) return
    const IO = typeof window !== 'undefined' ? window.IntersectionObserver : undefined
    // Without an observer (an old engine) the list is simply whole, as before.
    if (typeof IO !== 'function') { setShown(Infinity); return }
    const io = new IO(es => { if (es.some(e => e.isIntersecting)) setShown(n => n + HISTORY_PAGE) }, { rootMargin: '0px 0px 1200px 0px' })
    if (end.current) io.observe(end.current)
    return () => io.disconnect()
  }, [more, shown])
  return <>
    <ScreenHeader hard title={t('History')} sub={tn('{0} workout', '{0} workouts', S.workouts.length)}
      left={<button className="iconbtn" data-back="/stats" data-tour="history-back" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>}
      right={<>
        {/* A sauna, an ice bath (components/RecoverySheet.jsx): logged from here, listed below with the workouts. */}
        {rows.length > 0 && <button className="iconbtn" onClick={() => recoverySheet()} aria-label={t('Log recovery')} title={t('Log recovery')} style={{ marginInlineEnd: 8 }}><Icon name="sparkles" /></button>}
        {S.workouts.length > 0 && <button className="iconbtn" onClick={reportSheet} aria-label={t('Performance report')} title={t('Performance report')}><Icon name="note" /></button>}
      </>} />
    {rows.length > 0 && <Button icon="plus" data-tour="history-add" onClick={logPastWorkoutSheet} style={{ marginBottom: 12 }}>{t('Log a past workout')}</Button>}
    {rows.length ? <><div className="list">{(more ? rows.slice(0, shown) : rows).map((r, i) => r.w
      ? <WorkoutRow key={r.w.id} w={r.w} tour={i === 0 ? 'history-row' : undefined} onClick={() => workoutDetailSheet(r.w)} />
      : r.rec ? <RecoveryRow key={'rec-' + r.rec.id} r={r.rec} />
      : r.act ? <ActivityRow key={'act-' + r.act.id} a={r.act} />
      : <DayNoteRow key={'note-' + r.d} iso={r.d} note={r.note} />)}</div>
      {more && <div ref={end} aria-hidden="true" style={{ height: 1 }} />}</>
      : <EmptyState icon="history" text={t('No workouts yet. Your first one will land here.')}>
        <Button variant="tinted" icon="plus" data-tour="history-add" onClick={logPastWorkoutSheet}>{t('Log a past workout')}</Button>
        <div style={{ height: 8 }} />
        <Button variant="ghost" icon="sparkles" onClick={() => recoverySheet()}>{t('Log recovery')}</Button>
      </EmptyState>}
  </>
}
