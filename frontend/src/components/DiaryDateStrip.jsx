import { t, dateLocale } from '../lib/i18n.js'
import { isoOf, todayISO } from '../lib/format.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useUnits } from '../lib/nutrition/use-units.js'
import { calendarSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

const shift = (iso, days) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + days); return isoOf(d) }

// Home's date navigator (ia-proposal §2), sticky at the top: ‹ Today, Tue 13 Oct ▾ ›. The label
// opens the calendar; on an earlier day everything below shows that day and logs go to it.
// It stops at today.
// `left`: the energy still to eat, shown once the calories card has scrolled away (null hides it).
export default function DiaryDateStrip({ date, left }) {
  const setDate = useDiarySelection(s => s.setDate)
  const units = useUnits()
  const today = todayISO()
  const label = new Date(date + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
  const relative = date === today ? t('Today') : date === shift(today, -1) ? t('Yesterday') : null
  return <div className="date-strip" role="group" aria-label={t('Day')}>
    <button className="iconbtn" onClick={() => setDate(shift(date, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
    <button className="date-strip-l" onClick={() => calendarSheet(date, { onPick: setDate })} aria-label={t('Choose a day, {0}', label)}>
      <span>{relative ? relative + ', ' + label : label}</span>
      <Icon name="chevronDown" />
    </button>
    {left != null && <span className={'date-strip-left small' + (left < 0 ? ' over' : '')}>
      {left < 0 ? t('{0} over', units.energy(Math.abs(left))) : t('{0} left', units.energy(left))}
    </span>}
    {date !== today && <button className="date-strip-today small" onClick={() => setDate(today)}>{t('Today')}</button>}
    {/* Today is as far as it goes: nothing is shown or logged for a day to come. */}
    <button className="iconbtn" onClick={() => setDate(shift(date, 1))} disabled={date >= today} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
  </div>
}
