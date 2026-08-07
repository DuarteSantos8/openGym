/* First-party catalogue additions.
 *
 * exercises-data.js is a vendored strength-training dataset. It is excellent at barbells and
 * has almost nothing for endurance work: one treadmill entry, one elliptical, no rowing
 * machine, and nothing at all for running outdoors. Adding rows to that file would work until
 * the next dataset refresh silently dropped them.
 *
 * So they live here instead and are merged in exercises.js. A refresh replaces the dataset and
 * leaves this file alone, which is the property that matters — these are openGym's own rows,
 * not the dataset's.
 *
 * `og-` ids cannot collide with the dataset's four-digit ones. Fields match the dataset's shape
 * exactly (id, n, bp, tg, eq) so every consumer — EXIDX, the library index the Coach validates
 * against, search, filtering — treats them as ordinary exercises with no special-casing.
 */
export const EXTRA = [
  { id: 'og-run-outdoor', n: 'run (outdoors)', bp: 'cardio', tg: 'cardiovascular system', eq: 'body weight' },
  { id: 'og-jog-easy', n: 'easy run / jog', bp: 'cardio', tg: 'cardiovascular system', eq: 'body weight' },
  { id: 'og-walk-outdoor', n: 'walk (outdoors)', bp: 'cardio', tg: 'cardiovascular system', eq: 'body weight' },
  { id: 'og-treadmill-run', n: 'treadmill run', bp: 'cardio', tg: 'cardiovascular system', eq: 'leverage machine' },
  { id: 'og-rower', n: 'rowing machine', bp: 'cardio', tg: 'cardiovascular system', eq: 'leverage machine' },
  { id: 'og-elliptical-run', n: 'elliptical trainer', bp: 'cardio', tg: 'cardiovascular system', eq: 'elliptical machine' },
  { id: 'og-bike-stationary', n: 'stationary bike (steady)', bp: 'cardio', tg: 'cardiovascular system', eq: 'stationary bike' }
]
