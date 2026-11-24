// Which recap is due on a day (lib/recap.js): kept apart from the numbers so a light module
// (lib/page-layout.js) can ask without pulling in the report.
import { isoOf, todayISO, weekStartOf } from './format.js'
import type { ISODate, State } from '../types/model.ts'

export interface RecapPeriod {
  kind: 'month' | 'week'
  from: ISODate
  to: ISODate
  /** What the card's × remembers (S.recapSeen): 'm:YYYY-MM' or 'w:<the week's first day>'. */
  key: string
}

const dateOf = (iso: ISODate): Date => new Date(iso + 'T12:00:00')
export const addDays = (iso: ISODate, n: number): ISODate => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d) }

/**
 * The stretch due today, or null. The 1st looks back on the month before; the week's first day on
 * the week before. A 1st that is also a Monday shows the month (it is the bigger story, and the
 * week is in it).
 */
export function recapPeriod(S: Pick<State, 'weekStart'> | null | undefined, today: ISODate = todayISO()): RecapPeriod | null {
  const d = dateOf(today)
  if (d.getDate() === 1) {
    const to = addDays(today, -1)
    const from = to.slice(0, 8) + '01'
    return { kind: 'month', from, to, key: 'm:' + from.slice(0, 7) }
  }
  if (d.getDay() === weekStartOf(S)) {
    const from = addDays(today, -7)
    return { kind: 'week', from, to: addDays(today, -1), key: 'w:' + from }
  }
  return null
}
