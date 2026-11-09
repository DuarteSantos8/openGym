// How forgiving the week streak is (lib/streak.js): your pick, from the moment you pick it.
//
//   off       no freezes: a week gone by without a workout starts the streak over
//   gentle    one freeze in the bank, earned every 4th trained week; so two missed weeks in a
//             row always end the streak
//   generous  up to two freezes, one every 4th trained week (the rule until 1.4.5)
//
// Stored as S.streakRule = { rule, since, history }:
//   rule     the rule in force now
//   since    the first day (a week key, lib/format.js weekKey) it applies to, or null for
//            "every week": a new profile's first pick, which then also judges an import of old
//            sessions
//   history  the earlier { rule, since }, oldest first, at most HISTORY_MAX
// Not retroactive: every week is judged by the rule that was in force then (ruleAt), so a switch
// never breaks or rebuilds a streak already counted. At the switch the freezes banked are only
// trimmed to what the new rule keeps. A profile without the field (everyone before 1.4.5, and an
// older app version that does not know it) counts every week with `generous`, as it always did.
// It syncs as one setting (lib/sync-merge.js: the last change wins whole) and travels in backups.
import { weekKey, todayISO, weekStartOf } from './format.js'
import { streakRuleOf, LEGACY_RULE, HISTORY_MAX, RULE_IDS, EXCUSE_DEFAULT as EXCUSE_DEFAULT_ } from '../../../api/coach/core/streak.js'

// The reading side lives in api/coach/core/streak.js, shared with the server's streak.
export { STREAK_RULES, RULE_IDS, LEGACY_RULE, NEW_PROFILE_RULE, HISTORY_MAX, streakRuleOf, ruleTimeline, ruleAt, EXCUSE_TAGS, EXCUSE_DEFAULT, EXCUSE_CHOICES, excuseCapOf } from '../../../api/coach/core/streak.js'

const okRule = r => (RULE_IDS.includes(r) ? r : null)

/** The rule in force now, for the settings and the words. */
export const currentRule = S => streakRuleOf(S)?.rule || LEGACY_RULE

/**
 * Puts `rule` in force from this week on (`today`'s week in the profile's own weeks), keeping the
 * one before in the history. Picked again in the week it started, it simply replaces it. Returns
 * whether anything changed. `always` (a new profile's first pick) makes it judge every week.
 */
export function setStreakRule (S, rule, today = todayISO(), { always = false } = {}) {
  if (!okRule(rule)) return false
  const cur = streakRuleOf(S)
  const since = always ? null : weekKey(today, weekStartOf(S))
  if (cur && cur.rule === rule && (always ? cur.since === null : true)) return false
  let history = cur ? cur.history : []
  if (!always) {
    const before = cur ? { rule: cur.rule, since: cur.since } : { rule: LEGACY_RULE, since: null }
    if (!cur || before.since === null || before.since < since) history = [...history, before]
  } else history = []
  S.streakRule = { rule, since, history: history.slice(-HISTORY_MAX) }
  return true
}

/**
 * Sick and travel weeks (api/coach/core/streak.js): how many missed weeks a year a sick, travel or
 * injured day note may carry the streak through, 0 for none. The default (4) is kept as no key,
 * so a profile that never touched it and an older app count the same.
 */
export function setExcuseCap (S, n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v) || v < 0 || v > 12) return false
  if (v === EXCUSE_DEFAULT_) delete S.streakExcuse
  else S.streakExcuse = v
  return true
}
