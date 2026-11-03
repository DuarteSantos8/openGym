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
import { isDue } from './core/due.js';

// Re-exported so nothing that reached it through this module has to move.
export { isDue };

const TICK_MS = 60000;

/**
 * @param {object} deps  { users(): [{id}], userNow(tz): {date,hhmm,weekday}, skip?(uid): bool }
 */
export function startCadence(deps) {
  const timer = setInterval(() => {
    if (!cfgStore.isEnabled() || !cfgStore.isConnected()) return;
    for (const user of deps.users()) {
      try {
        // A profile that never agreed to the Coach is skipped before its whole state is read.
        if (deps.skip?.(user.id)) continue;
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
