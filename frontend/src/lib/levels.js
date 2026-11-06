// Levels and the badges you pin to your profile (1.4.5, gm-streak).
//
// LEVELS. Points come from what the app already counts, nothing new is stored:
//   POINTS.week     every week ever with a workout (the streak's own weeks, lib/format.js weekKey)
//   POINTS.badge    every streak milestone the best run reached (lib/streak.js STREAK_BADGES)
//   POINTS.challenge every monthly challenge finished (lib/challenges.js)
//   POINTS.gold     on top, every month with all three done
// Level n starts at STEP · n(n−1)/2 points: 0, 50, 150, 300, 500, … so each level asks a bit more
// than the last and a year of steady weeks lands somewhere around level 10. Read back every time,
// so two devices, a restored backup or an import all agree, and a deleted workout can lower it.
//
// PROFILE BADGES. Up to PIN_MAX badges you earned, pinned beside your profile picture:
//   S.profileBadges = ['streak-12', 'month-2026-10', …]
// One whole setting (lib/sync-merge.js: the last pick wins whole). A pinned badge that is no
// longer earned (the workouts behind it deleted) is simply not shown.
import { weekKey, weekStartOf } from './format.js'
import { STREAK_BADGES } from './streak.js'
import { cleanChallenges, isGold } from './challenges.js'
import { isOn } from './modules.js'

export const POINTS = { week: 10, badge: 25, challenge: 15, gold: 15 }
export const STEP = 50
export const PIN_MAX = 3
// The medal tiers of components/Streak.jsx TIERS, so a badge looks the same everywhere.
const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'legend']

/** The points a level starts at. */
export const levelStart = n => (STEP * n * (n - 1)) / 2

/** The level `points` buys: { n, points, start, next, into, need, pct }. */
export function levelFor(points) {
  const p = Math.max(0, Math.floor(Number(points) || 0))
  let n = 1
  while (levelStart(n + 1) <= p && n < 999) n++
  const start = levelStart(n), next = levelStart(n + 1)
  return { n, points: p, start, next, into: p - start, need: next - p, pct: (p - start) / (next - start) }
}

const trainedWeeks = S => {
  const ws = weekStartOf(S)
  const set = new Set()
  for (const w of Array.isArray(S?.workouts) ? S.workouts : []) {
    if (w && typeof w.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.d)) set.add(weekKey(w.d, ws))
  }
  return set.size
}

/** Where the points come from: { weeks, badges, challenges, golds, points }. `info` is lib/streak.js streakInfo. */
export function pointsOf(S, info) {
  const weeks = trainedWeeks(S)
  const badges = Array.isArray(info?.badges) ? info.badges.length : 0
  const months = Object.values(cleanChallenges(S?.challenges) || {})
  const challenges = months.reduce((n, m) => n + m.done.length, 0)
  const golds = months.filter(isGold).length
  const points = weeks * POINTS.week + badges * POINTS.badge + challenges * POINTS.challenge + golds * POINTS.gold
  return { weeks, badges, challenges, golds, points }
}

/** The level of a profile, or null with the Motivation module off. */
export function levelOf(S, info) {
  if (!isOn(S, 'motivation')) return null
  const parts = pointsOf(S, info)
  return { ...levelFor(parts.points), parts }
}

/* ---------- badges for the profile ---------- */

/**
 * Every badge earned, best first: [{ id, kind: 'streak' | 'month', tier, weeks?, key?, gold? }].
 * Streak milestones from the best run, then every month with a finished challenge, newest first.
 */
export function earnedBadges(S, info) {
  const out = []
  const reached = Array.isArray(info?.badges) ? info.badges : []
  for (let i = STREAK_BADGES.length - 1; i >= 0; i--) {
    const b = STREAK_BADGES[i]
    if (reached.includes(b)) out.push({ id: 'streak-' + b, kind: 'streak', tier: TIERS[i] || 'gold', weeks: b })
  }
  const all = cleanChallenges(S?.challenges) || {}
  for (const key of Object.keys(all).sort().reverse()) {
    const m = all[key]
    if (!m.done.length) continue
    const gold = isGold(m)
    out.push({ id: 'month-' + key, kind: 'month', key, gold, done: m.done.length, tier: gold ? 'gold' : TIERS[Math.min(2, m.done.length - 1)] })
  }
  return out
}

/** The pinned ids as stored, cleaned: strings, no repeats, at most PIN_MAX. */
export function pinnedIds(S) {
  const list = Array.isArray(S?.profileBadges) ? S.profileBadges : []
  return [...new Set(list.filter(x => typeof x === 'string' && /^(streak-\d{1,3}|month-\d{4}-\d{2})$/.test(x)))].slice(0, PIN_MAX)
}

/** The pinned badges still earned, in the order they were pinned. */
export function pinnedBadges(S, info, earned = earnedBadges(S, info)) {
  const by = new Map(earned.map(b => [b.id, b]))
  return pinnedIds(S).map(id => by.get(id)).filter(Boolean)
}

/**
 * The pin list with `id` flipped: added at the end, or taken off. Full (PIN_MAX), adding drops the
 * oldest pin, so a tap always does what it says. Returns the new list.
 */
export function togglePin(S, id) {
  const cur = pinnedIds(S)
  if (cur.includes(id)) return cur.filter(x => x !== id)
  return [...cur, id].slice(-PIN_MAX)
}
