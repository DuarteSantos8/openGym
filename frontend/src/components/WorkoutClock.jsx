// The workout header's clock (#1078): a Timer and a Stopwatch, neither of which writes anything
// into the workout. The Timer opens at the time it last ran (S.timerSec, else the rest from
// Settings) and runs on the rest timer, with the rest's alert at its end; starting it ends a rest
// that is running. Its countdown is marked `clock` on the timer, so the sheet tells it from a rest
// after a set and shows it as a large ring with −15 · +15 · Skip. The Stopwatch only counts
// (lib/stopwatch.js); the sheet opens on it while it has time on it.
import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { useStopwatch } from '../store/useStopwatch.js'
import { t } from '../lib/i18n.js'
import { REST_MAX, fmtDuration } from '../lib/duration.js'
import { elapsed, running, startW, stopW, resetW, ofSession, showing, stopwatchText, stopwatchShort } from '../lib/stopwatch.js'
import DurationWheel from './DurationWheel.jsx'
import { Button, Segmented } from './ui.jsx'

const TIMER_MIN = 5
const lastTimer = S => (S.timerSec > 0 ? S.timerSec : S.restSec > 0 ? S.restSec : 90)
// A countdown the Timer started; the rest timer's ticks carry the mark over, a rest after a set
// starts a new timer without it, and one that ran out (ready) is over.
export const isClockTimer = tm => !!tm && tm.clock === true && !tm.ready
const fmtClock = sec => {
  const n = Math.max(0, sec | 0)
  return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0')
}

// Redraws its caller every `ms` while `on`.
function useTick(ms, on = true) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => tick(n => n + 1), ms)
    return () => clearInterval(id)
  }, [ms, on])
}

function TimerTab() {
  const timer = useUI(s => s.timer)
  // A hold or its count-in running: a rest started now would end it and log what was held.
  const holding = useUI(s => !!(s.work || s.countIn))
  const [v, setV] = useState(() => Math.min(lastTimer(useStore.getState().S), REST_MAX))
  const read = useRef(null)
  if (isClockTimer(timer)) {
    const ui = useUI.getState()
    return <Ring left={timer.left} total={timer.total}
      onMinus={() => ui.addRest(-15)} onPlus={() => ui.addRest(15)} onSkip={() => ui.stopRest()} />
  }
  const go = () => {
    const now = read.current ? read.current() : v
    if (!(now > 0) || holding) return
    setV(now)   // after Skip the wheel is back at the time that ran
    useStore.getState().update(s => { s.timerSec = now })
    // startRest ends a running rest first; `clock` keeps the countdown from leading into a hold.
    useUI.getState().startRest(now, undefined, { clock: true })
  }
  return <div className="wclock">
    <div className="dw-read" aria-hidden="true">{fmtDuration(v)}</div>
    <DurationWheel value={v} onChange={setV} min={TIMER_MIN} max={REST_MAX} readRef={read} />
    <Button variant="primary" onClick={go} disabled={holding}>{t('Start timer')}</Button>
  </div>
}

// The running Timer: the time left in a ring, −15 · +15 and Skip. The rest bar counts it too, and
// its tick redraws the ring every second.
function Ring({ left, total, onMinus, onPlus, onSkip }) {
  const share = total > 0 ? Math.min(1, left / total) : 0
  const R = 118, C = 2 * Math.PI * R
  return <div className="wclock-ring">
    <div className="wclock-dial" role="timer" aria-label={t('Timer')}>
      <svg viewBox="0 0 260 260" aria-hidden="true">
        <circle cx="130" cy="130" r={R} className="wclock-bg" />
        <circle cx="130" cy="130" r={R} className="wclock-fg" strokeDasharray={C} strokeDashoffset={C * (1 - share)} />
      </svg>
      <span className="wclock-t">{fmtClock(left)}</span>
    </div>
    <div className="wclock-btns">
      <Button onClick={onMinus}>−15</Button>
      <Button onClick={onPlus}>+15</Button>
      <Button variant="primary" onClick={onSkip}>{t('Skip')}</Button>
    </div>
  </div>
}

function StopwatchTab() {
  // The workout active now: another one started while the sheet is open gets its own stopwatch.
  const session = useStore(s => s.S.active?.id ?? null)
  const w = ofSession(useStopwatch(s => s.w), session)
  const apply = useStopwatch(s => s.apply)
  const on = running(w)
  useTick(100, on)
  const ms = elapsed(w, Date.now())
  const go = fn => apply(cur => fn(ofSession(cur, session), Date.now()))
  return <>
    <div className="dw-read wclock-sw" role="timer" aria-label={t('Stopwatch')}>{stopwatchText(ms)}</div>
    <div className="wclock-btns">
      <Button onClick={() => go(resetW)} disabled={on || ms === 0}>{t('Reset')}</Button>
      <Button variant="primary" onClick={() => go(on ? stopW : startW)}>{on ? t('Stop') : ms ? t('Resume') : t('Start')}</Button>
    </div>
  </>
}

export function WorkoutClock({ tab: first = 'timer' }) {
  const [tab, setTab] = useState(first)
  return <>
    <Segmented value={tab} onChange={setTab}
      options={[{ value: 'timer', label: t('Timer') }, { value: 'stopwatch', label: t('Stopwatch') }]} />
    <div style={{ height: 12 }} />
    {tab === 'timer' ? <TimerTab /> : <StopwatchTab />}
    <div style={{ height: 8 }} />
  </>
}

/** Opens the clock sheet from the workout header; the stopwatch is per workout (its id). */
export function workoutClockSheet() {
  const session = useStore.getState().S.active?.id ?? null
  const tab = showing(ofSession(useStopwatch.getState().w, session)) ? 'stopwatch' : 'timer'
  return useUI.getState().openSheet(() => <WorkoutClock tab={tab} />)
}

/** The stopwatch's time beside the header's clock button while it runs ("Stopwatch 1:05" spoken). */
export function HeaderStopwatch({ session }) {
  const w = ofSession(useStopwatch(s => s.w), session)
  const on = running(w)
  useTick(1000, on)
  if (!on) return null
  return <span className="wclock-hdr"><span className="vh">{t('Stopwatch')} </span>{stopwatchShort(elapsed(w, Date.now()))}</span>
}
