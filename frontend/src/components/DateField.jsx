// openGym's own date field (#809). The system <input type="date"> looked different on every
// phone, and on iOS 27 WebKit drew it wider than the sheet it sat in, so the body-weight sheet
// scrolled sideways. This is a plain button that looks like the app's other fields and opens a
// month grid in the same style as the training calendar (sheets.jsx, Calendar): the same day
// cells, accent ring on today, month arrows, the profile's first weekday.
//
// The value stays an ISO 'YYYY-MM-DD' string, exactly what the native input gave, so callers and
// saved data do not change. `min` and `max` are ISO strings too; days outside them are disabled.
//
//   <DateField value={date} max={todayISO()} onChange={setDate} label={t('Date')} />
//   <DateField compact ... />   inside a Row, in place of <input type="date" className="timef">
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate, todayISO, DAYS, MONTHS, MONTHS_LONG, weekOrder, weekStartOf, weekDayOffset } from '../lib/format.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const ISO = /^\d{4}-\d{2}-\d{2}$/
const pad = n => String(n).padStart(2, '0')
const isoOf = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d)
const monthKey = (y, m) => y + '-' + pad(m + 1)
// Day arithmetic at local noon, so a DST switch can never move it to the day before.
const addDays = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d.getFullYear(), d.getMonth(), d.getDate())
}
const addMonths = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number)
  const first = new Date(y, m - 1 + n, 1, 12)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return isoOf(first.getFullYear(), first.getMonth(), Math.min(d, last))
}
const clamp = (iso, min, max) => (min && iso < min ? min : max && iso > max ? max : iso)

