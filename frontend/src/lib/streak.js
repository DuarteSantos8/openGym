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
import { todayISO, isoOf, weekKey, weekStartOf } from './format.js'

export const FREEZE_EVERY = 4
export const FREEZE_MAX = 2
export const STREAK_BADGES = [4, 12, 26, 52, 104]
// Far enough back for any real history, short enough that a typo'd year cannot spin the loop.
const MAX_WEEKS = 1500

const isISO = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
const plusWeek = (iso, n = 1) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + 7 * n); return isoOf(d) }

/**
 * The streak as of `today`:
 *   current      weeks with a workout in the running streak (this week counted once trained)
 *   best         the longest run ever (current included)
 *   freezes      freezes banked now, 0..FREEZE_MAX
 *   frozen       the week keys (first day of the week) a freeze covered in the running streak
 *   thisWeekDone whether this week has a workout yet
 *   badges       the milestones the best run has reached; next: the next one, or null
 *   toNextFreeze trained weeks still needed for the next freeze (0 when the bank is full)
 */
export function streakInfo (S, today = todayISO()) {
  const ws = weekStartOf(S)
  const cur = weekKey(today, ws)
  const trained = new Set()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    if (!w || !isISO(w.d)) continue
    const k = weekKey(w.d, ws)
    if (k <= cur) trained.add(k)
  }
  const empty = { current: 0, best: 0, freezes: 0, frozen: [], thisWeekDone: false, badges: [], next: STREAK_BADGES[0], toNextFreeze: FREEZE_EVERY, weekKey: cur }
  if (!trained.size) return empty
  let wk = [...trained].sort()[0]
  const floor = plusWeek(cur, -MAX_WEEKS)
  if (wk < floor) wk = floor
  let run = 0, best = 0, freezes = 0, earned = 0, frozen = []
  for (let i = 0; i <= MAX_WEEKS && wk <= cur; i++, wk = plusWeek(wk)) {
    if (trained.has(wk)) {
      run++
      earned++
      if (earned % FREEZE_EVERY === 0 && freezes < FREEZE_MAX) freezes++
    } else if (wk !== cur) {
      if (freezes > 0) { freezes--; frozen.push(wk) } else { run = 0; earned = 0; freezes = 0; frozen = [] }
    }
    if (run > best) best = run
  }
  const badges = STREAK_BADGES.filter(b => best >= b)
  return {
    current: run,
    best,
    freezes,
    frozen,
    thisWeekDone: trained.has(cur),
    badges,
    next: STREAK_BADGES.find(b => best < b) ?? null,
    toNextFreeze: freezes >= FREEZE_MAX ? 0 : FREEZE_EVERY - (earned % FREEZE_EVERY),
    weekKey: cur,
  }
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
