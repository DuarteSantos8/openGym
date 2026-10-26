import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { holdPosition } from '../lib/workout-model.js'
import { flowUnitAt } from '../lib/blocks.js'
import { t } from '../lib/i18n.js'
import { REST_MAX } from '../lib/duration.js'
import { durationSheet } from './DurationWheel.jsx'
import { realign } from '../lib/viewport-guard.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'
import { SeasonDeco } from './Seasonal.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// What a rest leads into, under the clock where "Rest" was: the kind decided where the rest
// started (timer.kind, supersetFlow.restKind), the same kind that picks the sound it ends with
// when Settings → Sound gives that kind one of its own. One word, and no exercise name: the label
// line is as wide as the clock's widest face or the widest of these words, whichever is wider
// (index.css #timer .lbl, .lbl-alts). A rest with no kind
// (one started from the wheel with nothing running) says "Rest". A rest before a warm-up (ramp)
// set says "Warm-up" instead of "Set" (timer.phase, decided where the rest started from the set
// it leads into, supersetFlow.restSetPhase). Rounds do not: a superset's members can be at
// different phases.
const KIND_LABEL = { set: 'Set', round: 'Round', block: 'Exercise' }
const restLabel = timer => timer.kind === 'set' && timer.phase === 'warmup' ? 'Warm-up' : KIND_LABEL[timer.kind] || 'Rest'
// Every word an ordinary rest's label can say. The clock's column takes the width of the widest
// in the language on screen, so a long one fits ("Упражнение" was 85 px in a 76 px column on a
// 320 px phone) and the buttons beside it stand in the same place in every rest.
const REST_WORDS = ['Set', 'Round', 'Exercise', 'Warm-up', 'Rest', 'Paused']
// The hold's label follows the same rule: what is timed, short. Which hold of the exercise it is,
// warm-up holds counted apart and a per-side pair as one set, as the set rows number them. Read
// off the hold's owner (work.owner, the row it writes to, kept current when rows move), so a hold
// restored after a reload says it too.
const holdLabel = (S, work) => {
  const o = work?.owner
  const e = o ? S.active?.entries?.[o.idx] : null
  const pos = e && e.id === o.id ? holdPosition(e.sets, o.i) : null
  if (!pos) return t('Hold')
  return pos.phase === 'warmup' ? t('Warm-up hold {0} of {1}', pos.n, pos.of) : t('Hold {0} of {1}', pos.n, pos.of)
}

