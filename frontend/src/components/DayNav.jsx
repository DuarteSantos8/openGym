import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { fmtDate, todayISO, weekStartOf } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { oneOf } from '../lib/ui-kit.js'
import { useDiarySelection, useDiaryTarget } from '../lib/nutrition/selection.js'
import { dayMark } from '../lib/training-day.js'
import { dayOverrideSheet } from '../sheets.jsx'
import { MonthBar, WeekStrip } from './date-nav.jsx'

const ANNOUNCE_MS = 1500

// The month and the week over a tab root, on the one date every tab shares
// (lib/nutrition/selection.js; ux-redesign-tabs §4.4). Today and the days before it are picked;
// a day to come is never the date. future="plan" (Home, Training): tapping one, in the week or in
// the month's calendar, opens "change this day" for it (the plan's sheet), the date stays, and a
// screen reader is told which day it opened; future="off" (Nutrition): it is dimmed and cannot be
// tapped. The dots are the training calendar's.
export default function DayNav({ future = 'plan' }) {
  oneOf('DayNav', 'future', future, ['plan', 'off'])
  const S = useStore(s => s.S)
  const { date } = useDiaryTarget(null)
  const setDate = useDiarySelection(s => s.setDate)
  const [said, setSaid] = useState('')
  const today = todayISO()
  const plan = future === 'plan'

  useEffect(() => {
    if (!said) return undefined
    const id = setTimeout(() => setSaid(''), ANNOUNCE_MS)
    return () => clearTimeout(id)
  }, [said])

  const openFuture = iso => {
    dayOverrideSheet(iso)
    setSaid(t('Change this day') + ', ' + fmtDate(iso, true))
  }
  const onSelect = iso => { if (iso > today) openFuture(iso); else setDate(iso) }
  return <>
    <MonthBar date={date} onPickDate={setDate} onPickFuture={plan ? openFuture : undefined} onToday={() => setDate(null)} />
    <WeekStrip date={date} onSelect={onSelect} marks={iso => dayMark(S, iso)} weekStart={weekStartOf(S)}
      maxDate={plan ? undefined : today} />
    {plan && <p className="sr-only" role="status">{said}</p>}
  </>
}
