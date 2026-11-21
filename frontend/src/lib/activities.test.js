import { describe, it, expect } from 'vitest'
import {
  readActivity, activitiesOf, withActivity, activityTotals, activityStimuli, activityFromHealth, mergeHealthActivities,
  sportOfName, activitiesFromHealthExport, splitSportWorkouts, mergeImportedActivities, isOwnRecord, hkSportName, activityLine,
} from './activities.js'
import { streakInfo } from './streak.js'
import { fatigueOf } from './recovery.js'
import { parseImport, mergeImport } from './import-csv.js'

const at = (iso, h = 18) => new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`).getTime()

describe('activities: the stored entry', () => {
  it('reads a clean entry and drops broken ones', () => {
    expect(readActivity({ d: '2026-11-02', sport: 'run', min: 42.4, km: 8.123, src: 'hc' })).toEqual({ d: '2026-11-02', sport: 'run', min: 42, km: 8.12, src: 'hc' })
    expect(readActivity({ d: '2026-11-02', sport: 'quidditch', min: 30 }).sport).toBe('other')
    expect(readActivity({ d: '2026-11-02', sport: 'run', min: 0 })).toBe(null)
    expect(readActivity({ d: 'yesterday', sport: 'run', min: 30 })).toBe(null)
    expect(readActivity({ _ts: 5 })).toBe(null)
  })
  it('a removal is a stamped empty entry, so it syncs and stays gone', () => {
    let map = withActivity({}, 'a1', { d: '2026-11-02', sport: 'football', min: 90 }, 10)
    expect(activitiesOf({ activities: map })).toHaveLength(1)
    map = withActivity(map, 'a1', null, 20)
    expect(map.a1).toEqual({ _ts: 20 })
    expect(activitiesOf({ activities: map })).toEqual([])
  })
  it('adds up a month', () => {
    const S = { activities: {
      a: { d: '2026-10-03', sport: 'run', min: 40, km: 8 }, b: { d: '2026-10-10', sport: 'run', min: 50, km: 10.5 },
      c: { d: '2026-10-10', sport: 'racket', min: 60 }, d: { d: '2026-09-30', sport: 'run', min: 30 },
    } }
    const tot = activityTotals(S, '2026-10-01', '2026-10-31')
    expect(tot).toMatchObject({ n: 3, min: 150, km: 18.5, days: 2 })
    expect(tot.sports[0]).toMatchObject({ sport: 'run', n: 2, min: 90 })
    expect(activityLine({ sport: 'run', min: 42, km: 8.1 })).toBe('Run · {0} min · 8.1 km')
  })
})

describe('activities: the week streak', () => {
  const S = { workouts: [{ id: 'w', d: '2026-10-19', entries: [] }], activities: { a: { d: '2026-10-28', sport: 'football', min: 90 } } }
  it('counts only when the profile opted in', () => {
    expect(streakInfo(S, '2026-10-30').current).toBe(1)
    expect(streakInfo({ ...S, activityStreak: true }, '2026-10-30').current).toBe(2)
  })
  it('a removed activity counts for nothing', () => {
    expect(streakInfo({ ...S, activityStreak: true, activities: { a: { _ts: 3 } } }, '2026-10-30').current).toBe(1)
  })
})

describe('activities: the recovery model', () => {
  it('football tires the legs and leaves the arms alone', () => {
    const now = at('2026-11-02', 21)
    const S = { activities: { a: { d: '2026-11-02', sport: 'football', min: 90, at: at('2026-11-02', 18) } } }
    const f = fatigueOf([], now, { activities: activityStimuli(S, now) })
    expect(f.quadriceps).toBeGreaterThan(0.4)
    expect(f.hamstring).toBeGreaterThan(0.4)
    expect(f.biceps).toBe(0)
    // nothing without activities, and nothing once switched off
    expect(fatigueOf([], now).quadriceps).toBe(0)
    expect(activityStimuli({ ...S, activityRecovery: false }, now)).toEqual([])
  })
  it('fades with time and never counts the future', () => {
    const S = { activities: { a: { d: '2026-11-02', sport: 'run', min: 45, at: at('2026-11-02', 7) } } }
    const soon = at('2026-11-02', 9), later = at('2026-11-05', 9)
    const a = fatigueOf([], soon, { activities: activityStimuli(S, soon) }).calves
    const b = fatigueOf([], later, { activities: activityStimuli(S, later) }).calves
    expect(a).toBeGreaterThan(b)
    expect(activityStimuli(S, at('2026-11-01'))).toEqual([])
  })
})

describe('activities: from the health store', () => {
  const now = at('2026-11-03', 12)
  const rec = { id: 'hc-1', sport: 'run', start: at('2026-11-02', 7), end: at('2026-11-02', 7) + 42 * 60e3, origin: 'com.strava' }
  it('takes a run from Strava, with its day and minutes', () => {
    expect(activityFromHealth(rec, {}, 'hc', now)).toMatchObject({ d: '2026-11-02', sport: 'run', min: 42, src: 'hc' })
  })
  it('skips openGym\'s own, strength, gym cardio, walks, short ones and the future', () => {
    expect(isOwnRecord({ origin: 'ch.duartesantos.opengym' })).toBe(true)
    expect(isOwnRecord({ origin: 'ch.opengym.app.watchkitapp' })).toBe(true)
    expect(isOwnRecord({ clientId: 'opengym-w-1' })).toBe(true)
    expect(activityFromHealth({ ...rec, origin: 'ch.opengym.app' }, {}, 'ah', now)).toBe(null)
    for (const sport of ['strength', 'gym', 'walk']) expect(activityFromHealth({ ...rec, sport }, {}, 'hc', now)).toBe(null)
    expect(activityFromHealth({ ...rec, end: rec.start + 3 * 60e3 }, {}, 'hc', now)).toBe(null)
    expect(activityFromHealth(rec, {}, 'hc', at('2026-11-01'))).toBe(null)
  })
  it('skips one that lies over a workout logged here (the treadmill the watch also saved)', () => {
    const S = { workouts: [{ id: 'w', d: '2026-11-02', start: rec.start - 10 * 60e3, end: rec.end + 5 * 60e3 }] }
    expect(activityFromHealth(rec, S, 'hc', now)).toBe(null)
  })
  it('merges once, and never brings a removed one back', () => {
    const S = {}
    expect(mergeHealthActivities(S, [rec], { src: 'hc', now })).toHaveLength(1)
    expect(mergeHealthActivities(S, [rec], { src: 'hc', now })).toHaveLength(0)
    const id = Object.keys(S.activities)[0]
    S.activities = withActivity(S.activities, id, null, now)
    expect(mergeHealthActivities(S, [rec], { src: 'hc', now })).toHaveLength(0)
    expect(activitiesOf(S)).toEqual([])
  })
})

describe('activities: imports', () => {
  it('names a sport, and leaves gym cardio alone', () => {
    expect(sportOfName('Padel with Tom')).toBe('racket')
    expect(sportOfName('Fußball')).toBe('football')
    expect(sportOfName('Bouldering')).toBe('climb')
    expect(sportOfName('Running')).toBe('run')
    expect(sportOfName('Treadmill run')).toBe(null)
    expect(sportOfName('Rowing machine')).toBe(null)
    expect(sportOfName('Bench Press (Barbell)')).toBe(null)
    expect(hkSportName('HKWorkoutActivityTypeSoccer')).toBe('football')
    expect(hkSportName('HKWorkoutActivityTypeSomethingNew')).toBe('other')
  })
  it('reads the runs and matches of an Apple Health export, and skips openGym, strength and walks', () => {
    const xml = `<?xml version="1.0"?><HealthData>
      <Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="42.5" durationUnit="min" totalDistance="8.2" totalDistanceUnit="km" sourceName="Strava" startDate="2026-10-05 07:00:00 +0200" endDate="2026-10-05 07:42:30 +0200"><MetadataEntry key="x" value="y"/></Workout>
      <Workout workoutActivityType="HKWorkoutActivityTypeTennis" duration="1.5" durationUnit="hr" sourceName="Watch" startDate="2026-10-06 18:00:00 +0200" endDate="2026-10-06 19:30:00 +0200"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="60" durationUnit="min" sourceName="openGym" startDate="2026-10-07 18:00:00 +0200"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeWalking" duration="30" durationUnit="min" sourceName="Watch" startDate="2026-10-08 12:00:00 +0200"/>
      <Workout workoutActivityType="HKWorkoutActivityTypeSoccer" duration="90" durationUnit="min" sourceName="openGym" startDate="2026-10-09 12:00:00 +0200"/>
    </HealthData>`
    const list = activitiesFromHealthExport(xml)
    expect(list.map(a => [a.d, a.sport, a.min, a.km ?? null])).toEqual([['2026-10-05', 'run', 43, 8.2], ['2026-10-06', 'racket', 90, null]])
    // through the import itself: an export with no weigh-in is still something to import
    const parsed = parseImport(xml, { unit: 'kg' })
    expect(parsed.kind).toBe('bodyweight')
    expect(parsed.activities).toHaveLength(2)
    const S = { workouts: [], bodyweight: [], customEx: [], exWeights: {} }
    expect(mergeImport(S, parsed).activities).toBe(2)
    expect(mergeImport(S, parsed).activities).toBe(0)
    expect(activitiesOf(S)).toHaveLength(2)
  })
  it('turns a session that was only sport into an activity and keeps a real workout', () => {
    const nameOf = e => ({ c1: 'Padel', c2: 'Bench Press', c3: 'Football' })[e.id] || ''
    const workouts = [
      { d: '2026-10-01', start: at('2026-10-01'), name: 'Padel night', entries: [{ id: 'c1', sets: [{ min: 75, done: true }] }] },
      { d: '2026-10-02', name: 'Push', entries: [{ id: 'c2', sets: [{ w: 80, r: 5, done: true }] }, { id: 'c1', sets: [{ min: 10, done: true }] }] },
      { d: '2026-10-03', name: 'Imported', entries: [{ id: 'c3', sets: [{ min: 45, done: true }, { min: 45, done: true }] }] },
    ]
    const { workouts: kept, activities } = splitSportWorkouts(workouts, nameOf)
    expect(kept.map(w => w.d)).toEqual(['2026-10-02'])
    expect(activities.map(a => [a.d, a.sport, a.min, a.title])).toEqual([['2026-10-01', 'racket', 75, 'Padel night'], ['2026-10-03', 'football', 90, 'Football']])
    const S = {}
    expect(mergeImportedActivities(S, activities)).toBe(2)
    expect(mergeImportedActivities(S, activities)).toBe(0)
  })
})

