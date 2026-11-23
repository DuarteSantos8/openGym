import { describe, expect, it } from 'vitest'
import { parseQuickLog, splitLine, matchExercise, quickLogInput, pickKey } from './quick-log.js'
import { buildLoggedWorkout, appendLoggedWorkout } from './log-workout.js'
import { setsDone } from './history.js'

const NOW = new Date('2026-10-20T19:30:00').getTime()
const TODAY = '2026-10-20'
const profile = (over = {}) => ({ unit: 'kg', workouts: [], routines: [], customEx: [], exAliases: {}, exWeights: {}, deleted: {}, edited: {}, ...over })
const one = text => parseQuickLog(text)[0]
// The sets of one line, without the units nobody typed, for short expectations.
const sets = text => one(text).sets.map(s => Object.fromEntries(Object.entries(s).filter(([, v]) => v != null)))
const times = (n, set) => Array.from({ length: n }, () => set)

describe('reading a typed line', () => {
  it('takes the exercise name off the front, and list markers off the line', () => {
    expect(splitLine('Bench press 60x8')).toEqual({ label: 'Bench press', rest: '60x8' })
    expect(splitLine('- Squat: 100kg 5x5')).toEqual({ label: 'Squat', rest: '100kg 5x5' })
    expect(splitLine('2. Deadlift 140 x 5')).toEqual({ label: 'Deadlift', rest: '140 x 5' })
    expect(splitLine('dumbbell curls, 12 kg, 12/12/10').label).toBe('dumbbell curls')
    expect(splitLine('Dips bw x 12')).toEqual({ label: 'Dips', rest: 'bw x 12' })
  })

  it('weight x reps, one set per group, however the groups are separated', () => {
    const want = [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }, { weight: 62.5, reps: 6 }]
    expect(sets('Bench press 60x8, 60x8, 62.5x6')).toEqual(want)
    expect(sets('Bench press 60x8 60x8 62.5x6')).toEqual(want)
    expect(sets('Bench press 60 x 8 / 60 × 8 / 62.5*6')).toEqual(want)
    expect(sets('bench 60kg x 8 and 62.5kg x 6')).toEqual([{ weight: 60, unit: 'kg', reps: 8 }, { weight: 62.5, unit: 'kg', reps: 6 }])
    // two plain numbers are a weight and its reps
    expect(sets('bench 10 12, 15 12')).toEqual([{ weight: 10, reps: 12 }, { weight: 15, reps: 12 }])
  })

  it('a set count: weight x reps x sets, sets x reps @ weight, weight then sets x reps', () => {
    expect(sets('dips 50x12 x3')).toEqual(times(3, { weight: 50, reps: 12 }))
    expect(sets('squat 3x8x60')).toEqual(times(3, { weight: 60, reps: 8 }))
    expect(sets('lat pulldown 3x12 @30')).toEqual(times(3, { weight: 30, reps: 12 }))
    expect(sets('shoulder press 3 sets of 10 @ 20kg')).toEqual(times(3, { weight: 20, unit: 'kg', reps: 10 }))
    expect(sets('curl 10 reps x 3 sets at 12kg')).toEqual(times(3, { weight: 12, unit: 'kg', reps: 10 }))
    expect(sets('Squat 100kg 5x5')).toEqual(times(5, { weight: 100, unit: 'kg', reps: 5 }))
    expect(sets('leg press 120 4x12')).toEqual(times(4, { weight: 120, reps: 12 }))
    expect(sets('squat 5x5 100')).toEqual(times(5, { weight: 100, reps: 5 }))
  })

  it('a bare AxB is sets x reps when the first could be a set count, else a weight x reps', () => {
    expect(sets('Pull-ups 3x8')).toEqual(times(3, { reps: 8 }))
    expect(sets('push-ups 5x5')).toEqual(times(5, { reps: 5 }))
    expect(sets('curl 12.5x10')).toEqual([{ weight: 12.5, reps: 10 }])
    expect(sets('curl 10x12')).toEqual([{ weight: 10, reps: 12 }])
  })

  it('a weight on its own carries to the reps after it, and "@" covers the sets before it', () => {
    const curls = [{ weight: 12, unit: 'kg', reps: 12 }, { weight: 12, unit: 'kg', reps: 12 }, { weight: 12, unit: 'kg', reps: 10 }]
    expect(sets('Dumbbell curl 12 kg: 12, 12, 10')).toEqual(curls)
    expect(sets('dumbbell curls, 12 kg, 12/12/10')).toEqual(curls)
    expect(sets('bench 8, 8, 6 @ 60kg')).toEqual([{ reps: 8, weight: 60, unit: 'kg' }, { reps: 8, weight: 60, unit: 'kg' }, { weight: 60, unit: 'kg', reps: 6 }])
    // with a weight carried, two numbers are two sets of reps, not a weight and reps
    expect(sets('row 40kg, 12 10')).toEqual([{ weight: 40, unit: 'kg', reps: 12 }, { weight: 40, unit: 'kg', reps: 10 }])
  })

  it('reps alone are body-weight sets; "bw" is a load of zero', () => {
    expect(sets('crunches 20, 20, 15')).toEqual([{ reps: 20 }, { reps: 20 }, { reps: 15 }])
    expect(sets('dips bw x 12, bw x 10')).toEqual([{ weight: 0, reps: 12 }, { weight: 0, reps: 10 }])
    expect(sets('pull-ups bw 3x6')).toEqual(times(3, { weight: 0, reps: 6 }))
  })

  it('decimal commas next to a unit, an x or an @, and commas between groups everywhere else', () => {
    expect(sets('row 22,5kg x 10, 22,5x10')).toEqual([{ weight: 22.5, unit: 'kg', reps: 10 }, { weight: 22.5, reps: 10 }])
    expect(sets('incline press 2x10 @ 22,5')).toEqual(times(2, { weight: 22.5, reps: 10 }))
    expect(sets('crunches 12,12,10')).toEqual([{ reps: 12 }, { reps: 12 }, { reps: 10 }])
  })

  it('pounds stay pounds until the profile unit is known', () => {
    expect(sets('bench 135lbs x 5, 135 lb x 5')).toEqual(times(2, { weight: 135, unit: 'lb', reps: 5 }))
  })

  it('holds by seconds or minutes, cardio by minutes and distance', () => {
    expect(sets('Plank 3x60s')).toEqual(times(3, { seconds: 60 }))
    expect(sets('plank 1:30, 1:15')).toEqual([{ seconds: 90 }, { seconds: 75 }])
    expect(sets('plank 60 sec x 2')).toEqual(times(2, { seconds: 60 }))
    expect(sets('wall sit 2 min')).toEqual([{ minutes: 2 }])
    expect(sets('Treadmill 20 min 3 km')).toEqual([{ minutes: 20, distance: 3, distanceUnit: 'km' }])
    expect(sets('run 5km in 25 min')).toEqual([{ minutes: 25, distance: 5, distanceUnit: 'km' }])
  })

  it('missing reps stay missing, so the sheet can ask instead of guessing', () => {
    expect(sets('bench 60kg')).toEqual([{ weight: 60, unit: 'kg' }])
    expect(sets('ohp 40kg x 3 sets')).toEqual(times(3, { weight: 40, unit: 'kg' }))
    expect(sets('bench 3 sets')).toEqual([{}, {}, {}])
  })

  it('what it cannot read is handed back, never dropped silently', () => {
    const l = one('squat 3x5 felt heavy')
    expect(l.sets).toHaveLength(3)
    expect(l.unread).toEqual(['felt', 'heavy'])
    expect(one('stretching').sets).toEqual([])
  })

  it('one exercise per line or per ";", blank lines skipped', () => {
    const lines = parseQuickLog('Bench 60x8\n\nSquat 100 5x5; Plank 60s\n')
    expect(lines.map(l => l.label)).toEqual(['Bench', 'Squat', 'Plank'])
  })
})

