import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { holdInert, pageBehind } from '../lib/inert.js'
import { restNextLine } from '../lib/rest-next.js'
import { restView, clock } from '../lib/rest-timer-view.js'
import { t } from '../lib/i18n.js'
import { REST_MAX } from '../lib/duration.js'
import { durationSheet } from './DurationWheel.jsx'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { SeasonDeco } from './Seasonal.jsx'

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
  if (v <= 0) { ui.skipRest(); return }
  if (now.ready) { ui.startRest(v, now.forIdx, { forSet: now.forSet, rest: now.rk }); return }
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

// Timed holds that run themselves (lib/auto-holds.js): the chain's own controls, a second row under
// the clock of the count-in and of the hold. Pause holds whichever clock runs, Restart takes the
// hold back to its count-in (nothing logged for the try it drops), Stop auto ends the chain and
// leaves the rest of the workout as it always was. Big enough for a thumb mid-plank.
function AutoRow({ paused, restart = true }) {
  const { pauseAuto, resumeAuto, restartHold, stopAuto } = useUI.getState()
  return (
    <div className="autorow" role="group" aria-label={t('Timed holds start by themselves')}>
      <Button size="sm" icon={paused ? 'play' : 'pause'}
        onClick={() => (paused ? resumeAuto() : pauseAuto())}>{t(paused ? 'Resume' : 'Pause')}</Button>
      {restart && <Button size="sm" icon="reset" onClick={() => restartHold()}>{t('Restart')}</Button>}
      <Button size="sm" icon="xmark" onClick={() => stopAuto()}>{t('Stop auto')}</Button>
    </div>
  )
}

// iPhone (Liquid Glass G2): a plain rest, or a hold you time by hand, is a row on the floating tab
// bar (TabBar.jsx renders it inside the bar) or, on the workout screen where there is no bar,
// docked to the bottom edge (App.jsx passes `docked`). The count-in, a hold that runs itself and
// the rest before one carry the chain's second row, so they keep the card above.
export function fusedKind({ countIn, work, timer }) {
  if (countIn) return ''
  if (work) return work.auto ? '' : 'work'
  return timer && (timer.ready || !timer.autoNext) ? 'rest' : ''
}

