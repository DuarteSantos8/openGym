/* The data categories the consent screen names (FR-09/10).
 *
 * Its own tiny module so a screen that only needs to *say* what would leave — the mobile setup
 * screen, before anything AI-related has been loaded — can import five strings without pulling
 * the payload builder and the exercise catalogue behind it. payload.js re-exports it, and
 * builds from it, so the screen cannot drift from the payload. */
export const DATA_CATEGORIES = Object.freeze([
  'plan',        // routines, exercises, sets/reps, schedule, progression settings
  'training',    // logged sets, targets, effort ratings, durations, PRs, session notes in the review window
  'bodyweight',  // weigh-ins in the window and your goal weight
  'profile',     // the intake answers you gave the Coach, including any limitations
  'prefs'        // unit, language, effort scale
]);

/* What else the Coach may read, each with its own switch under "What the Coach sees" (stored in
 * S.coach.share). `on` is the default for a profile that never touched the switch. Health is off
 * until asked for: sleep, heart rate and how you feel are more personal than a set of squats. */
export const OPTIONAL_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'records', on: true }),       // estimated 1RMs and their 12-week trend
  Object.freeze({ id: 'measurements', on: true }),  // body measurements, latest and eight weeks before
  Object.freeze({ id: 'health', on: false })        // daily check-ins, phone vitals, blood pressure
]);

/** The switches as they stand for a profile: { records, measurements, health }. */
export function shareOf(S) {
  const set = S && S.coach && S.coach.share && typeof S.coach.share === 'object' ? S.coach.share : {};
  const out = {};
  for (const c of OPTIONAL_CATEGORIES) out[c.id] = typeof set[c.id] === 'boolean' ? set[c.id] : c.on;
  return out;
}
