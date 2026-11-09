// The moments Settings > Workout > Live widget previews: a strength set, its rest, the rest before
// a new exercise, a timed hold, cardio, a carry, a band exercise, a superset and the end. Each is a
// small workout of real catalogue exercises run through the very payload the Lock Screen gets
// (lib/live-activity.js buildLiveActivity), so names, units and the profile's own choices come out
// the way they will on the phone. "Your workout" leads when one is running.
import { t } from './i18n.js'
import { buildLiveActivity } from './live-activity.js'
import { starterBands, bandsOf } from './bands.js'

const MIN = 60e3

// The words as literal t() calls, so scripts/check-source-strings.mjs sees each of them.
export const SAMPLE_IDS = ['strength', 'rest', 'switch', 'hold', 'cardio', 'carry', 'band', 'superset', 'done']
export const sampleLabel = id => ({
  live: t('Your workout'),
  strength: t('Strength set'),
  rest: t('Resting'),
  switch: t('Next exercise'),
  hold: t('Timed hold'),
  cardio: t('Cardio'),
  carry: t('Carry'),
  band: t('Band'),
  superset: t('Superset'),
  done: t('All done'),
})[id] || id

const done = (x, at, hr) => ({ ...x, done: true, at, ...(hr ? { hr: { avg: hr, max: hr + 12 } } : {}) })

function workout (id, now) {
  const start = now - 26 * MIN
  const bench = (n) => ({ id: '0025', target: { mode: 'reps', reps: 8, weight: 80 }, sets: [
    done({ w: 60, r: 8, phase: 'warmup' }, now - 14 * MIN),
    ...Array.from({ length: 4 }, (_, i) => (i < n ? done({ w: 80, r: 8, rir: 2 }, now - (10 - i * 3) * MIN, 126 + i * 4) : { w: 80, r: 8 })),
  ] })
  const row = { id: '0027', target: { mode: 'reps', reps: 10, weight: 60 }, sets: [{ w: 60, r: 10 }, { w: 60, r: 10 }, { w: 60, r: 10 }] }
  switch (id) {
    case 'strength': return { entries: [bench(2), row], cur: 0 }
    case 'rest': return { entries: [bench(2), row], cur: 0, timer: { endsAt: now + 75e3, left: 75, total: 120, kind: 'rest' } }
    case 'switch': return { entries: [bench(4), row], cur: 1, timer: { endsAt: now + 100e3, left: 100, total: 150, kind: 'rest' } }
    case 'hold': return {
      entries: [{ id: '0463', target: { mode: 'time', sec: 45, bodyweight: true }, sets: [done({ sec: 45 }, now - 3 * MIN, 118), { sec: 45 }, { sec: 45 }] }],
      cur: 0, hold: { work: { endsAt: now + 32e3, left: 32, total: 45 } },
    }
    case 'cardio': return { entries: [{ id: '2259', target: { mode: 'cardio', min: 20, speed: 8 }, sets: [{ min: 20, speed: 8, incline: 2 }] }], cur: 0, hr: 142 }
    case 'carry': return { entries: [{ id: '2133', target: { mode: 'distance', m: 40, weight: 24 }, sets: [done({ m: 40, w: 24 }, now - 2 * MIN, 131), { m: 40, w: 24 }, { m: 40, w: 24 }] }], cur: 0 }
    case 'band': return { entries: [{ id: '1503', target: { mode: 'reps', reps: 15 }, sets: [done({ r: 15, bands: ['b-red'] }, now - 2 * MIN, 112), { r: 15, bands: ['b-red'] }, { r: 15, bands: ['b-red'] }] }], cur: 0, band: true }
    case 'superset': return {
      entries: [
        { ...bench(1), sg: 'a', sets: bench(1).sets.slice(1) },
        { id: '0652', sg: 'a', target: { mode: 'reps', reps: 8, bodyweight: true }, sets: [done({ w: 0, r: 8 }, now - 6 * MIN, 134), { w: 0, r: 8 }, { w: 0, r: 8 }, { w: 0, r: 8 }] },
      ],
      cur: 0,
    }
    case 'done': return { entries: [{ ...bench(4) }, { ...row, sets: row.sets.map((x, i) => done(x, now - (6 - i) * MIN)) }], cur: 1 }
    default: return { entries: [bench(2), row], cur: 0 }
  }
}

/**
 * The activity (`{ attributes, state }`) for sample `id` on this profile, or for the workout running
 * (`live`). `opts.glance` a setting to preview instead of the stored one (Customise draws its draft).
 */
export function sampleLive (S, id, { glance = null, timer = null, hold = null, now = Date.now() } = {}) {
  const base = glance ? { ...S, liveWidget: glance } : S
  if (id === 'live' && S?.active && !S.active.editingWorkoutId) {
    return buildLiveActivity(base, timer, hold || {}, { now })
  }
  const w = workout(id, now)
  const PS = {
    ...base,
    bands: bandsOf(S).length ? S.bands : starterBands(),
    active: { id: 'preview', name: t('Push day'), start: now - 26 * MIN, cur: w.cur, entries: w.entries },
  }
  // A band sample needs a band the profile knows: the first of its own, else the starter red one.
  if (w.band && bandsOf(S).length) {
    const first = bandsOf(S)[0].id
    PS.active.entries = PS.active.entries.map(e => ({ ...e, sets: e.sets.map(x => ({ ...x, bands: [first] })) }))
  }
  return buildLiveActivity(PS, w.timer || null, w.hold || {}, { now, live: w.hr ? { bpm: w.hr } : null })
}

/** The samples to offer: the running workout first when there is one. */
export function sampleIds (S) {
  return S?.active && !S.active.editingWorkoutId && !S.active.backfill ? ['live', ...SAMPLE_IDS] : SAMPLE_IDS
}