const FULL = 'inset(0px round 0px)'
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// The row and the full rest view that grows out of it (a dialog: everything behind is inert, Esc,
// the chevron or a swipe down close it). Reduce Motion: no clip-path, no flip (index.css).
export function TimerRow({ docked = false }) {
  const kind = useUI(fusedKind)
  const c = useUI(s => s.work ?? s.timer)
  const [x, setX] = useState(false)
  const S = useStore(s => (x ? s.S : null))   // only the full view reads it (the next-up line)
  const [said, setSaid] = useState('')
  const rowRef = useRef(null), xvRef = useRef(null), dgRef = useRef(null), closeRef = useRef(null)
  const clkRef = useRef(null), tRef = useRef(null), mtRef = useRef(null), mttRef = useRef(null)
  const closing = useRef(0), touchY = useRef(null)
  const work = kind === 'work'
  const view = c && restView({ left: c.left, total: c.total, paused: !!c.paused, over: !!c.ready, work, overtime: !!c.overtime, switching: c.kind === 'switch' })
  const next = useMemo(() => {
    if (!x || work || !c) return ''
    try { return restNextLine(S, c.forIdx) } catch { return '' }
  }, [x, work, S, c?.forIdx])

  // "Rest over" is said once and cleared, so the same words are read again at the next rest.
  const announce = view?.announce || ''
  useEffect(() => {
    setSaid(announce)
    if (!announce) return undefined
    const id = setTimeout(() => setSaid(''), 3000)
    return () => clearTimeout(id)
  }, [announce])

  const isMin = () => !!rowRef.current?.closest('#tabbar.min')
  // The rectangle the view grows from (and shrinks back to): the bar with its row, the capsule, or the docked row.
  const origin = () => {
    const row = rowRef.current.getBoundingClientRect(), nav = rowRef.current.closest('#tabbar')
    let r = nav ? nav.getBoundingClientRect() : row
    if (nav && isMin()) {   // the bar keeps its full size under the capsule (index.css): the capsule is its --mw by --bhm corner
      const cs = getComputedStyle(nav)
      r = { left: r.left, bottom: r.bottom, right: r.left + (parseFloat(cs.getPropertyValue('--mw')) || r.width), top: r.bottom - (parseFloat(cs.getPropertyValue('--bhm')) || r.height) }
    }
    const top = nav && !isMin() ? row.top : r.top
    return `inset(${top}px ${window.innerWidth - r.right}px ${window.innerHeight - r.bottom}px ${r.left}px round ${docked ? '24px 24px 0px 0px' : isMin() ? '26px' : '32px'})`
  }
  // The digits start at the row's (or the capsule's) size and grow to the big ones; closing runs it back.
  const flip = rev => {
    const dg = dgRef.current, src = isMin() ? mttRef.current : tRef.current
    if (reduced() || !dg?.animate || !src) return
    dg.getAnimations().forEach(a => a.cancel())
    const a = src.getBoundingClientRect(), d = dg.getBoundingClientRect()
    const k = parseFloat(getComputedStyle(src).fontSize) / parseFloat(getComputedStyle(dg).fontSize)
    const from = `translate(${a.left + a.width / 2 - d.left - d.width / 2}px,${a.top + a.height / 2 - d.top - d.height / 2}px) scale(${k})`
    dg.animate(rev ? [{ transform: 'none' }, { transform: from }] : [{ transform: from }, { transform: 'none' }],
      { duration: rev ? 340 : 420, easing: 'cubic-bezier(.32,.72,0,1)', fill: rev ? 'forwards' : 'none' })
  }
  const open = () => {
    const xv = xvRef.current
    if (x || !xv) return
    clearTimeout(closing.current)
    xv.style.transition = 'none'; xv.style.clipPath = origin()
    xv.classList.add('open'); void xv.offsetWidth
    xv.style.transition = ''; xv.style.clipPath = FULL; xv.classList.add('shown')
    flip(false); setX(true)
  }
  const close = () => {
    const xv = xvRef.current
    if (!xv) return
    xv.classList.remove('shown'); xv.style.clipPath = origin(); flip(true); setX(false)
    // A timer, not transitionend: under Reduce Motion no transition runs at all.
    closing.current = setTimeout(() => { xv.classList.remove('open'); dgRef.current?.getAnimations?.().forEach(a => a.cancel()) }, reduced() ? 0 : 430)
  }
  useEffect(() => () => clearTimeout(closing.current), [])

  // Open: everything behind the dialog (the page, the bar, the toast) is inert, focus goes to the
  // close button. Closed (or the timer ended): inert off first, focus back where it came from.
  useEffect(() => {
    if (!x) return undefined
    const xv = xvRef.current, min = isMin()
    const release = holdInert(pageBehind(xv))
    closeRef.current?.focus({ preventScroll: true })
    const onKey = e => { if (e.key === 'Escape' && !document.getElementById('modal-root')?.classList.contains('open')) close() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      release()
      if (document.activeElement === document.body || xv.contains(document.activeElement)) ((min ? mtRef.current : clkRef.current) ?? document.querySelector('#tabbar .orb'))?.focus({ preventScroll: true })
    }
  }, [x])

  if (!c) return null
  const U = useUI.getState
  const sub = work && c.label ? (c.paused ? t('Paused') + ' · ' : '') + c.label : view.label
  const name = view.spoken + '. ' + sub
  const rest = !work
  const swipe = { onTouchStart: e => { touchY.current = e.touches[0].clientY },
    onTouchEnd: e => { if (touchY.current != null && xvRef.current.scrollTop <= 0 && e.changedTouches[0].clientY - touchY.current > 80) close(); touchY.current = null } }
  const pause = cls => c.ready
    ? <button type="button" className={'b pz slot-off ' + cls} disabled tabIndex={-1} aria-hidden="true"><Icon name="pause" /></button>
    : <button type="button" className={'b pz ' + cls} aria-label={t(c.paused ? 'Resume' : 'Pause')}
      onClick={c.paused ? U().resumeRest : U().pauseRest}><Icon name={c.paused ? 'play' : 'pause'} /></button>
  const minus = <button type="button" className="b adj" onClick={() => U().addRest(-15)}>−15s</button>
  const plus = <button type="button" className="b adj" disabled={view.plusOff} onClick={() => U().addRest(15)}>{view.plusLabel}</button>
  const skip = cls => <button type="button" className={'b pri ' + cls} onClick={() => U().skipRest()}>{view.skipLabel}</button>

  // While the full view is open the page behind is inert, so the announcement lives inside the dialog.
  const status = <span className="vh" role="status" aria-live="polite">{said}</span>
  return <>
    <div ref={rowRef} className={'trow' + (docked ? ' dock' : '')} {...(rest && { 'data-tour': 'rest' })} data-glow={view.glow || undefined} role="group" aria-label={rest ? t('Rest') : t('Hold')}>
      <div className="hit" onClick={open} aria-hidden="true" />
      <i className="prog" aria-hidden="true"><b style={{ transform: `scaleX(${view.progress})` }} /></i>
      <button ref={clkRef} type="button" className="clk" onClick={open} aria-haspopup="dialog" aria-expanded={x} aria-label={name}>
        <span ref={tRef} className="t">{view.time}</span>
        <span className="l">{sub}<Icon name="chevronUp" /></span>
      </button>
      <div className="acts">
        {rest ? <>
          {!c.ready && minus}{plus}{pause('')}{skip('sk')}
        </> : <>
          <button type="button" className="b" onClick={() => U().stopWork()}>{t('Cancel')}</button>
          <button type="button" className="b pri" onClick={() => U().finishWorkEarly()}><Icon name="check" />{t('Done')}</button>
        </>}
      </div>
    </div>
    {!docked && <button ref={mtRef} type="button" className="mtime" onClick={open} aria-haspopup="dialog" aria-label={name}>
      {c.paused && <Icon name="pause" />}<span ref={mttRef} className="mtt">{view.time}</span>
    </button>}
    {createPortal(
      <div ref={xvRef} className="xv" role="dialog" aria-modal="true" aria-label={sub} inert={!x} data-glow={view.glow || undefined} {...swipe}>
        <div className="xtop in">
          <button ref={closeRef} type="button" className="cls" onClick={close} aria-label={t('Close')}><Icon name="chevronDown" /></button>
          <div className="xt">{view.label}</div><i />
        </div>
        <div className="ringw">
          <svg className="in" viewBox="0 0 120 120" aria-hidden="true"><circle className="trk" cx="60" cy="60" r="54" /><circle className="arc" cx="60" cy="60" r="54" pathLength="100" style={{ '--o': view.ringOffset }} /></svg>
          <div className="mid">
            {rest
              ? <button ref={dgRef} type="button" className="dg" onClick={adjustRestSheet} aria-label={name + '. ' + t('Change the time left')}>{view.time}</button>
              : <div ref={dgRef} className="dg">{view.time}</div>}
            {work && c.label && <div className="s in">{c.label}</div>}
          </div>
        </div>
        {next && <div className="nextc in"><small>{t('Next set')}</small><b>{next}</b></div>}
        <div className="xacts in">
          {rest ? <>
            <div className="xr">{!c.ready && minus}{pause('round')}{plus}</div>
            {skip('xsk')}
          </> : <div className="grp">
            <button type="button" className="b" onClick={() => U().stopWork()}>{t('Cancel')}</button>
            <button type="button" className="b pri" onClick={() => U().finishWorkEarly()}><Icon name="check" />{t('Done')}</button>
          </div>}
        </div>
        <SeasonDeco spot="rest-timer" workout />
        {x && status}
      </div>, document.body)}
    {!x && status}
  </>
}

