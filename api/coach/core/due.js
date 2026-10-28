/* When a scheduled review is due: the one rule, shared by the server's tick (../cadence.js) and
 * the phone that brings its own API key (frontend/src/lib/coach-local.js), which has no server
 * to run the tick for it. Pure: the caller hands in the clock, the run marker and the zone. */

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
