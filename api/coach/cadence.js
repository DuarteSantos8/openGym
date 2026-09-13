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
export function isDue(coach, S, now, reviewedAt = 0) {
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
    const wantDay = cadence.weekly.day ?? 0;
    const wantTime = cadence.weekly.time || '18:00';
    if (now.weekday !== wantDay || now.hhmm !== wantTime) return false;
    // One per day, even if the tick sees the same minute twice.
    return new Date(lastAt).toISOString().slice(0, 10) !== now.date;
  }
  return false;
}

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
        if (!isDue(coach, S, now, reviewedAt)) continue;
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