export default function RestTimer({ docked = false }) {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const countIn = useUI(s => s.countIn)
  const autoSay = useUI(s => s.autoSay)
  const { addRest, skipRest, pauseRest, resumeRest, finishWorkEarly, stopWork, goNow, stopAuto } = useUI()
  const on = countIn || work || timer
  const fused = useUI(fusedKind) && document.documentElement.dataset.platform === 'ios'
  const actsRef = useRef(null)
  const skipFits = useSkipFits(actsRef, [!!timer && !work, t('Skip'), t('Dismiss')])
  // The page keeps room at its bottom for the bar (index.css body.resting), so the last set and
  // the Finish button can scroll clear of it.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    return () => document.body.classList.remove('resting')
  }, [!!on])
  // The count-in's "3", "2", "1", "Go!", read out politely. Always in the page, in the same place,
  // so it is not a new region each time the bar changes from count-in to hold (a screen reader
  // reads a region that changes, not one that arrives with its words already in it).
  const say = <span className="vh" role="status" aria-live="polite">{autoSay}</span>
  if (!on) return say
  if (fused) return <>{say}{docked && <TimerRow docked />}</>
  const pct = Math.max(0, Math.min(100, ((on.left ?? on.total) / on.total) * 100))

  if (countIn) {
    const n = countIn.left ?? countIn.total
    const name = countIn.owner?.label || ''
    return <>{say}
      <div id="timer" className={'countin auto' + (countIn.paused ? ' paused' : '')}>
        <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
        <div className="tclock">
          <span className="t" key={n} aria-hidden="true">{n}</span>
          <span className="lbl">{countIn.waiting ? t('Waiting till you close that') : t('Get ready: {0}', name)}</span>
        </div>
        <div className="acts">
          <Button size="sm" variant="primary" icon="play" onClick={goNow}>{t('Go now')}</Button>
        </div>
        <AutoRow paused={countIn.paused} />
      </div>
    </>
  }
  // The bar shrinks by transform, not width: a width transition lays the page out again on every
  // frame of every rest (~45 layouts a second), a scaled bar is the compositor's alone.

  // A hold that runs itself trades Cancel for the chain's row: Restart and Stop auto cover it.
  if (work) return <>{say}
    <div id="timer" className={'working' + (work.auto ? ' auto' : '') + (work.paused ? ' paused' : '')}>
      <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <div className="tclock">
        <span className="t">{work.left <= 0 && work.overtime ? '+' + clock(-work.left) : clock(work.left)}</span>
        {work.label && <span className="lbl">{work.paused ? t('Paused') + ' · ' + work.label : work.label}</span>}
      </div>
      <div className="acts">
        {!work.auto && <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>}
        <Button size="sm" variant="primary" icon="check" onClick={() => finishWorkEarly()}>{t('Done')}</Button>
      </div>
      {work.auto && <AutoRow paused={work.paused} />}
    </div>
  </>
  // −15 and +15 sit together in number-line order; Skip is pushed to the far edge, away from the
  // button you tap to buy more time. Pause sits between them as an icon (#193): it holds the
  // time, it neither adds nor ends it. A rest that is over has nothing left to hold, so Ready
  // offers no pause, but its slot stays (an invisible stand-in) and Skip is as wide as Dismiss
  // (both labels share one cell, one of them hidden), and the clock keeps room for the other of
  // its two faces (data-alt, a hidden line in index.css): the row never reflows when the rest
  // turns Ready, so a thumb on +15 never lands on −15.
  const label = timer.kind === 'switch' ? t('Switch sides') : timer.paused ? t('Paused') : t('Rest')
  // A rest before a hold that starts by itself says which one, and offers Stop auto under the
  // rest's own buttons (which keep their places: Pause, +15 s and Skip are the chain's for a rest).
  const autoNext = !timer.ready && timer.autoNext
  return <>{say}
    <div id="timer" data-tour="rest" style={{ '--rest-p': pct / 100 }} className={'rest' + (timer.paused ? ' paused' : '') + (timer.kind === 'switch' ? ' switch' : '') + (timer.ready ? ' ready' : '') + (autoNext ? ' auto' : '')}>
      <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <SeasonDeco spot="rest-timer" workout />
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
            aria-label={t(timer.paused ? 'Resume' : 'Pause')}
            onClick={timer.paused ? resumeRest : pauseRest} />}
        <button type="button" className={'btn primary sm skip' + (skipFits ? '' : ' icon-only')} onClick={() => skipRest()}
          aria-label={skipFits ? undefined : t(timer.ready ? 'Dismiss' : 'Skip')}>
          {skipFits
            ? <span><span className="on">{t(timer.ready ? 'Dismiss' : 'Skip')}</span>
              <span className="off" aria-hidden="true">{t(timer.ready ? 'Skip' : 'Dismiss')}</span></span>
            : <Icon name={timer.ready ? 'xmark' : 'skipForward'} />}
          <span className="skip-probe" aria-hidden="true"><span>{t('Skip')}</span><span>{t('Dismiss')}</span></span>
        </button>
      </div>
      {autoNext && (
        <div className="autorow next">
          <span className="up">{t('Up next: {0}, starts by itself', autoNext)}</span>
          <Button size="sm" icon="xmark" onClick={stopAuto}>{t('Stop auto')}</Button>
        </div>
      )}
    </div>
  </>
}
