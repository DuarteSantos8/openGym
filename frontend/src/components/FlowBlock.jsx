import { useUI } from '../store/useUI.js'
import { exOr } from '../lib/exercises.js'
import { modeOf, fmtSec, setSpanAt } from '../lib/history.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { supersetFlowStep } from '../lib/supersetFlow.js'
import { flowProgress, flowSetsOf } from '../lib/blocks.js'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exerciseNameText } from '../lib/format.js'
import Media from './Media.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// Whole sentences per block, never a sentence built around the block's name: "Start {0}" with a
// lowercased title read "aufwärmen starten" in German and "Начать разминка" in Russian, and the
// case, gender and article a language needs differ between warm-up, cool-down and flow. Literal
// t() calls, so check-source-strings sees every key.
const BLOCK_TEXT = {
  warmup: () => ({ title: t('Warm-up'), start: t('Start warm-up'), resume: t('Resume warm-up'), done: t('Warm-up complete') }),
  cooldown: () => ({ title: t('Cool-down'), start: t('Start cool-down'), resume: t('Resume cool-down'), done: t('Cool-down complete') }),
  flow: () => ({ title: t('Flow'), start: t('Start flow'), resume: t('Resume flow'), done: t('Flow complete') }),
}

/**
 * A block of timed movements as one screen instead of twelve cards.
 *
 * A warm-up is six movements twice over, and in the card and list layouts getting through it
 * means a tap to start each hold, a tap to tick it off and a swipe to the next one — thirty-odd
 * taps before the bar is touched. Here the block runs itself: one tap starts it, each hold
 * hands straight over to the next movement, the round's short rest carries into the round after
 * it, and the screen says what is being held now and what is coming. Nothing is tapped in
 * between. Which blocks get this screen is decided by lib/blocks.js from the block's own shape,
 * not by a setting and not by a label stored with the routine.
 *
 * The chain itself lives in Workout.jsx (flowHold, and the rest's hand-over: timer.hand.flow),
 * beside the rest and hold handling it has to agree with — this renders what is running and offers
 * the one button that is ever needed.
 */
