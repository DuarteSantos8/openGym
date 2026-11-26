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
import { isDue, reviewedAtOf, retryWaiting } from './core/due.js';
import { baseUrlFor } from './core/providers.js';

// Re-exported so nothing that reached it through this module has to move.
export { isDue };

const TICK_MS = 60000;

/* Why someone with automatic reviews on got none is otherwise invisible: every skip is silent
 * (FR-36). So the tick says it in the server log, once per person each time the reason changes
 * (Discord, "Scheduled coach review doesn't trigger": nobody could tell which rule held it back).
 * Not "nothing new to read" or "not due yet", which is most minutes for most people. */
const lastWhy = new Map();
function why(uid, reason) {
  if (lastWhy.get(uid) === reason) return;
  lastWhy.set(uid, reason);
  if (reason) console.log('coach: automatic review for', uid, 'held back:', reason);
}
export const _resetWhyForTests = () => lastWhy.clear();

// The provider and host reviews go to, as `GET /api/coach/disclosure` names them: the app keeps
// the one automatic reviews were switched on for in S.coach.cadenceFor (views/CoachChat.jsx).
const hostOf = url => { try { return url ? new URL(url).host : ''; } catch { return ''; } };
export const cadenceTarget = cfg => `${cfg.provider}|${hostOf(baseUrlFor(cfg.provider, cfg))}`;

/**
 * @param {object} deps  { users(): [{id}], userNow(tz): {date,hhmm,weekday}, skip?(uid): bool }
 */
export function startCadence(deps) {
  const timer = setInterval(() => {
    if (!cfgStore.isEnabled() || !cfgStore.isConnected()) return;
    const target = cadenceTarget(cfgStore.load());
    for (const user of deps.users()) {
      try {
        // A profile that never agreed to the Coach is skipped before its whole state is read.
        if (deps.skip?.(user.id)) continue;
        const S = jobs.readState(user.id);
        const coach = S?.coach;
        const on = !!coach?.cadence && coach.cadence !== 'off';
        if (!coach?.consent?.agreedAt) { if (on) why(user.id, 'no Coach consent'); continue; }  // consent revoked ⇒ cadence stops
        if (!on) { why(user.id, ''); continue; }
        // Settings → Modules: the AI Coach switched off pauses the reviews; its setup stays.
        if (S?.modules?.coach === false) { why(user.id, 'the Coach module is off'); continue; }
        // Agreed for another provider or host (the admin changed it since, or it was switched on
        // before this was kept): paused until the app asks the member again. The app fills in a
        // missing one by itself when this device already said yes to the server's provider
        // (lib/coach-api.js adoptCadence), so only a real change waits for the Coach to be opened.
        if (coach.cadenceFor !== target) { why(user.id, `switched on for ${coach.cadenceFor || 'an older version'}, the server now uses ${target}: opening the Coach in the app asks again`); continue; }
        // A job still running, or a proposal nobody has answered, is not a reason for another:
        // a second review would only replace the first unread. status() also retires an
        // expired proposal, which a phone that stays closed never polls for.
        const st = jobs.status(user.id);
        if (st.job) continue;
        if (st.pending) { why(user.id, 'a proposal is still waiting for an answer'); continue; }
        // Reviewed means the model read those workouts and answered — with a proposal, with
        // "nothing to change", or with an answer that failed validation and was paid for all the
        // same. A call that never reached it (timeout, no runtime, consent, switched off) is retried.
        // A failure no retry fixes (a refused key, no runtime) counts too, or the tick queued it
        // again every minute and spent the day's cap on it (core/due.js reviewedAtOf).
        const history = jobs.readUser(user.id).history;
        const reviewedAt = reviewedAtOf(history);
        if (retryWaiting(history)) { why(user.id, 'the last try failed, trying again in a few minutes'); continue; }
        const tz = coach.cadence?.weekly ? (S.reminder?.tz || 'UTC') : null;
        const now = tz ? deps.userNow(tz) : null;
        if (!isDue(coach, S, now, reviewedAt, tz)) { why(user.id, ''); continue; }
        why(user.id, '');
        jobs.enqueue(user.id, { kind: 'review', trigger: 'scheduled' });
        console.log('coach: scheduled review queued for', user.id);
      } catch (e) {
        // Caps, an in-flight job, a provider that just went down: all ordinary, all silent.
        if (!(e instanceof jobs.CoachError)) console.error('coach cadence', user.id, e);
        else why(user.id, `${e.code}: ${e.message}`);
      }
    }
  }, TICK_MS);
  timer.unref();
  return timer;
}
