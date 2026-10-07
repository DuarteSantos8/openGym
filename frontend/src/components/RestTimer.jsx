import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { REST_MAX } from '../lib/duration.js'
import { durationSheet } from './DurationWheel.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// The clock is a button: a tap opens the wheel at the time that is left, for a rest that wants
// to be a round 2:00 rather than eight taps of +15. 0:00 ends the rest, like Skip. What is left
// is read again at Done, since the rest kept counting while the wheel was open. Done on a wheel
// nobody turned changes nothing: the rest keeps the seconds it counted down meanwhile, and one
// that ran out (or a switch-sides pause that ended) is not started again.
export function adjustRestSheet() {
  const tm = useUI.getState().timer
  if (!tm) return
  const opened = tm.ready ? 0 : Math.min(tm.left, REST_MAX)
  durationSheet({
    title: t('Time left'), value: opened, max: REST_MAX, off: t('Skip'),
    footer: t('Scroll to 0:00 to end the rest now.'),
    onDone: v => applyRestLeft(v, opened),
  })
}

// What the wheel's Done does to the rest as it is by then: a new time left, the rest ended at
// 0:00, or a fresh rest when the old one has run out (Ready) or was skipped meanwhile.
export function applyRestLeft(v, opened) {
  if (opened !== undefined && v === opened) return
  const ui = useUI.getState()
  const now = ui.timer
  if (!now) { if (v > 0) ui.startRest(v); return }
  if (v <= 0) { ui.stopRest(); return }
  if (now.ready) { ui.startRest(v, now.forIdx); return }
  if (v !== now.left) ui.addRest(v - now.left)
}

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
//
// v1.3.11: on the workout screen (which has no tab bar, see App.jsx) the bar is docked at the
// bottom edge instead of floating as a card over the next set's row, and it is one row: the
// clock (tap to set it), then −15 s, +15 s, pause and Skip. The progress runs along its top edge,
// so it takes no width from the buttons. Elsewhere it sits on top of the tab bar.
// Skip's label, when the longer of Skip and Dismiss would not fit beside the other buttons
// (German or Russian on a 390 px phone): an icon then, named in full for a screen reader, rather
// than "Überspr…". Measured from hidden copies of both labels, so the choice is the same for
// counting and Ready and the row never reflows between them.
function useSkipFits(actsRef, deps) {
  const [fits, setFits] = useState(true)
  useLayoutEffect(() => {
    const acts = actsRef.current
    if (!acts) return
    const measure = () => {
      const skip = acts.querySelector('.skip')
      const probes = [...acts.querySelectorAll('.skip-probe > span')]
      if (!skip || !probes.length) return
      const need = Math.max(...probes.map(p => p.getBoundingClientRect().width))
      const cs = getComputedStyle(skip)
      const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)
      const others = [...acts.children].filter(c => c !== skip).reduce((sum, c) => sum + c.getBoundingClientRect().width, 0)
      const gap = parseFloat(getComputedStyle(acts).columnGap) || 0
      const room = acts.clientWidth - others - gap * (acts.children.length - 1)
      setFits(!(need > 0) || need + (pad || 0) <= room + 0.5)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(acts)
    return () => ro.disconnect()
  }, deps)
  return fits
}

export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, stopRest, pauseRest, resumeRest, finishWorkEarly, stopWork } = useUI()
  const on = work || timer
  const actsRef = useRef(null)
  const skipFits = useSkipFits(actsRef, [!!timer && !work, t('Skip'), t('Dismiss')])
  // The page keeps room at its bottom for the bar (index.css body.resting), so the last set and
  // the Finish button can scroll clear of it.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  if (!on) return null
  const pct = Math.max(0, Math.min(100, (on.left / on.total) * 100))

  if (work) return (
    <div id="timer" className="working">
      <div className="bar" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
      <div className="tclock">
        <span className="t">{work.left <= 0 && work.overtime ? '+' + clock(-work.left) : clock(work.left)}</span>
        {work.label && <span className="lbl">{work.label}</span>}
      </div>
      <div className="acts">
        <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
        <Button size="sm" variant="primary" icon="check" onClick={finishWorkEarly}>{t('Done')}</Button>
      </div>
    </div>
  )
  // −15 and +15 sit together in number-line order; Skip is pushed to the far edge, away from the
  // button you tap to buy more time. Pause sits between them as an icon (#193): it holds the
  // time, it neither adds nor ends it. A rest that is over has nothing left to hold, so Ready
  // offers no pause, but its slot stays (an invisible stand-in) and Skip is as wide as Dismiss
  // (both labels share one cell, one of them hidden), and the clock keeps room for the other of
  // its two faces (data-alt, a hidden line in index.css): the row never reflows when the rest
  // turns Ready, so a thumb on +15 never lands on −15.
  const label = timer.kind === 'switch' ? t('Switch sides') : timer.paused ? t('Paused') : t('Rest')
  return (
    <div id="timer" className={'rest' + (timer.paused ? ' paused' : '') + (timer.kind === 'switch' ? ' switch' : '') + (timer.ready ? ' ready' : '')}>
      <div className="bar" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
      <button type="button" className="tclock" onClick={adjustRestSheet}
        aria-label={(timer.ready ? t('Ready') : clock(timer.left)) + '. ' + t('Change the time left')}>
        <span className="t" role={timer.ready ? 'status' : undefined} data-alt={timer.ready ? '0:00' : t('Ready')}>{timer.ready ? t('Ready') : clock(timer.left)}</span>
        <span className="lbl">{label}<Icon name="chevronDown" /></span>
      </button>
      <div className="acts" ref={actsRef}>
        <Button size="sm" className="adj" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        <Button size="sm" className="adj" icon="plus" disabled={!timer.ready && timer.left >= REST_MAX} onClick={() => addRest(15)}>15s</Button>
        {timer.ready
          ? <Button size="sm" className="pause-slot" icon="pause" disabled tabIndex={-1} aria-hidden="true" />
          : <Button size="sm" className="pause" icon={timer.paused ? 'play' : 'pause'}
            aria-label={t(timer.paused ? 'Resume' : 'Pause')} aria-pressed={!!timer.paused}
            onClick={timer.paused ? resumeRest : pauseRest} />}
        <button type="button" className={'btn primary sm skip' + (skipFits ? '' : ' icon-only')} onClick={stopRest}
          aria-label={skipFits ? undefined : t(timer.ready ? 'Dismiss' : 'Skip')}>
          {skipFits
            ? <span><span className="on">{t(timer.ready ? 'Dismiss' : 'Skip')}</span>
              <span className="off" aria-hidden="true">{t(timer.ready ? 'Skip' : 'Dismiss')}</span></span>
            : <Icon name={timer.ready ? 'xmark' : 'skipForward'} />}
          <span className="skip-probe" aria-hidden="true"><span>{t('Skip')}</span><span>{t('Dismiss')}</span></span>
        </button>
      </div>
    </div>
  )
}