export default function FlowBlock({ entries, unit, cur, block, onResume, onRows }) {
  const work = useUI(s => s.work)
  const timer = useUI(s => s.timer)
  const progress = flowProgress(entries, unit)
  // A hold belongs to the row it writes to (work.owner, kept current when rows or exercises move).
  const holding = work && unit.includes(work.owner?.idx) ? work : null
  // A rest that has run out and sits on the bar as Ready is not a countdown any more. It is what
  // a round's rest leaves when it ended with the phone locked: the hand-over moved the screen but
  // started no hold nobody watched. The card treats it as nothing running and offers its Resume,
  // so going on is one tap (the hold it starts takes the Ready bar down), not Dismiss and then
  // Resume.
  const resting = timer && !timer.ready && unit.includes(timer.forIdx) ? timer : null
  // Where the block stands right now: the movement being held, or the one the next tap starts.
  // Not `cur` — during the rest between rounds the marker is still on the movement that ended
  // the round, while the round starts again at the top.
  const at = holding ? holding.owner.idx : (progress.at ?? (unit.includes(cur) ? cur : unit[0]))
  const step = at == null ? null : supersetFlowStep(entries, unit, at)
  const next = step && step.nextIdx != null && step.nextIdx !== at ? step.nextIdx : null
  // A per-side hold is a left row and a right row of one movement (history.js buildSets), held one
  // after the other: left, then the Switch sides pause or the right side's get-ready count, then
  // right. With no side named, the two halves would show the same name, clock and "Hold", and Next
  // would name the movement after both. So the line under the clock names the side of the row the
  // block stands on (`rowI`: the one being held, counted to or paused, or the one the next tap
  // starts, flowHold's first not done). While that is the left side, Next is the right side. During
  // a Switch sides pause, Next is the side the pause hands over to. A rest between rounds names
  // neither: it hands over to the left side, and "Rest" over "Next · Right side" would read like
  // the switch pause.
  const rows = at == null || (holding && entries[at]?.id !== holding.owner.id) ? [] : (entries[at]?.sets || [])
  const rowI = holding ? holding.owner.i : rows.findIndex(s => !s.done)
  const sideAt = i => (rows[i] && !isWarmupRow(rows[i]) && (rows[i].side === 'L' || rows[i].side === 'R') ? rows[i].side : null)
  const side = sideAt(rowI)
  const [pairAt, pairN] = rowI >= 0 ? setSpanAt(rows, rowI) : [rowI, 1]
  const other = side && pairN === 2 ? (pairAt === rowI ? rowI + 1 : pairAt) : -1
  const nextSide = holding || !resting ? (other >= 0 && !rows[other].done ? sideAt(other) : null)
    : resting.kind === 'switch' && resting.forIdx === at ? side : null
  const sideWord = s => (s === 'L' ? t('Left side') : s === 'R' ? t('Right side') : null)
  const withSide = word => (side ? word + ' · ' + sideWord(side) : word)
  const started = unit.some(i => entries[i]?.sets?.some(s => s.done))
  const paused = !!holding?.paused
  // The get-ready count in front of a hold (Settings; useUI.startWork's prep): the movement named
  // above is the one about to start, and the clock is the count to it.
  const prepping = !!holding?.prep
  // This block owns a countdown — running or frozen. While it does, the fixed timer bar is on
  // screen carrying Pause, Resume and Done for it, so the card says nothing about controls, or the
  // movement name and the clock would appear twice, 200px apart, for one countdown.
  const onTheClock = !!(holding || resting)

  const nameOf = i => exerciseNameFor(exOr(entries[i]?.id))
  // Title-cased only where the language wants it (lib/i18n-core.js exerciseNameClass): a German
  // name carries its own capitals, and CSS capitalize put one on every word ("Kniebeuge Mit Band").
  const nameClass = i => exerciseNameClass(exOr(entries[i]?.id))
  const planOf = i => {
    const e = entries[i]
    if (!e) return ''
    const row = e.sets.find(s => !s.done) || e.sets[e.sets.length - 1]
    return fmtSec(row?.planSec || row?.sec || e.target?.sec || 0)
  }
  const text = (BLOCK_TEXT[block] || BLOCK_TEXT.flow)()
  const title = text.title

  return (
    <div className="flowblk" data-testid="flow-block">
      <div className="flowblk-hd">
        <span className="row" style={{ gap: 5 }}><Icon name="timer" />{title}</span>
        <span className="grow" />
        {progress.rounds > 1 && <span className="muted small">{t('Round {0} of {1}', progress.round, progress.rounds)}</span>}
        {/* It says Rows, so it shows rows — one tap, no sheet. It does not open the three-way
            Flow/Rows/Automatic menu, which is a settings decision and does not belong on the
            screen you are standing on mid warm-up, out of breath, having tapped the word for
            the thing you wanted. The full choice is still one level down, on the ⋯ of every
            exercise in the block (Workout.jsx blockLayoutItems), and that is also the way back
            in — this button writes the same 'rows' the menu's own row writes, so nothing about
            the block becomes unreachable by taking it. */}
        <Button size="xs" variant="ghost" icon="list" title={t('Show rows')} onClick={onRows}>{t('Rows')}</Button>
      </div>

      {progress.done ? (
        <div className="flowblk-done"><Icon name="checkCircle" /><div>{text.done}</div></div>
      ) : <>
        {/* Compact (120px), not the full 320px an exercise card gives it. A flow block is read
            at arm's length and the clock is what it is read for: at full size the media alone
            took half the viewport and pushed the countdown behind the timer bar — verified on
            WebKit at 393×659, where the clock landed at 443px under a bar starting at 423.
            The animation is reference here, not the thing you are looking at. `minimizable`
            stays, so Settings' mini (84px) and off still win over this. */}
        {at != null && <Media ex={exOr(entries[at]?.id)} key={entries[at]?.id} compact minimizable />}
        <div className="flowblk-now">
          <div className={'flowblk-name ' + (at == null ? '' : nameClass(at))}>{at == null ? '' : nameOf(at)}</div>
          {/* The clock is the whole point of the screen: the hold counting down, or the gap
              before the next round. With neither running it shows what the movement is asking
              for, so the number never disappears and leave the card looking switched off. */}
          <div className={'flowblk-clock' + (paused ? ' paused' : resting && !holding ? ' resting' : '')}>
            {prepping ? fmtSec(holding.prep) : holding ? fmtSec(holding.left) : resting ? fmtSec(resting.left) : (at == null ? '' : planOf(at))}
          </div>
          <div className="muted small">
            {paused ? withSide(t('Paused')) : prepping ? withSide(t('Get ready')) : holding ? (side ? sideWord(side) : t('Hold')) : resting ? (resting.kind === 'switch' ? t('Switch sides') : t('Rest')) : withSide(started ? t('Paused') : t('Ready'))}
          </div>
        </div>

        <div className="flowblk-list">
          {unit.map(i => {
            const done = entries[i]?.sets?.every(s => s.done)
            const roundDone = flowSetsOf(entries[i]).filter(s => s.done).length >= progress.round
            return <div key={i} className={'flowblk-mv' + (i === at ? ' at' : '') + (done ? ' done' : '')} data-exidx={i}>
              <span className="flowblk-dot"><Icon name={done ? 'checkCircle' : roundDone ? 'check' : 'dot'} /></span>
              <span className={'grow tt ' + nameClass(i)}>{nameOf(i)}</span>
              <span className="muted small">{modeOf({ ...(entries[i]?.target || {}), id: entries[i]?.id }) === 'time' ? planOf(i) : ''}</span>
            </div>
          })}
        </div>

        {(nextSide || next != null) && !progress.done && <div className={'flowblk-next muted small' + (nextSide ? ' side' : '')}>
          <Icon name="chevronRight" />{t('Next · {0}', nextSide ? sideWord(nextSide) : exerciseNameText(exOr(entries[next]?.id)))}
        </div>}

        {/* The card's one button exists for the moments when there is no countdown and therefore
            no timer bar: before the first tap, and after a hold that ran out while the phone was
            locked. It is full width and 17px for the same reason the clock is 56px — it gets
            pressed at arm's length, out of breath. While something IS counting down, the bar has
            the controls and this is deliberately empty. */}
        {!onTheClock && at != null && <Button variant="primary" icon="play" className="flowblk-go" onClick={onResume}>
          {started ? text.resume : text.start}
        </Button>}
      </>}
    </div>
  )
}
