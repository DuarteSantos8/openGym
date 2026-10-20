import { expect, it } from 'vitest'
import { EXDB, matchExercise, normalizeStr, searchExercises, similarExercises } from './exercises.js'

const benchPress = {
  n: 'dumbbell bench press', bp: 'chest', tg: 'pectorals', eq: 'dumbbell',
  sm: ['triceps', 'deltoids'], desc: 'Classic chest exercise using a barbell on a flat bench.',
}

it('allows one edit or adjacent transposition in long query tokens', () => {
  for (const query of ['dumbell bench', 'dumbbel bench', 'dummbell bench', 'bnech press', 'presss bench']) {
    expect(matchExercise(benchPress, query), query).toBe(true)
  }
})

it('allows one typo from four letters and two from seven, none in shorter words', () => {
  const squat = { n: 'barbell squat', bp: 'legs', eq: 'barbell' }
  for (const [exercise, query] of [[squat, 'sqat'], [squat, 'squta'], [benchPress, 'dunbell'], [benchPress, 'dumbelll prss']]) {
    expect(matchExercise(exercise, query), query).toBe(true)
  }
  for (const [exercise, query] of [[squat, 'roww'], [squat, 'sqt'], [benchPress, 'dmbll'], [benchPress, 'dumbell unrelated'], [benchPress, 'bn ech']]) {
    expect(matchExercise(exercise, query), query).toBe(false)
  }
})

it('reads gym shorthand and plurals as the catalogue words', () => {
  const rdl = { n: 'barbell romanian deadlift', bp: 'upper legs', eq: 'barbell' }
  const curl = { n: 'dumbbell hammer curl', bp: 'upper arms', eq: 'dumbbell' }
  expect(matchExercise(rdl, 'rdl')).toBe(true)
  expect(matchExercise(rdl, 'bb rdl')).toBe(true)
  expect(matchExercise(curl, 'db curls')).toBe(true)
  expect(matchExercise(curl, 'hammer curls')).toBe(true)
  expect(matchExercise(benchPress, 'db bp')).toBe(true)
})

it('keeps existing exact substring and all-token behavior', () => {
  expect(matchExercise(benchPress, 'bench pres')).toBe(true)
  expect(matchExercise(benchPress, 'press bench')).toBe(true)
  expect(matchExercise(benchPress, 'bench squat')).toBe(false)
})

// QA C26: a correctly spelled word one edit away from a body part / target / equipment word
// used to pull in that whole body part ("wrist" ~ "waist" listed every abs exercise first).
it('never fuzzy-matches body part, target, equipment or description words', () => {
  const sitUp = { n: '3/4 sit-up', bp: 'waist', tg: 'abs', eq: 'body weight', sm: [], desc: 'Keep the lower back flat.' }
  for (const query of ['wrist', 'power', 'bodz weight']) {
    expect(matchExercise(sitUp, query), query).toBe(false)
  }
  // The exact substring path still covers those fields.
  expect(matchExercise(sitUp, 'waist')).toBe(true)
  expect(matchExercise(sitUp, 'lower')).toBe(true)
})

it('searchExercises takes a word literally when it hits anything exactly, and only then falls back to typos', () => {
  const list = [
    { n: 'band wrist curl', bp: 'lower arms', eq: 'band' },
    { n: 'waist twist', bp: 'waist', eq: 'body weight' },
    { n: 'all fours squad stretch', bp: 'upper legs', eq: 'body weight' },
    { n: 'barbell squat', bp: 'upper legs', eq: 'barbell' },
    { n: 'side plank', bp: 'waist', eq: 'body weight' },
    { n: 'slide lunge', bp: 'upper legs', eq: 'body weight' },
    benchPress,
  ]
  const names = q => searchExercises(list, q).map(e => e.n)
  expect(names('wrist')).toEqual(['band wrist curl'])
  expect(names('squat')).toEqual(['barbell squat'])
  expect(names('slide')).toEqual(['slide lunge'])
  // No exact hit anywhere: the typo-tolerant path finds the exercise, name words only.
  expect(names('wirst')).toEqual(['band wrist curl'])
  expect(names('bnech press')).toEqual(['dumbbell bench press'])
  expect(names('dumbell bench')).toEqual(['dumbbell bench press'])
  expect(names('sqat')).toEqual(['barbell squat'])
  expect(searchExercises(list, '  ')).toBe(list)
})

