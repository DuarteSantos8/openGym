import { useEffect } from 'react'
import { useUI } from '../store/useUI.js'
import { useStore } from '../store/useStore.js'
import { exOr } from '../lib/exercises.js'
import { supersetUnits } from '../lib/history.js'
import { restFocusIdx } from '../lib/supersetFlow.js'
import { t } from '../lib/i18n.js'
import { exerciseNameText } from '../lib/format.js'
import { realign } from '../lib/viewport-guard.js'
import { Button } from './ui.jsx'

const clock = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0')

// What the rest is for, in the words of the sound that will end it (lib/sound.js REST_OVER,
// decided by supersetFlow.restKind). A rest between sets also says whether the coming set is a
// warm-up (ramp) set or a working set, on exercises that have both — timer.phase, decided where
// the rest started (supersetFlow.restSetPhase). Rounds deliberately do not: a superset's members
// can be at different phases. A rest with no kind — none today — just says "Rest".
const KIND_LABEL = { set: 'Next set', round: 'Next round', block: 'Next exercise' }
const SET_LABEL = { warmup: 'Next warm-up set', work: 'Next working set' }
const restLabel = timer => {
  if (timer.kind === 'set') return SET_LABEL[timer.phase] || KIND_LABEL.set
  return KIND_LABEL[timer.kind] || 'Rest'
}

// One bar, two meanings: the rest countdown between sets, and the work countdown during a
// timed set (issue #16). They are mutually exclusive by construction — startWork() stops any
// running rest — so the bar can never have to show both, and a work set gets its own colour
// plus a "Done" that logs the time actually held.
export default function RestTimer() {
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)
  const { addRest, skipRest, pauseRest, resumeRest, finishWorkEarly, stopWork } = useUI()
  // The exercise the rest points you at (supersetFlow.restFocusIdx): the one whose set started
  // it for a plain set, the top of the superset for a round, the next exercise after a finished
  // one — so the name always agrees with the word before it.
  const forId = useStore(s => {
    if (!timer || timer.forIdx == null) return undefined
    const entries = s.S.active?.entries
    if (!entries) return undefined
    return entries[restFocusIdx(entries, supersetUnits(entries), timer.forIdx, timer.kind)]?.id
  })
  const on = work || timer
  // The bar is fixed above the tab bar and floats over whatever is beneath it — during a
  // rest that was the next set's row. Extra bottom padding lets the page scroll clear.
  useEffect(() => {
    document.body.classList.toggle('resting', !!on)
    // The bar leaving takes that padding back — the page gets ~210px shorter at once, often in
    // the same commit that ticks a set or swaps the card. When that clamps the scroll
    // position, iOS can be left with the two viewports apart: the tab bar mid-screen, scrolling
    // with the page. Ask for them to be checked once the layout has settled; a no-op wherever
    // they already agree (lib/viewport-guard.js).
    const frame = on ? null : requestAnimationFrame(() => realign())
    return () => { if (frame) cancelAnimationFrame(frame); document.body.classList.remove('resting') }
  }, [!!on])
  if (!on) return null
  const pct = Math.max(0, Math.min(100, (on.left / on.total) * 100))

  // Same three rows as the rest variant: what is running (which hold of the exercise, warm-up
  // holds counted apart like the set rows), clock and bar, controls. Cancel abandons the hold
  // without logging it; Done logs what was actually held.
  if (work) {
    const hs = work.set
    const what = !hs ? t('Hold') : hs.phase === 'warmup' ? t('Warm-up hold {0} of {1}', hs.n, hs.of) : t('Hold {0} of {1}', hs.n, hs.of)
    return (
      <div id="timer" className="working">
        <div className="lbl"><b>{what}</b>{work.label && <span className="who"> · {work.label}</span>}</div>
        <div className="head">
          <div className="t">{work.left <= 0 && work.overtime ? '+' + clock(-work.left) : clock(work.left)}</div>
          <div className="bar"><i style={{ width: pct + '%' }} /></div>
        </div>
        <div className="acts">
          <Button size="sm" onClick={stopWork}>{t('Cancel')}</Button>
          <Button size="sm" variant="primary" icon="check" className="go" onClick={finishWorkEarly}>{t('Done')}</Button>
        </div>
      </div>
    )
  }
  const name = forId ? exerciseNameText(exOr(forId)) : ''
  // Three controls plus the clock don't fit one line on a phone — at 360px the bar is left
  // with about 30px and stops saying anything. So the rest variant stacks: what is being timed
  // on top, clock and bar read at a glance, controls get their own row. −15 and +15 sit
  // together in number-line order; Skip is pushed to the far edge, away from the button you
  // tap to buy more time.
  // Pause sits between them as an icon (#193): it holds the time, it neither adds nor ends it.
  // A rest that is over has nothing left to hold, so Ready offers no pause.
  return (
    <div id="timer" className={'rest' + (timer.paused ? ' paused' : '')}>
      <div className="lbl"><b>{t(restLabel(timer))}</b>{name && <span className="who"> · {name}</span>}</div>
      <div className="head">
        <div className="t" role={timer.ready ? 'status' : undefined}>{timer.ready ? t('Ready') : clock(timer.left)}</div>
        <div className="bar"><i style={{ width: pct + '%' }} /></div>
      </div>
      <div className="acts">
        <Button size="sm" icon="minus" onClick={() => addRest(-15)}>15s</Button>
        <Button size="sm" icon="plus" onClick={() => addRest(15)}>15s</Button>
        {!timer.ready && <Button size="sm" className="pause" icon={timer.paused ? 'play' : 'pause'}
          aria-label={t(timer.paused ? 'Resume' : 'Pause')} aria-pressed={!!timer.paused}
          onClick={timer.paused ? resumeRest : pauseRest} />}
        <Button size="sm" variant="primary" className="skip" onClick={() => skipRest()}>{t(timer.ready ? 'Dismiss' : 'Skip')}</Button>
      </div>
    </div>
  )
}