describe('the exercise a name stands for', () => {
  it('a gym name gives the catalogue’s own answer, the one imports and the MCP give', () => {
    expect(matchExercise(profile(), 'dips').id).toBe('0814')
    expect(matchExercise(profile(), 'shoulder press').id).toBe('0091')
    expect(matchExercise(profile(), 'dumbbell curls').id).toBe('0294')
    expect(matchExercise(profile(), 'squat').id).toBe('0043')
  })

  it('a loose name goes to the library search: "bench" is the bench press', () => {
    expect(matchExercise(profile(), 'bench').id).toBe('0025')
    expect(matchExercise(profile(), 'pullups').id).toBe('0652')
  })

  it('an exercise the user has trained wins over the catalogue default', () => {
    const S = profile({ workouts: [{ id: 'w1', d: '2026-10-01', entries: [{ id: '0289', sets: [{ w: 30, r: 8, done: true }] }] }] })
    expect(matchExercise(S, 'bench').id).toBe('0289')
  })

  it('the user’s own names come first: an alias, a custom exercise', () => {
    expect(matchExercise(profile({ exAliases: { '0025': ['Flat bench'] } }), 'flat bench').id).toBe('0025')
    const S = profile({ customEx: [{ id: 'c1', n: 'Hammer strength row', custom: true, bp: 'back' }] })
    expect(matchExercise(S, 'hammer strength row').id).toBe('c1')
  })

  it('offers other options to switch to, and picks nothing for a name that only shares a word', () => {
    const r = matchExercise(profile(), 'dips')
    expect(r.options.length).toBeGreaterThan(0)
    expect(r.options).not.toContain(r.id)
    expect(matchExercise(profile(), 'zercher frobnicate').id).toBe(null)
  })
})