it('searchExercises over the real catalogue returns only exact hits for correctly spelled words', () => {
  // Search now indexes steps and description too (issue #199, exercise parity), so the exact-hit
  // corpus here has to match searchExercises' own corpus or this over-counts as a false failure.
  const plain = (e, q) => normalizeStr([e.n, e.tg, e.eq, e.bp, ...(e.sm || []), e.desc || '', ...(e.st || [])].join(' ')).includes(q)
  for (const q of ['wrist', 'power', 'slide', 'thigh', 'squat', 'clean']) {
    const got = searchExercises(EXDB, q)
    expect(got.length, q).toBe(EXDB.filter(e => plain(e, q)).length)
    expect(got.every(e => plain(e, q)), q).toBe(true)
  }
  const wrist = searchExercises(EXDB, 'wrist')
  expect(wrist.map(e => e.n)).toContain('band reverse wrist curl')
})

// QA 1.3.9: "pullup" found the pull-ups while "benchpress" found nothing — words typed together
// (or hyphenated) match a name that spells them apart.
it('finds a name typed with its words run together or hyphenated', () => {
  const named = searchExercises(EXDB, 'bench press').filter(e => /bench press/.test(e.n)).map(e => e.id)
  expect(named.length).toBeGreaterThan(0)
  for (const q of ['benchpress', 'bench-press', 'Benchpress']) {
    expect(searchExercises(EXDB, q).map(e => e.id), q).toEqual(expect.arrayContaining(named))
  }
  expect(matchExercise(benchPress, 'dumbbellbenchpress')).toBe(true)
  // Only the name is run together: a body part and equipment word do not fuse into one.
  expect(matchExercise(benchPress, 'chestdumbbell')).toBe(false)
  // And the run-together form starts at a word: "deadlifthighpull" holds "thigh" mid-word.
  const highPull = { n: 'sumo deadlift high pull', bp: 'upper legs', eq: 'barbell' }
  const adductor = { n: 'inner thigh squeeze', bp: 'upper legs', eq: 'body weight' }
  expect(searchExercises([highPull, adductor], 'thigh')).toEqual([adductor])
  expect(matchExercise(highPull, 'highpull')).toBe(true)
  expect(matchExercise(highPull, 'deadlift-high')).toBe(true)
})

// v1.4.0: results come best first, and what is close but not exact is offered separately.
it('ranks the plain, common exercise first among the matches', () => {
  const first = q => searchExercises(EXDB, q)[0]?.n
  expect(first('bench press')).toBe('barbell bench press')
  expect(first('deadlift')).toBe('barbell deadlift')
  expect(first('benchpres')).toMatch(/bench press$/)
  expect(first('dumbel curl')).toMatch(/^dumbbell .*curl/)
})

it('offers similar exercises under the results, never repeating one', () => {
  const exact = searchExercises(EXDB, 'machine shoulder press')
  const close = similarExercises(EXDB, 'machine shoulder press', exact)
  expect(close.length).toBeGreaterThan(0)
  expect(close.some(e => exact.includes(e))).toBe(false)
  expect(close.every(e => /shoulder|press/.test(e.n))).toBe(true)
})

it('finds something close when nothing matches exactly', () => {
  // Heavy typos alone are still an exact hit now; one word that matches nothing is not.
  expect(searchExercises(EXDB, 'dumbbellll bicepz curlz').length).toBeGreaterThan(0)
  expect(searchExercises(EXDB, 'dumbbell curl qwxz')).toEqual([])
  const close = similarExercises(EXDB, 'dumbbell curl qwxz')
  expect(close.slice(0, 5).some(e => /dumbbell.*curl/.test(e.n))).toBe(true)
  expect(similarExercises(EXDB, '   ')).toEqual([])
})

it('puts the exercise named as typed first, typo or plural included', () => {
  const first = q => searchExercises(EXDB, q)[0]?.n
  expect(first('sqat')).toBe('squat')
  expect(first('pull ups')).toBe('pull-up')
  expect(first('push ups')).toBe('push-up')
  expect(first('burpee')).toBe('burpee')
})
