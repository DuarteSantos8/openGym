// Why each week counted the way it did, for the calendar (components/StreakCalendar.jsx). The
// streak's own walk decides (lib/streak.js streakInfo with its `log`); this only puts its verdict
// into words. Nothing here counts anything itself, so the calendar can never disagree with the
// number on Home.
import { t, tn } from './i18n.js'
import { streakInfo, FREEZE_EVERY, FREEZE_MAX } from './streak.js'
import { todayISO } from './format.js'

/** The streak as of `today` plus, per week key, what the walk decided (see streakInfo's `log`). */
export function streakWeeks (S, today = todayISO()) {
  const log = new Map()
  const info = streakInfo(S, today, log)
  return { info, log }
}

/** A week's mark in the calendar: 'on' | 'frozen' | 'broke' | 'missed' | 'open', or null (none). */
export const markOf = entry => (entry ? entry.s : null)

/** The sentence a tapped week gets. `entry` is the log's record for that week. */
export function explainWeek (entry) {
  if (!entry) return ''
  switch (entry.s) {
    case 'on': {
      const base = t('You trained, so this week counts. Streak: {0}.', entry.run)
      return entry.earned ? base + ' ' + t('It also earned a freeze.') : base
    }
    case 'frozen': return t('No workout, so a freeze covered it. The streak kept going, but this week adds nothing to the count.')
    case 'broke': return t('No workout and no freeze left, so the streak started over.')
    case 'missed': return t('No workout this week.')
    case 'open': return t('Still open. One workout and it counts.')
    default: return ''
  }
}

/** The line beside the freeze chips: how the next freeze is earned, or that the bank is full. */
export function freezeLine (info) {
  if (info.freezes >= FREEZE_MAX) return t('Freezes full. A missed week uses one, no harm done.')
  return tn('One more week with a workout earns a freeze.', '{0} more weeks with a workout earn a freeze.', info.toNextFreeze || FREEZE_EVERY)
}
