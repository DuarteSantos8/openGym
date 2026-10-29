// "Your week" and "Your month": a small Home card on the first day of a week (the profile's week
// start) about the week before, and on the 1st about the month before. Tap it for the numbers,
// share them as a picture (components/ShareCard.jsx) or save them as the performance report's PDF
// for that stretch (lib/report-print.js). Settings → Look & Home → Week and month recap turns it
// off (S.recap === false); the card's × puts that one away for good (S.recapSeen, its key).
//
// The numbers are the performance report's own (lib/report.js reportData over the stretch), so
// the card, the sheet and the PDF never disagree. A stretch with no workout gets no card at all:
// nobody needs a recap of a week off.
import { reportData } from './report.js'
import { isoOf, todayISO, weekStartOf } from './format.js'
import { streakWeeks } from './streak.js'

const dateOf = iso => new Date(iso + 'T12:00:00')
const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d) }

export const recapOn = S => S?.recap !== false

/**
 * The stretch due today, or null: `{ kind: 'month' | 'week', from, to, key }`. The 1st looks back on
 * the month before; the week's first day on the week before. A 1st that is also a Monday shows the
 * month (it is the bigger story, and the week is in it).
 */
export function recapPeriod(S, today = todayISO()) {
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

/** The numbers of a stretch: workouts, volume, sets, PRs, active days, the streak and the top muscle. */
export function recapOf(S, period, today = todayISO()) {
  const R = reportData(S, { range: 'custom', from: period.from, to: period.to, today })
  const top = R.muscles.worked[0] || null
  return {
    ...period,
    workouts: R.totals.workouts,
    volume: R.totals.volume,
    sets: R.totals.sets,
    prs: R.totals.prs,
    days: R.totals.days,
    ms: R.totals.ms,
    streak: streakWeeks(S, today),
    top: top ? { slug: top.slug, name: top.name, sets: top.sets } : null,
    prev: R.prev,
  }
}

/** The recap Home shows today, or null (off, nothing due, put away, or a stretch without a workout). */
export function recapDue(S, today = todayISO()) {
  if (!recapOn(S)) return null
  const p = recapPeriod(S, today)
  if (!p || S?.recapSeen === p.key) return null
  const r = recapOf(S, p, today)
  return r.workouts > 0 ? r : null
}
