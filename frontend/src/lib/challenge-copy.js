// The words of the monthly challenges (lib/challenges.js), for the Home card, Stats and the
// widgets alike. Kept apart from the engine so that one stays free of i18n.
import { t, tn, dateLocale } from './i18n.js'
import { fmtNum } from './format.js'
import { LB_KG } from './units.js'

// A volume target shown in the profile's unit: tonnes for kg, pounds for lb. A target picked in
// the other unit (the profile switched since) is converted for the screen.
const volIn = (n, from, unit) => (from === unit ? n : unit === 'lb' ? n / LB_KG : n * LB_KG)
const tonnes = kg => fmtNum(Math.round(kg / 100) / 10) + ' t'
const pounds = lb => (lb >= 10000 ? fmtNum(Math.round(lb / 100) / 10) + 'k' : fmtNum(Math.round(lb))) + ' lb'
const volText = (n, from, unit) => (unit === 'lb' ? pounds(volIn(n, from || 'kg', 'lb')) : tonnes(volIn(n, from || 'kg', 'kg')))

/** The challenge as a goal: "14 workouts this month". `unit` is the profile's. */
export function challengeTitle(p, unit = 'kg') {
  const n = p.n
  switch (p.id) {
    case 'workouts': return tn('{0} workout this month', '{0} workouts this month', n)
    case 'weeks': return t('Train every week this month')
    case 'volume': return t('Lift {0} this month', volText(n, p.u, unit))
    case 'prs': return tn('Hit {0} new PR', 'Hit {0} new PRs', n)
    case 'pullups': return tn('{0} pull-up this month', '{0} pull-ups this month', n)
    case 'pushups': return tn('{0} push-up this month', '{0} push-ups this month', n)
    case 'cardio': return tn('{0} minute of cardio', '{0} minutes of cardio', n)
    case 'newex': return tn('Try {0} exercise you have never done', 'Try {0} exercises you have never done', n)
    case 'muscles': return t('Every muscle group at least once')
    case 'weighins': return tn('Log your weight on {0} day', 'Log your weight on {0} days', n)
    default: return t('Challenges')
  }
}

/** How far: "7 / 14", or "32.4 / 50 t" for volume. */
export function challengeCount(p, unit = 'kg') {
  if (p.id === 'volume') {
    const have = unit === 'lb' ? (p.u === 'lb' ? p.have : p.have / LB_KG) : (p.u === 'lb' ? p.have * LB_KG : p.have)
    const goal = volIn(p.n, p.u || 'kg', unit)
    const num = unit === 'lb'
      ? (goal >= 10000 ? fmtNum(Math.floor(have / 100) / 10) + 'k' : fmtNum(Math.floor(have)))
      : fmtNum(Math.floor(have / 100) / 10)
    return `${num} / ${volText(p.n, p.u, unit)}`
  }
  return `${fmtNum(Math.min(Math.floor(p.have), 99999))} / ${fmtNum(p.n)}`
}

/** "November 2026" in the app's language. */
export function monthLabel(key, { short = false } = {}) {
  const [y, m] = key.split('-').map(Number)
  try { return new Date(y, m - 1, 15).toLocaleDateString(dateLocale(), short ? { month: 'short', year: 'numeric' } : { month: 'long', year: 'numeric' }) } catch { return key }
}

/** "2 of 3 done". */
export const doneLine = (done, total) => t('{0} of {1} done', done, total)