export function DatePicker({ value, min, max, label, onPick, close }) {
  const ws = weekStartOf(useStore(s => s.S))
  const today = todayISO()
  const start = clamp(ISO.test(value || '') ? value : today, min, max)
  const [cur, setCur] = useState(() => ({ y: +start.slice(0, 4), m: +start.slice(5, 7) - 1 }))
  const [view, setView] = useState('days')
  const [focusIso, setFocusIso] = useState(start)
  const grid = useRef(null)
  const moveFocus = useRef(true)
  const { y, m } = cur
  const minM = min ? min.slice(0, 7) : null, maxM = max ? max.slice(0, 7) : null
  const outM = (yy, mm) => (minM && monthKey(yy, mm) < minM) || (maxM && monthKey(yy, mm) > maxM)
  const outD = iso => (min && iso < min) || (max && iso > max)

  // The day that keyboard focus lands on: the picked one, or the 1st (in range) of a month
  // reached with the arrows.
  useEffect(() => {
    if (!moveFocus.current || view !== 'days') return
    moveFocus.current = false
    grid.current?.querySelector('[data-iso="' + focusIso + '"]')?.focus()
  }, [focusIso, view, y, m])

  const pick = iso => { if (outD(iso)) return; close(); onPick(iso) }
  const showMonth = (yy, mm) => {
    const d = new Date(yy, mm, 1, 12)
    const ny = d.getFullYear(), nm = d.getMonth()
    setCur({ y: ny, m: nm })
    setFocusIso(clamp(focusIso.slice(0, 7) === monthKey(ny, nm) ? focusIso : isoOf(ny, nm, 1), min, max))
  }
  const onKey = e => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    let next = null
    if (step) next = addDays(focusIso, step)
    else if (e.key === 'PageUp') next = addMonths(focusIso, e.shiftKey ? -12 : -1)
    else if (e.key === 'PageDown') next = addMonths(focusIso, e.shiftKey ? 12 : 1)
    else if (e.key === 'Home') next = addDays(focusIso, -weekDayOffset(new Date(focusIso + 'T12:00:00').getDay(), ws))
    else if (e.key === 'End') next = addDays(focusIso, 6 - weekDayOffset(new Date(focusIso + 'T12:00:00').getDay(), ws))
    if (!next) return
    e.preventDefault()
    next = clamp(next, min, max)
    moveFocus.current = true
    setFocusIso(next)
    if (next.slice(0, 7) !== monthKey(y, m)) setCur({ y: +next.slice(0, 4), m: +next.slice(5, 7) - 1 })
  }

  const head = (prevLabel, nextLabel, onPrev, onNext, prevOff, nextOff, title, titleLabel, onTitle) =>
    <div className="row between datep-head">
      <button type="button" className="iconbtn" onClick={onPrev} disabled={prevOff} aria-label={prevLabel}><Icon name="chevronLeft" /></button>
      <button type="button" className="datep-title" onClick={onTitle} aria-label={title + ', ' + titleLabel} data-datep-title>
        <span className="datep-t" aria-hidden="true">{title}</span><Icon name={view === 'days' ? 'chevronDown' : 'chevronUp'} />
      </button>
      <span className="vh" aria-live="polite">{title}</span>
      <button type="button" className="iconbtn" onClick={onNext} disabled={nextOff} aria-label={nextLabel}><Icon name="chevronRight" /></button>
    </div>

  let body
  if (view === 'months') {
    body = <>
      {head(t('Previous year'), t('Next year'), () => setCur({ y: y - 1, m }), () => setCur({ y: y + 1, m }),
        !!minM && String(y - 1) < minM.slice(0, 4), !!maxM && String(y + 1) > maxM.slice(0, 4),
        String(y), t('Pick a day'), () => { moveFocus.current = true; setView('days') })}
      <div className="datep-months" role="group" aria-label={String(y)} data-year={y}>
        {MONTHS.map((short, i) => <button type="button" key={short} data-month={i}
          className={'cal-d datep-m' + (i === m ? ' sel' : '') + (monthKey(y, i) === today.slice(0, 7) ? ' today' : '')}
          disabled={outM(y, i)} aria-label={t(MONTHS_LONG[i]) + ' ' + y} aria-pressed={i === m}
          onClick={() => { moveFocus.current = true; showMonth(y, i); setView('days') }}>{t(short)}</button>)}
      </div>
    </>
  } else {
    const offset = weekDayOffset(new Date(y, m, 1).getDay(), ws)
    const daysIn = new Date(y, m + 1, 0).getDate()
    const cells = []
    for (let i = 0; i < offset; i++) cells.push(<div key={'e' + i} />)
    for (let d = 1; d <= daysIn; d++) {
      const iso = isoOf(y, m, d)
      const sel = iso === value
      cells.push(<button type="button" key={iso} data-iso={iso}
        className={'cal-d' + (sel ? ' sel' : '') + (iso === today ? ' today' : '')}
        disabled={outD(iso)} tabIndex={iso === focusIso ? 0 : -1}
        aria-label={fmtDate(iso, true, true)} aria-pressed={sel} aria-current={iso === today ? 'date' : undefined}
        onFocus={() => setFocusIso(iso)} onClick={() => pick(iso)}><span>{d}</span></button>)
    }
    body = <>
      {head(t('Previous month'), t('Next month'), () => { moveFocus.current = false; showMonth(y, m - 1) }, () => { moveFocus.current = false; showMonth(y, m + 1) },
        outM(y, m - 1), outM(y, m + 1),
        t(MONTHS_LONG[m]) + ' ' + y, t('Pick a month'), () => setView('months'))}
      <div className="cal-grid datep-grid" role="group" aria-label={t(MONTHS_LONG[m]) + ' ' + y} ref={grid} onKeyDown={onKey}>
        {weekOrder(ws).map(d => <div key={d} className="cal-h" aria-hidden="true">{t(DAYS[d])}</div>)}
        {cells}
      </div>
    </>
  }
  return <div className="datep" data-datepicker>
    {label && <div className="small muted datep-label">{label}</div>}
    {body}
    {!outD(today) && <Button variant="ghost" className="datep-today" onClick={() => pick(today)}>{t('Today')}</Button>}
  </div>
}

export function datePickerSheet(opts) {
  return useUI.getState().openSheet(close => <DatePicker {...opts} close={close} />)
}

export default function DateField({ value, min, max, onChange, label, compact = false, className = '' }) {
  useStore(s => s.S.weekStart) // re-render with the profile, like every other date on screen
  const text = ISO.test(value || '') ? fmtDate(value, !compact, true) : t('Pick a day')
  return (
    <button type="button" value={value || ''} data-datefield
      className={(compact ? 'timef' : 'field') + ' datef ' + className}
      aria-haspopup="dialog" aria-label={label ? label + ': ' + text : text}
      onClick={() => datePickerSheet({ value, min, max, label, onPick: onChange })}>
      {ISO.test(value || '') ? <time dateTime={value}>{text}</time> : <span className="datef-ph">{text}</span>}
      {!compact && <Icon name="calendar" />}
    </button>
  )
}
