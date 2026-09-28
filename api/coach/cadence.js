/* Scheduled reviews (Epic E).
 *
 * A separate tick from the workout reminder's, because the two want different things: the
 * reminder has to land on the minute someone chose, this only has to happen on the right
 * evening. Sixty seconds is plenty, and it keeps a loop that reads every user's state file
 * off the ten-second path.
 *
 * Skips are silent and logged, never pushed (FR-36/E4). Somebody whose provider is down, or
 * who trained nothing this week, should hear nothing at all — a notification that exists to
 * report the absence of news is how people turn notifications off.
 */
import * as jobs from './jobs.js';
import * as cfgStore from './config.js';

const TICK_MS = 60000;

/** Weekly cadence fires within the minute; everyWorkouts fires as soon as the count is met.
 *  `reviewedAt` is when the server last finished a review for this person: the client stamps
 *  lastReview only once someone acts on a proposal, and a review nobody has opened yet — or
 *  one that found nothing to change — still read those workouts. */
export function isDue(coach, S, now, reviewedAt = 0, tz = null) {
  const cadence = coach.cadence;
  if (!cadence || cadence === 'off') return false;
  const lastAt = Math.max(coach.lastReview?.at || 0, reviewedAt);

  // Nothing new to read is the most common reason not to run, and it applies to both modes.
  const workouts = S.workouts || [];
  // A workout's `end` is on the same clock as the review's timestamp; its `d` is the phone's
  // local day, which can run ahead of the server's UTC day, so the date only stands in for a
  // workout that has no end.
  const since = workouts.filter(w => !lastAt || (w.end ? w.end > lastAt : w.d > new Date(lastAt).toISOString().slice(0, 10)));
  if (!since.length) return false;

  if (cadence.everyWorkouts) {
    return since.length >= Math.max(1, Math.min(20, cadence.everyWorkouts));
  }
  if (cadence.weekly) {
    if (!now) return false;
    // Due once the week's slot has passed and this week's review has not run — not on the one
    // minute it falls. The tick is every 60 s and unaligned, so the exact-minute test lost the
    // whole week to a restart, a redeploy or a busy event loop across that minute; the same
    // reason the workout reminder stopped asking for its exact minute. `lastAt` is the marker
    // that says whether it already ran: the server's own finished-review timestamps (the
    // `reviewedAt` the caller computes from the job history) and the client's lastReview.
    const at = weeklySlotAt(now, cadence.weekly.day ?? 0, cadence.weekly.time || '18:00', tz);
    return at != null && lastAt < at;
  }
  return false;
}

/* When this week's slot fell, as an epoch timestamp — the clock `lastAt` is on.
 *
 * `now` is the user's own wall clock (date, hh:mm, weekday, from their reminder timezone) and
 * the marker is epoch milliseconds, so a wall clock reading has to be turned into an instant.
 * What turns one into the other is the zone's offset, and the offset that matters is the one AT
 * the slot, not the one here now: the slot can be six days old, and twice a year the zone moved
 * in between. Using today's offset on last Sunday's slot puts it an hour out, which on the
 * fall-back Sunday is enough to call a review due eight hours before its time — and then again
 * at its time, so the week gets two.
 *
 * So the slot is resolved at its own instant: instant = wall − offset(instant), settled in two
 * passes. The first uses the offset where the caller is now (at most an hour out), the second the
 * offset at that approximation, which is the slot's own on either side of a changeover. A wall
 * clock inside a skipped hour names no instant at all; it lands within the hour either way, which
 * is as close as the question ("has this week's slot passed") can be asked.
 *
 * "This week's" is the slot's most recent occurrence at or before now, so on the slot's own day
 * but before its time it is last week's — which the last run is already past, so nothing fires
 * early. Null when the shapes do not parse. */
function weeklySlotAt(now, wantDay, wantTime, tz) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(now.date || '');
  const nowMin = hhmmToMin(now.hhmm), wantMin = hhmmToMin(wantTime);
  if (!d || !Number.isFinite(nowMin) || !Number.isFinite(wantMin)) return null;
  const midnight = Date.UTC(+d[1], +d[2] - 1, +d[3]);
  let back = (now.weekday - wantDay + 7) % 7;
  if (back === 0 && nowMin < wantMin) back = 7;
  const wall = midnight - back * 86400000 + wantMin * 60000;
  const here = midnight + nowMin * 60000;
  return wall - offsetAt(tz, wall - offsetAt(tz, Date.now(), here), here);
}
/* The zone's offset from UTC at one instant, in ms: what a wall clock reading there is ahead of
 * the instant it names. Without a usable zone — no tz, or a string Intl refuses — it falls back
 * to the offset where the caller is right now, which is all this ever had to go on. */
function offsetAt(tz, ms, hereWall) {
  try {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(ms));
    const g = t => Number(p.find(x => x.type === t).value);
    return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ms;
  } catch {
    return hereWall - Date.now();
  }
}
const hhmmToMin = v => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/**
 * @param {object} deps  { users(): [{id}], userNow(tz): {date,hhmm,weekday} }
 */
export function startCadence(deps) {
  const timer = setInterval(() => {
    if (!cfgStore.isEnabled() || !cfgStore.isConnected()) return;
    for (const user of deps.users()) {
      try {
        const S = jobs.readState(user.id);
        const coach = S?.coach;
        if (!coach?.consent?.agreedAt) continue;         // consent revoked ⇒ cadence stops
        // A job still running, or a proposal nobody has answered, is not a reason for another:
        // a second review would only replace the first unread. status() also retires an
        // expired proposal, which a phone that stays closed never polls for.
        const st = jobs.status(user.id);
        if (st.job || st.pending) continue;
        // Reviewed means the model read those workouts and answered — with a proposal, with
        // "nothing to change", or with an answer that failed validation and was paid for all the
        // same. A call that never reached it (timeout, no runtime, consent, switched off) is retried.
        const reviewedAt = Math.max(0, ...jobs.readUser(user.id).history
          .filter(h => h.kind === 'review' && (h.outcome === 'ready' || h.outcome === 'nochange'
            || (h.outcome === 'failed' && h.errorClass === 'unusable')))
          .map(h => h.at || 0));
        const tz = coach.cadence?.weekly ? (S.reminder?.tz || 'UTC') : null;
        const now = tz ? deps.userNow(tz) : null;
        if (!isDue(coach, S, now, reviewedAt, tz)) continue;
        jobs.enqueue(user.id, { kind: 'review', trigger: 'scheduled' });
        console.log('coach: scheduled review queued for', user.id);
      } catch (e) {
        // Caps, an in-flight job, a provider that just went down: all ordinary, all silent.
        if (!(e instanceof jobs.CoachError)) console.error('coach cadence', user.id, e);
      }
    }
  }, TICK_MS);
  timer.unref();
  return timer;
}
