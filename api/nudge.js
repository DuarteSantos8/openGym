// Missed-workout nudge — the server half. Hand-copied (not imported) from
// frontend/src/lib/nudge.js, as queue.js is from lib/queue.js: see there for the three rules
// (WHEN 20:00, or 2 h after the reminder, until 21:30; WHICH day counts as missed; the back-off
// after 3 missed days in a row). Kept out of server.js so it can be unit-tested without booting
// the server; the tick in server.js adds what only it knows (the push subscription, a session
// on screen right now, the once-a-day mark in db.json).
import { effectiveRoutineId, queueLiveOn } from './queue.js';

export const NUDGE_TONES = ['friendly', 'guilt', 'drill'];
export const NUDGE_MAX_MISSES = 3;
export const NUDGE_LOOKBACK_DAYS = 14;
const EVENING = 20 * 60, LATEST = 21 * 60 + 30, AFTER_REMINDER = 120;

export const toneOf = r => (NUDGE_TONES.includes(r?.tone) ? r.tone : 'friendly');

const hhmmToMin = v => {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** Minutes after midnight the nudge is owed from, or null when that would be after 21:30. */
export function nudgeMinute(reminderTime) {
  const r = hhmmToMin(reminderTime);
  const at = Math.max(EVENING, Number.isNaN(r) ? 0 : r + AFTER_REMINDER);
  return at > LATEST ? null : at;
}

/** Is `hhmm` inside today's nudge window for a reminder set at `reminderTime`? */
export function nudgeWindowOpen(reminderTime, hhmm) {
  const at = nudgeMinute(reminderTime);
  const now = hhmmToMin(hhmm);
  return at != null && now >= at && now <= LATEST;
}

// Calendar arithmetic on ISO dates at UTC noon: no zone or DST edge can move the day.
const dayBefore = iso => new Date(Date.parse(iso + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
const records = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
const logged = (S, iso) => S.workouts.some(w => w.d === iso);

function missed(S, iso) {
  if (logged(S, iso)) return null;
  const rid = effectiveRoutineId(S, iso);
  if (!rid) return null;
  if (queueLiveOn(S, iso) && logged(S, dayBefore(iso))) return null;
  return rid;
}

/**
 * The routine id to nudge about on `iso`, or null: not a missed day, or 3 missed days in a row
 * already since the last workout (back-off). Workouts dated after `iso` are not looked at.
 */
export function nudgeFor(state, iso) {
  const S = { ...state, workouts: records(state?.workouts), routines: records(state?.routines) };
  const rid = missed(S, iso);
  if (!rid) return null;
  const last = S.workouts.reduce((m, w) => (typeof w.d === 'string' && w.d < iso && w.d > m ? w.d : m), '');
  let misses = 0;
  let d = dayBefore(iso);
  for (let i = 0; i < NUDGE_LOOKBACK_DAYS && d > last; i++, d = dayBefore(d)) {
    if (missed(S, d) && ++misses >= NUDGE_MAX_MISSES) return null;
  }
  return rid;
}

/** The day's line index: by date, so a day keeps its line and consecutive days rotate. */
export const lineIndex = (iso, n) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 86400000) % n;
