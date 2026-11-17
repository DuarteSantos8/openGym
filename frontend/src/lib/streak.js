// The week streak: weeks in a row with at least one workout, in the profile's own weeks (Monday or
// Sunday first, lib/format.js weekKey), with the best run ever, freezes and milestone badges.
//
// Everything here is read back from the workouts, nothing of it is stored: two devices, a restored
// backup or an import of old sessions all arrive at the same streak, and there is nothing for a sync
// to merge. The one stored thing is which celebration was already shown (S.streakSeen, below).
//
// THE FREEZE RULE. Walk the weeks from the first one with a workout up to this one:
//   - a week with a workout adds one to the streak; every 4th of them in the run earns a freeze,
//     and at most 2 are kept (an earned one past that is simply not added);
//   - a week gone by without one uses a freeze when there is one: the streak carries on (the week
//     itself adds nothing) and the week is shown with a snowflake. Without a freeze the streak and
//     the freezes start over at 0;
//   - this week, still without a workout, is open: it neither counts nor breaks anything yet.
// So a holiday or a cold is covered without anyone having to remember a switch first: train 4
// weeks, and the next missed one is forgiven. Two missed weeks need two freezes, i.e. 8 weeks.
//
// How many freezes are kept is the profile's own pick since 1.4.5 (lib/streak-rule.js): none,
// one or two (the numbers above are `generous`, the rule of every profile that never picked).
// Each week is judged by the rule in force that week, so a new pick never rewrites the past; on
// the first week of a new rule the freezes banked are trimmed to what it keeps.
import { todayISO, weekKey } from './format.js'
import { streakWalk } from '../../../api/coach/core/streak.js'

export { FREEZE_EVERY, FREEZE_MAX, STREAK_BADGES } from '../../../api/coach/core/streak.js'

/**
 * The streak as of `today`:
 *   current      weeks with a workout in the running streak (this week counted once trained)
 *   best         the longest run ever (current included)
 *   freezes      freezes banked now, 0..FREEZE_MAX
 *   frozen       the week keys (first day of the week) a freeze covered in the running streak
 *   thisWeekDone whether this week has a workout yet
 *   badges       the milestones the best run has reached; next: the next one, or null
 *   toNextFreeze trained weeks still needed for the next freeze (0 when the bank is full)
 *   rule, max    the freeze rule in force this week (lib/streak-rule.js) and how many it keeps
 *
 * `log`, a Map, if given, is filled with what the walk decided for each week, keyed like
 * weekKey: { s, run, bank, earned } where s is 'on' (trained), 'frozen' (a freeze covered it),
 * 'broke' (missed with no freeze left: the run started over), 'missed' (missed with no run to
 * break) or 'open' (this week, no workout yet); run and bank are the streak and the freezes
 * after that week, earned whether it earned a freeze. Only a record of the walk: the calendar
 * (components/StreakCalendar.jsx) reads it to say why a week counted, nothing here depends on it.
 *
 * The walk itself is api/coach/core/streak.js, shared with the server so a trainer's member list
 * shows the same number as the member's phone.
 */
export function streakInfo (S, today = todayISO(), log = null) {
  return streakWalk(S, today, { log, weekKey })
}

/** Just the number, as Home, Stats, the report and the widgets show it. */
export const streakWeeks = (S, today = todayISO()) => streakInfo(S, today).current

/**
 * What Home should celebrate now, once: a milestone the best run reached since the last one
 * shown, or this week done (its plan all trained, or without a plan its first workout).
 * `tally` is this week's { done, planned } (lib/queue.js weekTally). Returns null, or
 * { kind: 'badge', weeks } / { kind: 'week', weeks }, plus `seen`: what S.streakSeen becomes once
 * it was shown. A badge marks the week as seen too, so the two never come one after the other.
 *
 * A profile that never saw one (no S.streakSeen yet, e.g. right after the update) gets its top
 * badge so far once: a welcome for the run it already has, then the usual one at a time.
 */
export function streakCelebration (S, info, tally = {}) {
  const seen = S?.streakSeen && typeof S.streakSeen === 'object' ? S.streakSeen : {}
  const top = info.badges.at(-1) || 0
  const weekDone = info.thisWeekDone && (tally.planned > 0 ? tally.done >= tally.planned : true)
  const wk = weekDone ? info.weekKey : (seen.wk ?? null)
  if (top > (Number(seen.badge) || 0)) return { kind: 'badge', weeks: top, seen: { badge: top, wk } }
  if (weekDone && seen.wk !== info.weekKey) return { kind: 'week', weeks: info.current, seen: { badge: Number(seen.badge) || 0, wk } }
  return null
}
