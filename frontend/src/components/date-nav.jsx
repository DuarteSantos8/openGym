import { useEffect, useRef, useState } from 'react'
import { t, dateLocale } from '../lib/i18n.js'
import { isoOf, MONDAY, startOfWeek, todayISO } from '../lib/format.js'
import { cx, oneOf } from '../lib/ui-kit.js'
import { calendarSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

// The date navigation Home, Training and Nutrition share (ui-redesign-components §1): the month
// over a week of days, one selected date for all of them. Dates are ISO days ('2026-10-15').

const noon = iso => new Date(iso + 'T12:00:00')
const shift = (iso, days) => { const d = noon(iso); d.setDate(d.getDate() + days); return isoOf(d) }
const fmt = (iso, options) => noon(iso).toLocaleDateString(dateLocale(), options)

// The month of `date` as a button that opens the calendar (onPickDate gets the day picked there),
// and "Today" at the other end. Today keeps its place while today is the date (hidden, not
// removed), so the label never moves. `onPickFuture`: days after today are tappable in the calendar
// and go there, not to onPickDate; without it they are dimmed.
export function MonthBar({ date, onPickDate, onPickFuture, onToday }) {
  const today = todayISO()
  const month = fmt(date, { month: 'long', year: 'numeric' })
  return (
    <div className="month-bar">
      <button type="button" className="month-bar-l" aria-haspopup="dialog" aria-label={t('Choose a day, {0}', month)}
        onClick={() => calendarSheet(date, { onPick: onPickDate, onFuture: onPickFuture })}>
        <span>{month}</span><Icon name="chevronDown" />
      </button>
      <button type="button" className={cx('month-bar-today', date === today && 'off')} onClick={onToday}>{t('Today')}</button>
    </div>
  )
}

const MARKS = ['done', 'plan', 'ovr', 'noted']
const MARK_LABEL = { done: () => t('Workout done'), plan: () => t('Planned'), ovr: () => t('Plan changed'), noted: () => t('Day note') }
const SWIPE_PX = 40

// The week around `date`, a day each: selected, today, and a dot for what the day holds
// (`marks`: { iso: 'done' | 'plan' | 'ovr' | 'noted' }, or a function of the iso for a strip that
// can be swiped to any week). A tap selects a day (onSelect); a day after `maxDate` cannot be
// picked. A horizontal swipe, or the arrow keys past either end, shows the week before or after
// without changing the date. `weekStart` is a getDay() index.
export function WeekStrip({ date, onSelect, marks = {}, maxDate, weekStart = MONDAY }) {
  const markOf = typeof marks === 'function' ? marks : iso => marks[iso]
  const anchorOf = iso => isoOf(startOfWeek(iso, weekStart))
  const [view, setView] = useState(() => ({ anchor: anchorOf(date), date, weekStart, dir: 0 }))
  // A new date (picked here or anywhere else) or week start brings its own week back.
  if (view.date !== date || view.weekStart !== weekStart) {
    const anchor = anchorOf(date)
    setView({ anchor, date, weekStart, dir: anchor === view.anchor ? view.dir : anchor > view.anchor ? 1 : -1 })
  }
  const grid = useRef(null)
  const focusAt = useRef(null)
  const press = useRef(null)
  const swiped = useRef(false)
  const today = todayISO()
  const days = Array.from({ length: 7 }, (_, i) => shift(view.anchor, i))
  const canNext = !maxDate || shift(view.anchor, 7) <= maxDate

  const move = (dir, focus = null) => {
    if (dir > 0 && !canNext) return false
    focusAt.current = focus
    setView(v => ({ ...v, anchor: shift(v.anchor, dir * 7), dir }))
    return true
  }
  useEffect(() => {
    if (focusAt.current == null) return
    grid.current?.querySelectorAll('button')[focusAt.current]?.focus()
    focusAt.current = null
  }, [view.anchor])

  const onKeyDown = (e, i) => {
    const rtl = document.documentElement.dir === 'rtl'
    const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0
    if (!step) return
    e.preventDefault()
    const next = i + step
    if (next >= 0 && next < 7) grid.current.querySelectorAll('button')[next].focus()
    else move(step, next < 0 ? 6 : 0)
  }
  const onPointerDown = e => { press.current = { x: e.clientX, y: e.clientY }; swiped.current = false }
  const onPointerUp = e => {
    const p = press.current
    press.current = null
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy)) return
    const rtl = document.documentElement.dir === 'rtl'
    swiped.current = true
    move((dx < 0) !== rtl ? 1 : -1)
  }
  // The click a swipe ends with lands on a day; it is the swipe, not a pick.
  const onClickCapture = e => { if (swiped.current) { swiped.current = false; e.stopPropagation() } }

  return (
    <div className="wk-strip" role="group" aria-label={t('Week')} onClickCapture={onClickCapture}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { press.current = null }}>
      <div ref={grid} key={view.anchor} className={cx('wk-days', view.dir > 0 && 'from-next', view.dir < 0 && 'from-prev')}>
        {days.map((iso, i) => {
          const mark = oneOf('WeekStrip', 'marks', markOf(iso), MARKS)
          const label = [fmt(iso, { weekday: 'long', day: 'numeric', month: 'long' }), mark && MARK_LABEL[mark]()].filter(Boolean).join(', ')
          return (
            <button key={iso} type="button" className={cx('wk-d', iso === date && 'sel', iso === today && 'today')}
              aria-pressed={iso === date} aria-current={iso === today ? 'date' : undefined} aria-label={label}
              disabled={!!maxDate && iso > maxDate} onClick={() => onSelect(iso)} onKeyDown={e => onKeyDown(e, i)}>
              <span className="wk-n">{fmt(iso, { weekday: 'short' })}</span>
              <span className="wk-num">{noon(iso).getDate()}</span>
              <span className={cx('wk-dot', mark)} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

// A read-only week (Progress → Training load): a dot per day, filled where it was trained. One
// image to a screen reader, named by `label` or by the count.
export function WeekDots({ days, label }) {
  const done = days.filter(d => d.done).length
  return (
    <div className="wk-dots" role="img" aria-label={label || t('Trained on {0} of {1} days', done, days.length)}>
      {days.map(d => (
        <span key={d.iso} className={cx('wk-dots-d', d.done && 'done')}>
          <span className="wk-dots-n">{fmt(d.iso, { weekday: 'short' })}</span>
          <span className="wk-dots-c" />
        </span>
      ))}
    </div>
  )
}
