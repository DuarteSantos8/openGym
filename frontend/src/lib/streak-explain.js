// Why each week counted the way it did, for the calendar (components/StreakCalendar.jsx). The
// streak's own walk decides (lib/streak.js streakInfo with its `log`); this only puts its verdict
// into words. Nothing here counts anything itself, so the calendar can never disagree with the
// number on Home.
import { t, tn } from './i18n.js'
import { streakInfo, FREEZE_EVERY, FREEZE_MAX } from './streak.js'
import { todayISO, fmtDate } from './format.js'
import { STREAK_RULES, streakRuleOf } from './streak-rule.js'

/** A rule's name and what it does, for the pickers and the how-to. */
export const ruleLabel = r => ({ off: t('No freezes'), gentle: t('Gentle'), generous: t('Generous') }[r] || t('Generous'))
export const ruleDesc = r => ({
  off: t('Every week counts. Miss one and the streak starts over.'),
  gentle: t('Bank 1 freeze, earned every 4 trained weeks. Two missed weeks in a row end the streak.'),
  generous: t('Bank up to 2 freezes, one every 4 trained weeks. Even two missed weeks in a row can be covered.'),
}[r] || '')

/** "From now on: Gentle." with what it means for the weeks already counted. */
export const fromNowOn = r => t('From now on: {0}.', ruleLabel(r)) + ' ' + t('Weeks already counted stay as they are.')

/**
 * For a week judged by a rule picked later on (S.streakRule.since, not a first pick), the line
 * that says so: "From the week of 2 Nov on: Gentle." Empty for every other week.
 */
export function ruleNote (S, wk) {
  const r = streakRuleOf(S)
  if (!r || !r.since || !wk || wk < r.since) return ''
  return t('From the week of {0} on: {1}.', fmtDate(r.since), ruleLabel(r.rule))
}

/** The streak as of `today` plus, per week key, what the walk decided (see streakInfo's `log`). */
export function streakWeeks (S, today = todayISO()) {
  const log = new Map()
  const info = streakInfo(S, today, log)
  return { info, log }
}

/** A week's mark in the calendar: 'on' | 'excused' | 'frozen' | 'broke' | 'missed' | 'open', or null (none). */
export const markOf = entry => (entry ? entry.s : null)

/** The sentence a tapped week gets. `entry` is the log's record for that week. */
export function explainWeek (entry) {
  if (!entry) return ''
  switch (entry.s) {
    case 'on': {
      const base = t('You trained, so this week counts. Streak: {0}.', entry.run)
      return entry.earned ? base + ' ' + t('It also earned a freeze.') : base
    }
    case 'excused': return ({
      sick: t('You were sick, so this week is excused. The streak kept going and no freeze was spent.'),
      injured: t('You were injured, so this week is excused. The streak kept going and no freeze was spent.'),
    }[entry.tag] || t('You were travelling, so this week is excused. The streak kept going and no freeze was spent.'))
    case 'frozen': return t('No workout, so a freeze covered it. The streak kept going, but this week adds nothing to the count.')
    case 'broke': return entry.rule === 'off' ? t('No workout, and your rule has no freezes, so the streak started over.') : t('No workout and no freeze left, so the streak started over.')
    case 'missed': return t('No workout this week.')
    case 'open': return t('Still open. One workout and it counts.')
    default: return ''
  }
}

/** The line beside the freeze chips: how the next freeze is earned, or that the bank is full. */
export function freezeLine (info) {
  const max = info.max ?? FREEZE_MAX
  if (!max) return t('No freezes on your rule. Every week counts.')
  if (info.freezes >= max) return t('Freezes full. A missed week uses one, no harm done.')
  return tn('One more week with a workout earns a freeze.', '{0} more weeks with a workout earn a freeze.', info.toNextFreeze || FREEZE_EVERY)
}

/**
 * The line for a planned day that went by without a workout (the calendar's hollow dot). Only
 * the week decides the streak, so this says what that week made of it: `weekEntry` is the log's
 * record for the day's week, or null with the streak off.
 */
export function explainMissedDay (weekEntry) {
  const s = weekEntry?.s
  if (s === 'on') return t('Planned, not trained. No harm done: you trained another day that week, so it still counts.')
  if (s === 'open') return t('Planned, not trained. Any other day this week still counts.')
  return t('Planned, not trained. Any workout that week would have counted.')
}

/** The sick and travel weeks a year, as the Settings row shows it. */
export const excuseLabel = n => (n > 0 ? tn('{0} week a year', '{0} weeks a year', n) : t('Off'))

/** The line under the sick and travel picker: how many are left this year. */
export function excuseLine (info) {
  const cap = info?.excuseCap ?? 0
  if (!cap) return t('Sick and travel notes leave the streak to the freezes.')
  return tn('One left this year.', '{0} left this year.', info.excuseLeft ?? cap)
}
