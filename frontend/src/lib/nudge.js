// Missed-workout nudge — one playful notification on the evening of a planned day that went by
// without a workout. Opt-in, under the workout-day reminder (S.reminder.nudge, S.reminder.tone).
//
// The self-hosted app sends it as a web push from the server (api/nudge.js, a hand copy of the
// rules below, as api/queue.js is of lib/queue.js); the mobile build schedules it as a native
// local notification (lib/mobile.js). Both answer the same three questions the same way:
//
//   WHEN  — at 20:00 on the user's clock, or 2 hours after the reminder when that is later, and
//           never after 21:30: a nudge is owed from that time until 21:30, once per day.
//   WHICH — a day is a MISSED day when it has a routine planned (the same plan the reminder
//           reads, coach week/rotation included) and no workout dated on it. A floating coach
//           week or rotation names a session every day until it is done, so on such a day the
//           day right after a workout is a rest day, not a miss — only the second day off in a
//           row counts.
//   HOW OFTEN — back-off: the missed days since the last workout are counted (14 days back at
//           most). After 3 of them the nudge goes quiet until the next workout is logged, so a
//           break never turns into a daily nag. No counter is stored anywhere: it is read off
//           the plan and the log, so the server and the phone agree without syncing anything.
//
// Copy: three tones, one title and four lines each. The line is chosen by the date, so a day
// always gets the same one and consecutive days rotate. Keys are the English source strings;
// api/nudge-copy.js carries the server's copy of their translations (a test keeps the two equal).
import { isoOf } from './format.js'
import { effectiveRoutineIds } from './history.js'
import { queueLiveOn } from './queue.js'

export const NUDGE_TONES = ['friendly', 'guilt', 'drill']
export const NUDGE_MAX_MISSES = 3
export const NUDGE_LOOKBACK_DAYS = 14
const EVENING = 20 * 60, LATEST = 21 * 60 + 30, AFTER_REMINDER = 120

export const NUDGE_COPY = {
  friendly: {
    title: 'Everything okay?',
    lines: [
      '{0} is still waiting. What’s up?',
      'No {0} today? Even a short session tomorrow counts.',
      'Rough day? {0} will keep. Tomorrow is a fresh start.',
      'Hey, {0} didn’t happen today. All good?',
    ],
  },
  guilt: {
    title: 'I miss you',
    lines: [
      '{0} waited by the door all evening. For you.',
      'The barbell asked about you today. I didn’t know what to say.',
      'Was it something I said? {0} misses you.',
      'I saved you a spot on the bench. It’s still empty.',
    ],
  },
  drill: {
    title: 'Attention, recruit!',
    lines: [
      'Your gains are packing their bags. {0} tomorrow, no excuses!',
      '{0} doesn’t do itself, recruit. Move it!',
      'Excuses don’t lift weights. Report for {0} tomorrow!',
      'Your muscles filed a missing-person report. Show up for {0}!',
    ],
  },
}

export const toneOf = r => (NUDGE_TONES.includes(r?.tone) ? r.tone : 'friendly')

const hhmmToMin = v => {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN
}

/** Minutes after midnight the nudge is owed from, or null when that would be after 21:30. */
export function nudgeMinute(reminderTime) {
  const r = hhmmToMin(reminderTime)
  const at = Math.max(EVENING, Number.isNaN(r) ? 0 : r + AFTER_REMINDER)
  return at > LATEST ? null : at
}
export const NUDGE_LATEST_MINUTE = LATEST

const dayBefore = iso => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() - 1); return isoOf(d) }
const logged = (S, iso) => (S.workouts || []).some(w => w?.d === iso)
const norm = S => ({
  ...S,
  routines: Array.isArray(S?.routines) ? S.routines.filter(Boolean) : [],
  workouts: Array.isArray(S?.workouts) ? S.workouts.filter(Boolean) : [],
  week: S?.week || {}, dayPlan: S?.dayPlan || {},
})

// The routine ids `iso` missed, or [] when it is not a missed day. Each date is asked as if it
// were today, as the reminder does: a coach week's session is due every day until it is done.
function missed(S, iso) {
  if (logged(S, iso)) return []
  const ids = effectiveRoutineIds(S, iso, iso)
  if (!ids.length) return []
  if (queueLiveOn(S, iso, iso) && logged(S, dayBefore(iso))) return []
  return ids
}

/**
 * The routine ids to nudge about on `iso`, or null: not a missed day, or already 3 missed days in
 * a row since the last workout (back-off). Workouts dated after `iso` are not looked at, so the
 * phone can ask about future dates and get the back-off of a break that simply goes on.
 */
export function nudgeFor(state, iso) {
  const S = norm(state)
  const ids = missed(S, iso)
  if (!ids.length) return null
  const last = S.workouts.reduce((m, w) => (typeof w.d === 'string' && w.d < iso && w.d > m ? w.d : m), '')
  let misses = 0
  let d = dayBefore(iso)
  for (let i = 0; i < NUDGE_LOOKBACK_DAYS && d > last; i++, d = dayBefore(d)) {
    if (missed(S, d).length && ++misses >= NUDGE_MAX_MISSES) return null
  }
  return ids
}

/** The day's line index: by date, so a day keeps its line and consecutive days rotate. */
export const lineIndex = (iso, n) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000) % n