// The clock is a button: a tap opens the wheel at the time that is left, for a rest that wants
// to be a round 2:00 rather than eight taps of +15. 0:00 ends the rest, like Skip, and hands
// over what Skip would (useUI.skipRest: a timed exercise's next hold). What is left
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
// 0:00, or a fresh rest when the old one has run out (Ready) or was skipped meanwhile. A fresh
// rest from Ready is +15 s's on Ready (useUI.addRest): it keeps what the old one led into, and
// so the sound it ends with.
export function applyRestLeft(v, opened) {
  if (opened !== undefined && v === opened) return
  const ui = useUI.getState()
  const now = ui.timer
  // Nothing running: a fresh rest, unless a hold took over while the wheel was open (a timed
  // exercise that runs itself), which a rest would cut off.
  if (!now) { if (v > 0 && !ui.work) ui.startRest(v); return }
  if (v <= 0) { ui.skipRest(); return }
  if (now.ready) { ui.addRest(v); return }
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

// In a flow the bar goes from a hold's get-ready count to the hold and on to the gap between
// rounds, and the button beside the pause says Start, Done, Skip and, once a gap is over, Dismiss.
// The row is right-aligned, so every word of another width moved the pause: 11 px in English
// between a hold and the gap, up to 47 px on a 320 px phone (WebKit, 2026-10-07). There the button
// carries all four, stacked in one cell with the one in use showing, the way Skip carries Dismiss
// below, and the two buttons are sized alike (index.css #timer .acts .flow-words and .go.flow):
// one width throughout, so the pause stays where the thumb left it. Not if the gap's Skip has to
// drop to its icon (useSkipFits): the hold's Done has no such fallback. In no language on a 320 px
// phone does it have to (WebKit, same day).
const flowWords = on => (
  <span className="flow-words">
    {[['start', 'play', t('Start')], ['done', 'check', t('Done')], ['skip', null, t('Skip')], ['dismiss', null, t('Dismiss')]].map(([k, icon, word]) =>
      <span key={k} className={k === on ? 'on' : 'off'} aria-hidden={k === on ? undefined : 'true'}>{icon && <Icon name={icon} />}{word}</span>)}
  </span>
)

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
  const { addRest, skipRest, pauseRest, resumeRest, finishWorkEarly, stopWork, pauseWork, resumeWork } = useUI()
  const holdLbl = useStore(s => (work ? holdLabel(s.S, work) : ''))
  // Whether this countdown belongs to a block that is running itself (lib/blocks.js flowUnitAt:
  // the shape says flow and the user has not put it back into rows). A flow block is the one
  // thing on the workout screen that keeps going without being touched, so it is the one that
  // needs stopping — and this bar is the only control that is fixed on screen while it runs.
  const inFlow = useStore(s => !!flowUnitAt(s.S.active, work ? work.owner?.idx : timer?.forIdx))
  const on = work || timer
  const actsRef = useRef(null)
  // In a flow the gap has no ±15 s, so Skip has their room too.
  const skipFits = useSkipFits(actsRef, [!!timer && !work, inFlow, t('Skip'), t('Dismiss')])
  // The page keeps room at its bottom for the bar (index.css body.resting), so the last set and
  // the Finish button can scroll clear of it. The room comes in the same layout as the bar, before
  // anything is drawn: a flow card loses its Start button as its first hold starts, and with the
  // room a frame late the page was 50 px shorter for that frame. Scrolled near its end, WebKit then
  // pulled the scroll position back, and the card jumped down the screen as the hold began.
  useLayoutEffect(() => {
    document.body.classList.toggle('resting', !!on)
    // The bar leaving takes that room back — the page gets shorter at once, often in the same
    // commit that ticks a set or swaps the card. When that clamps the scroll position, iOS
    // can be left with the two viewports apart: the bars mid-screen, scrolling with the page. Ask
    // for them to be checked once the layout has settled; a no-op wherever they already agree
    // (lib/viewport-guard.js).
    const frame = on ? null : requestAnimationFrame(() => realign())
    return () => { if (frame) cancelAnimationFrame(frame); document.body.classList.remove('resting') }
  }, [!!on])
  if (!on) return null
  // A hold still in its get-ready count (useUI.startWork's prep) shows the count, not the hold.
  const prepping = !!work?.prep
  const pct = prepping ? Math.max(0, Math.min(100, (work.prep / work.prepTotal) * 100))
    : Math.max(0, Math.min(100, (on.left / on.total) * 100))
  // The bar shrinks by transform, not width: a width transition lays the page out again on every
  // frame of every rest (~45 layouts a second), a scaled bar is the compositor's alone.

  // A flow block can freeze its hold (useUI.pauseWork) and the bar is the fixed thing on screen,
  // so it has to say so — otherwise a clock that has stopped moving reads as a hung timer. Done
  // still works on a frozen hold, and logs the seconds it really held.
  if (work) return (
    <div id="timer" className={'working' + (work.paused ? ' paused' : '')}>
      <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <div className="tclock">
        <span className="t">{prepping ? clock(work.prep) : work.left <= 0 && work.overtime ? '+' + clock(-work.left) : clock(work.left)}</span>
        <span className="lbl">{work.paused ? t('Paused') : prepping ? t('Get ready') : holdLbl}</span>
      </div>
      {/* In a flow block, Pause takes Cancel's place. The two both stop the countdown and the
          difference between them is one word — Pause keeps the seconds and the movement, Cancel
          throws both away — which is not a distinction to make at arm's length, out of breath,
          on the control you reach for when the phone rings. Cancel is still there for an
          ordinary hold, where nothing is going to carry on by itself if you get it wrong. The
          pause is the rest's own icon button, so in a flow it sits in the same place during a
          hold and during the gap between rounds. A hold that is frozen keeps it whatever the block
          does meanwhile: put back into rows during the pause, it would otherwise be left with
          Cancel and Done and no way to carry on. */}
      <div className="acts">
        {inFlow || work.paused
          ? <Button size="sm" className="pause" icon={work.paused ? 'play' : 'pause'}
            aria-label={t(work.paused ? 'Resume' : 'Pause')} aria-pressed={!!work.paused}
            onClick={work.paused ? resumeWork : pauseWork} />
          : <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>}
        {/* In the get-ready count there is nothing held to log: the same button starts the hold now. */}
        {inFlow
          ? <button type="button" className="btn primary sm go flow" onClick={finishWorkEarly}>{flowWords(prepping ? 'start' : 'done')}</button>
          : <Button size="sm" variant="primary" icon={prepping ? 'play' : 'check'} className="go" onClick={finishWorkEarly}>{prepping ? t('Start') : t('Done')}</Button>}
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
  // A flow block's gap between rounds is 10-15 s, so ±15 s is not an adjustment — it is a skip
  // and a doubling, and the flow leaves them out. The pause (#193) is what a break you did not
  // plan wants: it holds the gap, and Resume carries on into the next movement. Skip stays; it is
  // the other half — "I'm ready now".
  // The switch pause between a per-side hold's two sides says one word, and its label has no
  // chevron. The label is only as wide as the clock (index.css #timer .lbl), and "Switch sides"
  // with the chevron did not fit it even in English, on an iPhone 17 Pro Max or a 320 px phone
  // (WebKit). One word without the chevron fits in English and all 18 languages on both, in a flow
  // or not. The clock still opens the wheel when tapped; a 10 s pause rarely wants it.
  const switching = timer.kind === 'switch'
  const label = switching ? t('Switch') : timer.paused ? t('Paused') : t(restLabel(timer))
  return (
    <div id="timer" data-tour="rest" className={'rest' + (timer.paused ? ' paused' : '') + (switching ? ' switch' : '') + (timer.ready ? ' ready' : '')}>
      <div className="bar" aria-hidden="true"><i style={{ transform: `scaleX(${pct / 100})` }} /></div>
      <SeasonDeco spot="rest-timer" workout />
      <button type="button" className="tclock" onClick={adjustRestSheet}
        aria-label={(timer.ready ? t('Ready') : clock(timer.left)) + '. ' + t('Change the time left')}>
        <span className="t" role={timer.ready ? 'status' : undefined} data-alt={timer.ready ? '0:00' : t('Ready')}>{timer.ready ? t('Ready') : clock(timer.left)}</span>
        <span className="lbl">{label}{!switching && <Icon name="chevronDown" />}</span>
        <span className="lbl-alts" aria-hidden="true">{REST_WORDS.map(w => <span key={w}>{t(w)}<Icon name="chevronDown" /></span>)}</span>
      </button>
      <div className="acts" ref={actsRef}>
        {!inFlow && <>
          <Button size="sm" className="adj" icon="minus" onClick={() => addRest(-15)}>15s</Button>
          <Button size="sm" className="adj" icon="plus" disabled={!timer.ready && timer.left >= REST_MAX} onClick={() => addRest(15)}>15s</Button>
        </>}
        {timer.ready
          ? <Button size="sm" className="pause-slot" icon="pause" disabled tabIndex={-1} aria-hidden="true" />
          : <Button size="sm" className="pause" icon={timer.paused ? 'play' : 'pause'}
            aria-label={t(timer.paused ? 'Resume' : 'Pause')} aria-pressed={!!timer.paused}
            onClick={timer.paused ? resumeRest : pauseRest} />}
        {/* In a flow it carries the hold's words too (flowWords), and its probe measures all four. */}
        <button type="button" className={'btn primary sm skip' + (inFlow ? ' flow' : '') + (skipFits ? '' : ' icon-only')} onClick={() => skipRest()}
          aria-label={skipFits ? undefined : t(timer.ready ? 'Dismiss' : 'Skip')}>
          {skipFits
            ? inFlow ? flowWords(timer.ready ? 'dismiss' : 'skip')
              : <span><span className="on">{t(timer.ready ? 'Dismiss' : 'Skip')}</span>
                <span className="off" aria-hidden="true">{t(timer.ready ? 'Skip' : 'Dismiss')}</span></span>
            : <Icon name={timer.ready ? 'xmark' : 'skipForward'} />}
          <span className="skip-probe" aria-hidden="true">{inFlow ? <span>{flowWords(null)}</span> : <><span>{t('Skip')}</span><span>{t('Dismiss')}</span></>}</span>
        </button>
      </div>
    </div>
  )
}
