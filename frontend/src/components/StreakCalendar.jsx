import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { explainWeek, freezeLine } from '../lib/streak-explain.js'
import { StreakFlame, Freezes, FreezeGlyph } from './Streak.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

/* The streak, explained where you look at it: the month calendar (sheets.jsx Calendar) puts a
   mark at the end of every week (flame, freeze, missed, still open), washes a frozen week in the
   freeze's colour, and says in one line why a tapped week counted the way it did. Above it, what
   the number counts and the freezes, and the first time, four lines on how it all works.
   Discord, 11-04: a 43-week streak through a visibly patchy October read as a bug, and nobody
   knew what the snowflakes were. The walk itself is lib/streak.js; this only shows it. */

export const weekMarkLabel = s => ({ on: t('Counted'), frozen: t('Frozen'), open: t('Still open') }[s] || t('Missed'))

/** A week's mark: the flame, the freeze, a hollow ring (missed) or a dashed one (this week, open). */
export function MarkGlyph ({ s }) {
  if (s === 'on') return <StreakFlame />
  if (s === 'frozen') return <span className="wk-frz"><FreezeGlyph /></span>
  return <span className={'wk-ring' + (s === 'open' ? ' open' : '')} aria-hidden="true" />
}

/** The mark at the end of a calendar row: a button that selects the week, or nothing. */
export function WeekMark ({ wk, entry, selected, onSelect }) {
  if (!entry) return <span className="cal-wk" aria-hidden="true" />
  const label = t('Week of {0}', fmtDate(wk)) + ': ' + weekMarkLabel(entry.s)
  return <button type="button" className={'cal-wk is-' + entry.s + (selected ? ' sel' : '')} data-wk={wk}
    aria-label={label} aria-pressed={selected} title={label} onClick={() => onSelect(selected ? null : wk)}>
    <MarkGlyph s={entry.s} />
  </button>
}

/** Under the grid: the tapped week and why, or the hint to tap one. Read out when it changes. */
export function WeekNote ({ wk, entry }) {
  return <div className="wk-note small" aria-live="polite" data-wk-note>
    {wk && entry
      ? <><span className="wk-note-g" aria-hidden="true"><MarkGlyph s={entry.s} /></span>
        <span><b>{t('Week of {0}', fmtDate(wk))}.</b> {explainWeek(entry)}</span></>
      : <span className="muted">{t("Tap a week's mark to see how it counted.")}</span>}
  </div>
}

/** The four marks and their names, one quiet row under the calendar's dots. */
export function StreakLegend () {
  return <div className="cal-legend wk-legend" data-wk-legend>
    {['on', 'frozen', 'missed', 'open'].map(s => <span key={s}><span className="wk-legend-g" aria-hidden="true"><MarkGlyph s={s} /></span>{weekMarkLabel(s)}</span>)}
  </div>
}

/** How it works, in four lines: once by itself, then behind the (i) beside the streak. */
export function StreakHowTo ({ onDone }) {
  return <div className="streak-howto" data-streak-howto>
    <div className="streak-howto-t">{t('How your streak works')}</div>
    <ul>
      <li><span className="wk-legend-g" aria-hidden="true"><MarkGlyph s="on" /></span>{t('Every week with at least one workout adds one.')}</li>
      <li><span className="wk-legend-g" aria-hidden="true"><MarkGlyph s="frozen" /></span>{t('Every 4th week you train earns a freeze. You can bank 2.')}</li>
      <li><span className="wk-legend-g" aria-hidden="true"><MarkGlyph s="missed" /></span>{t('Miss a week and a freeze covers it: the streak keeps going, that week just adds nothing. No freeze left, and it starts over.')}</li>
      <li><span className="wk-legend-g" aria-hidden="true"><MarkGlyph s="open" /></span>{t('This week stays open until it ends. No pressure yet.')}</li>
    </ul>
    <Button size="sm" variant="tinted" onClick={onDone}>{t('Got it')}</Button>
  </div>
}

/**
 * The calendar's head: the streak and what it counts, the freezes with how the next is earned,
 * and the how-to (by itself until "Got it", S.streakHelpSeen, synced; `help` opens it anyway).
 */
export function StreakSummary ({ info, help = false }) {
  const seen = useStore(s => s.S.streakHelpSeen === true)
  const update = useStore(s => s.update)
  const [open, setOpen] = useState(help || !seen)
  const done = () => { setOpen(false); if (!seen) update(s => { s.streakHelpSeen = true }) }
  return <div className="streak-sum" data-streak-sum>
    <div className="streak-sum-top">
      <span className="streak-sum-flame" aria-hidden="true"><StreakFlame lit={info.current > 0} /></span>
      <div className="grow">
        <div className="streak-sum-n">{t('{0} week streak', info.current)}</div>
        <div className="muted small">{t('Weeks in a row with at least one workout.')}</div>
      </div>
      <button type="button" className="iconbtn streak-sum-i" aria-expanded={open} aria-label={t('How your streak works')}
        onClick={() => (open ? done() : setOpen(true))}><Icon name="info" /></button>
    </div>
    <div className="streak-sum-frz small">
      <Freezes n={info.freezes} />
      <span className="muted">{freezeLine(info)}</span>
    </div>
    {open && <StreakHowTo onDone={done} />}
  </div>
}
