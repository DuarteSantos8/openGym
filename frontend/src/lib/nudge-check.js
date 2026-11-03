// The phone's background check before a nudge or a reminder it scheduled on itself (lib/mobile.js
// syncReminder). Both are local notifications, worked out from this phone's copy of the profile:
// a workout logged on the web or on another phone, with this one left in a pocket, used to be
// followed at 20:00 by "you missed it". So a paired phone also hands the native NudgeCheck plugin
// (ios/App/App/NudgeCheckPlugin.swift: BGAppRefreshTask; android/.../NudgeCheckPlugin.java:
// JobScheduler) the days it has something scheduled for. Shortly before each one fires, the
// plugin asks the server how that day stands (GET /api/nudge-check, a few bytes) and takes back
// what no longer applies. Offline, the server down, an answer it cannot read: nothing changes.
// When the app comes back to the foreground it resyncs from the full state as before.
//
// iOS decides when a background refresh actually runs (how much the app is used, battery, Low
// Power Mode), so there the check is a good chance, not a promise; Android runs it in the window
// asked for unless the phone is in deep sleep. See docs/MOBILE.md.
import { MOBILE } from './mobile.js'
import { isoOf } from './format.js'
import { remoteAuth } from './api.js'

// The id ranges syncReminder schedules (lib/mobile.js): workout-day reminders, then nudges.
export const REMINDER_IDS = [1000, 1999]
export const NUDGE_IDS = [2000, 2999]
const inRange = (id, [lo, hi]) => id >= lo && id <= hi

/**
 * The days a background check is for, from the notifications syncReminder just scheduled:
 * `{ date, at, reminder: [ids], nudge: [ids] }` per calendar day, `at` the first of them to fire
 * (ms), soonest first. Only what is still ahead of `now`.
 */
export function nudgeCheckPlan(notifications, now = Date.now()) {
  const byDate = new Map()
  for (const n of notifications || []) {
    const when = n?.schedule?.at instanceof Date ? n.schedule.at.getTime() : NaN
    if (!Number.isFinite(when) || when <= now) continue
    const kind = inRange(n.id, NUDGE_IDS) ? 'nudge' : inRange(n.id, REMINDER_IDS) ? 'reminder' : null
    if (!kind) continue
    const date = isoOf(new Date(when))
    const e = byDate.get(date) || { date, at: when, reminder: [], nudge: [] }
    e.at = Math.min(e.at, when)
    e[kind].push(n.id)
    byDate.set(date, e)
  }
  return [...byDate.values()].sort((a, b) => a.at - b.at)
}

/**
 * What one answer from GET /api/nudge-check takes back for its day: everything once the day was
 * trained or excused (`done`), only the nudge when the server would not nudge it (its plan moved),
 * nothing on anything else. No answer (offline, an error) or one that is not the server's for this
 * day: nothing, the phone keeps what it planned. The native plugins apply the same rule.
 */
export function idsToCancel(entry, answer) {
  if (!entry || !answer || typeof answer !== 'object' || answer.date !== entry.date) return []
  if (answer.done === true) return [...entry.reminder, ...entry.nudge]
  if (answer.nudge === false) return [...entry.nudge]
  return []
}

// Registered once, and handed out inside an object: a Capacitor plugin proxy answers `then` with
// a native call that never settles, so a promise resolved with the bare proxy hangs (#42).
let pluginP = null
const checkPlugin = () => pluginP || (pluginP = (async () => {
  if (!MOBILE) return null
  const { registerPlugin } = await import('@capacitor/core')
  return { NudgeCheck: registerPlugin('NudgeCheck') }
})().catch(() => null))

/**
 * Hands the plan to the native side, or takes it back: armed only on a paired phone with the
 * reminder and the missed-day nudge on. Never throws; a phone without the plugin (an older native
 * shell) just goes without the check, as before.
 */
export async function armNudgeCheck(S, notifications, now = Date.now()) {
  const p = await checkPlugin()
  if (!p) return false
  const r = S?.reminder
  const auth = remoteAuth()
  const entries = r?.on && r.nudge && auth ? nudgeCheckPlan(notifications, now) : []
  try {
    if (!entries.length) { await p.NudgeCheck.disarm(); return false }
    await p.NudgeCheck.arm({ server: auth.base, headers: auth.headers, entries })
    return true
  } catch { return false }
}

export function _resetNudgeCheck() { pluginP = null }
