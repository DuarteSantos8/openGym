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

export const STREAK_RULES = {
  off: { every: 4, max: 0 },
  gentle: { every: 4, max: 1 },
  generous: { every: 4, max: 2 },
}
export const RULE_IDS = ['off', 'gentle', 'generous']
export const LEGACY_RULE = 'generous'
export const NEW_PROFILE_RULE = 'gentle'
export const HISTORY_MAX = 24

const isISO = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
const okRule = r => (RULE_IDS.includes(r) ? r : null)
const entry = e => {
  if (!e || typeof e !== 'object' || !okRule(e.rule)) return null
  return { rule: e.rule, since: isISO(e.since) ? e.since : null }
}

/** S.streakRule cleaned, or null when the profile never picked one (it counts as `generous`). */
export function streakRuleOf (S) {
  const cur = entry(S?.streakRule)
  if (!cur) return null
  const hist = (Array.isArray(S.streakRule.history) ? S.streakRule.history : []).map(entry).filter(Boolean)
    // Only what came before the rule in force, in order; a second entry for the same start, the
    // later one.
    .filter(h => cur.since === null ? false : (h.since === null || h.since < cur.since))
    .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? ''))
  const byStart = new Map()
  for (const h of hist) byStart.set(h.since ?? '', h)
  return { ...cur, history: [...byStart.values()].slice(-HISTORY_MAX) }
}

/** Every rule with the week it starts, oldest first: [{ rule, since }] (since null = always). */
export function ruleTimeline (S) {
  const r = streakRuleOf(S)
  if (!r) return [{ rule: LEGACY_RULE, since: null }]
  const list = [...r.history, { rule: r.rule, since: r.since }]
  // Before the first known start, the rule a profile had before it ever picked one.
  return list[0].since === null ? list : [{ rule: LEGACY_RULE, since: null }, ...list]
}

/** The rule that judges the week `wk` (a week key), from a timeline with its starts as week keys. */
export function ruleAt (timeline, wk) {
  let rule = LEGACY_RULE
  for (const e of timeline) if (e.since === null || e.since <= wk) rule = e.rule
  return rule
}

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