describe('typed lines as the description log-workout saves', () => {
  const input = (text, S = profile(), opts = {}) => quickLogInput(S, parseQuickLog(text), { date: TODAY, ...opts })

  it('ready when every line has an exercise and sets', () => {
    const q = input('Bench press 60x8, 60x8\nPlank 2x45s')
    expect(q.ready).toBe(true)
    expect(q.input).toMatchObject({ date: TODAY, unit: 'kg', exercises: [
      { exercise: '0025', sets: [{ reps: 8, weight: 60 }, { reps: 8, weight: 60 }] },
      { exercise: '0463', sets: [{ seconds: 45 }, { seconds: 45 }] },
    ] })
  })

  it('a weight in the other unit is converted to the profile’s', () => {
    expect(input('bench 135lbs x 5').input.exercises[0].sets).toEqual([{ reps: 5, weight: 61.2 }])
    expect(input('bench 60kg x 5', profile({ unit: 'lb' })).input.exercises[0].sets).toEqual([{ reps: 5, weight: 132.3 }])
    expect(input('bench 60 x 5', profile({ unit: 'lb' })).input.exercises[0].sets).toEqual([{ reps: 5, weight: 60 }])
  })

  it('a hold in minutes becomes seconds; cardio takes whole minutes and the profile’s distance unit', () => {
    expect(input('wall sit 2 min').input.exercises[0].sets).toEqual([{ seconds: 120 }])
    expect(input('Treadmill 20 min 3 km').input.exercises[0].sets).toEqual([{ minutes: 20, distance: 3 }])
    expect(input('Treadmill 20 min 3 km', profile({ unit: 'lb' })).input.exercises[0].sets).toEqual([{ minutes: 20, distance: 1.86 }])
  })

  it('says why a line cannot be saved yet', () => {
    const problem = text => input(text).rows[0].problem
    expect(problem('bench 60kg')).toBe('reps')
    expect(problem('treadmill 3x10')).toBe('cardio')
    expect(problem('plank 60s, 12')).toBe('mixed')
    expect(problem('stretching')).toBe('sets')
    expect(problem('zercher frobnicate 3x5')).toBe('match')
    expect(input('bench 60kg\nsquat 5x5 100').ready).toBe(false)
  })

  it('the exercise picked in the sheet replaces the matched one, and stays with its name', () => {
    const picks = { [pickKey('Bench')]: '0289' }
    const q = input('bench 60x8', profile(), { picks })
    expect(q.rows[0].id).toBe('0289')
    expect(q.input.exercises[0].exercise).toBe('0289')
    // a line added above it does not move the choice to another line
    expect(input('squat 5x5 100\nBench: 60x8', profile(), { picks }).rows.map(r => r.id)).toEqual(['0043', '0289'])
  })

  it('end to end: typed text saved as the workout Finish would have saved, PR badge included', () => {
    const S = profile()
    const q = input('Bench press 60x8, 60x8, 62.5x6\nPull-ups 3x8', S)
    const built = buildLoggedWorkout(S, q.input, { now: NOW })
    expect(built.problems).toBeUndefined()
    const done = appendLoggedWorkout(S, built, { now: NOW })
    expect(done.added).toBe(true)
    const w = S.workouts[0]
    expect(w.d).toBe(TODAY)
    expect(w.entries.map(e => e.id)).toEqual(['0025', '0652'])
    expect(w.entries[0].sets).toEqual([{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }, { w: 62.5, r: 6, done: true }])
    expect(setsDone(w)).toBe(6)
    expect(w.prs).toContain('0025')
    // the same text saved twice is one workout
    expect(appendLoggedWorkout(S, buildLoggedWorkout(S, q.input, { now: NOW }), { now: NOW })).toMatchObject({ added: false, reason: 'duplicate' })
  })
})
