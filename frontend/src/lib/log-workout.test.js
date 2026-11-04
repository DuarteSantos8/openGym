import { describe, expect, it } from 'vitest'
import { buildLoggedWorkout, appendLoggedWorkout, previewLoggedWorkout, resolveExercise, findDuplicate } from './log-workout.js'
import { setLabel, workoutVolume, setsDone, modeOf } from './history.js'
import { exerciseHistory } from './exercise-history.js'
import { workoutFitMessages } from './fit-export.js'
import { best1RM } from './onerm.js'
import { mergeStates, stampChange } from './sync-merge.js'

// Pinned to an evening, local time, so "today" and "now" mean the same thing on every machine.
const NOW = new Date('2026-10-20T19:30:00').getTime()
const TODAY = '2026-10-20'
const clone = v => JSON.parse(JSON.stringify(v))
const profile = (over = {}) => ({ unit: 'kg', workouts: [], routines: [], customEx: [], exWeights: {}, deleted: {}, edited: {}, ...over })
const curls = (over = {}) => ({
  date: TODAY,
  exercises: [{ exercise: 'dumbbell curl', sets: [{ reps: 12, weight: 12 }, { reps: 12, weight: 12 }, { reps: 10, weight: 12 }] }],
  ...over,
})
const build = (S, input, now = NOW) => buildLoggedWorkout(S, input, { now })
const bench = (d, w, prs = []) => ({
  id: 'w' + d, d, start: new Date(d + 'T18:00:00').getTime(), end: new Date(d + 'T19:00:00').getTime(),
  routineIds: [], routineId: null, name: 'Bench', prs,
  entries: [{ id: '0025', sets: [{ w, r: 5, done: true }], topW: w, target: null }],
})

describe('what the user said becomes the workout Finish would have saved', () => {
  it('"dumbbell curls, 12 kg, 12/12/10": three rows, the catalogue curl, the volume Finish stores', () => {
    const r = build(profile(), curls())
    expect(r.problems).toBeUndefined()
    const w = r.workout
    expect(w.d).toBe(TODAY)
    expect(w.end).toBe(NOW)
    expect(w.routineId).toBe(null)
    expect(w.routineIds).toEqual([])
    expect(w.entries).toHaveLength(1)
    expect(w.entries[0].id).toBe('0294')
    expect(w.entries[0].sets).toEqual([{ w: 12, r: 12, done: true }, { w: 12, r: 12, done: true }, { w: 12, r: 10, done: true }])
    expect(w.entries[0].topW).toBe(12)
    expect(w.vol).toBe(workoutVolume(w))
    expect(w.vol).toBe(12 * 34)
    expect(setsDone(w)).toBe(3)
    // the Stats screen's (and estimate_1rm's) estimate finds the session
    expect(best1RM(profile({ workouts: [w] }), '0294')).toMatchObject({ w: 12, r: 12, d: TODAY })
  })

  it('a drawing alias id is filed under the exercise it draws, or its history would never find it', () => {
    const r = build(profile(), { date: TODAY, exercises: [{ exercise: '1019', sets: [{ reps: 5, weight: 50 }] }] })
    expect(r.workout.entries[0].id).toBe('3841')
    expect(best1RM(profile({ workouts: [r.workout] }), '3841')).not.toBe(null)
  })

  it('a name the catalogue spells twice is a question with both answers, not the first of them', () => {
    const r = build(profile(), { date: TODAY, exercises: [{ exercise: 'lever chest press', sets: [{ reps: 10, weight: 40 }] }] })
    expect(r.workout).toBeUndefined()
    expect(r.problems[0].candidates.map(c => c.id)).toEqual(['0576', '0577'])
    expect(r.problems[0].candidates[0]).toMatchObject({ name: 'lever chest press', equipment: 'leverage machine' })
  })

  it('a name nothing matches offers the closest entries instead of inventing an exercise', () => {
    const r = build(profile(), { date: TODAY, exercises: [{ exercise: 'zercher frobnicate', sets: [{ reps: 5 }] }] })
    expect(r.problems[0].problem).toMatch(/no exercise|more than one/)
  })

  it("the user's own exercise is found by name, and two of the same name ask which", () => {
    const own = { id: 'c1', n: 'Grip Trainer', custom: true, bp: 'lower arms' }
    expect(resolveExercise(profile({ customEx: [own] }), 'grip trainer')).toMatchObject({ id: 'c1', custom: true })
    const twice = profile({ customEx: [own, { ...own, id: 'c2' }] })
    expect(resolveExercise(twice, 'Grip Trainer').candidates.map(c => c.id)).toEqual(['c1', 'c2'])
  })

  it('createCustom makes the exercise, with a body part read off the name or asked for', () => {
    const made = build(profile(), { date: TODAY, exercises: [{ exercise: 'Zottman curl machine x', createCustom: true, sets: [{ reps: 8, weight: 10 }] }] })
    expect(made.customEx).toHaveLength(1)
    expect(made.customEx[0]).toMatchObject({ n: 'Zottman curl machine x', custom: true, bp: 'upper arms' })
    expect(made.workout.entries[0].id).toBe(made.customEx[0].id)
    const vague = build(profile(), { date: TODAY, exercises: [{ exercise: 'Frobnicator', createCustom: true, sets: [{ reps: 8 }] }] })
    expect(vague.problems[0].field).toBe('exercises[0].bodyPart')
    const told = build(profile(), { date: TODAY, exercises: [{ exercise: 'Frobnicator', createCustom: true, bodyPart: 'back', sets: [{ reps: 8 }] }] })
    expect(told.customEx[0].bp).toBe('back')
  })

})

describe('the numbers', () => {
  it('pounds into a kilo profile and kilos into a pound one, to the tenth the importer keeps', () => {
    expect(build(profile(), curls({ unit: 'lb', exercises: [{ exercise: '0294', sets: [{ reps: 10, weight: 25 }] }] })).workout.entries[0].sets[0].w).toBe(11.3)
    expect(build(profile({ unit: 'lb' }), curls({ unit: 'kg', exercises: [{ exercise: '0294', sets: [{ reps: 10, weight: 20 }] }] })).workout.entries[0].sets[0].w).toBe(44.1)
    expect(build(profile({ unit: 'lb' }), curls({ exercises: [{ exercise: '0294', sets: [{ reps: 10, weight: 25 }] }] })).workout.entries[0].sets[0].w).toBe(25)
  })

  it('a warm-up is logged as one and stays out of the top weight and the volume', () => {
    const w = build(profile(), { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 120, warmup: true }, { reps: 5, weight: 100 }] }] }).workout
    expect(w.entries[0].sets[0]).toMatchObject({ phase: 'warmup' })
    expect(w.entries[0].topW).toBe(100)
    expect(w.vol).toBe(500)
  })

  it('a timed hold keeps its mode on the entry, so it reads back as 1:00 and not as 0 reps', () => {
    const w = build(profile(), { date: TODAY, exercises: [{ exercise: '0463', sets: [{ seconds: 60 }] }] }).workout
    const e = w.entries[0]
    expect(e.sets[0]).toEqual({ sec: 60, w: 0, done: true })
    expect(e.target.mode).toBe('time')
    // the MCP's get_workout reads every set through a config built from the target
    expect(setLabel(e.id, e.sets[0], { ...e.target, id: e.id })).toBe('1:00')
  })

  it("a dumbbell exercise logged 'each' keeps that meaning, and its volume counts both bells", () => {
    const S = profile({ dbLoad: { '0289': { mode: 'each', _ts: 1 } } })
    const w = build(S, { date: TODAY, exercises: [{ exercise: '0289', sets: [{ reps: 10, weight: 20 }] }] }).workout
    expect(w.entries[0].target.dbLoad).toBe('each')
    expect(w.vol).toBe(400)
    expect(build(profile(), { date: TODAY, exercises: [{ exercise: '0289', sets: [{ reps: 10, weight: 20 }] }] }).workout.vol).toBe(200)
    const total = build(profile({ dbLoad: { '0289': { mode: 'total', _ts: 1 } } }), { date: TODAY, exercises: [{ exercise: '0289', sets: [{ reps: 10, weight: 40 }] }] }).workout
    expect(total.entries[0].target.dbLoad).toBe('total')
    expect(total.vol).toBe(400)
  })

  it('failure, RIR and RPE ride on the row; both scales at once, or effort on a hold, are refused', () => {
    const w = build(profile(), { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 100, rir: 2 }, { reps: 4, weight: 100, failure: true, rpe: 10 }] }] }).workout
    expect(w.entries[0].sets).toEqual([{ w: 100, r: 5, done: true, rir: 2 }, { w: 100, r: 4, done: true, failure: true, rpe: 10 }])
    expect(build(profile(), { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5, rir: 2, rpe: 8 }] }] }).problems).toBeDefined()
    expect(build(profile(), { date: TODAY, exercises: [{ exercise: '0463', sets: [{ seconds: 30, rpe: 8 }] }] }).problems).toBeDefined()
    expect(build(profile(), { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5, rpe: 3 }] }] }).problems).toBeDefined()
  })

  it('a set with nothing measured, a mix of reps and seconds, or half a rep is refused, all at once', () => {
    const r = build(profile(), {
      date: TODAY,
      exercises: [
        { exercise: '0025', sets: [{}] },
        { exercise: '0025', sets: [{ reps: 5 }, { seconds: 30 }] },
        { exercise: '0025', sets: [{ reps: 2.5 }] },
        { exercise: '0025', sets: [] },
        { exercise: '0025', sets: [{ reps: 5, weight: -5 }] },
      ],
    })
    expect(r.workout).toBeUndefined()
    expect(r.problems.map(p => p.field)).toEqual(['exercises[0].sets[0]', 'exercises[1].sets', 'exercises[2].sets[0]', 'exercises[3].sets', 'exercises[4].sets[0]'])
  })

  it('dates: not tomorrow, not 2026-02-30, not a start later than now', () => {
    expect(build(profile(), curls({ date: '2026-10-21' })).problems[0].field).toBe('date')
    expect(build(profile(), curls({ date: '2026-02-30' })).problems[0].field).toBe('date')
    expect(build(profile(), curls({ start: '21:00' })).problems[0].field).toBe('start')
    expect(build(profile(), curls({ start: '9am' })).problems[0].field).toBe('start')
  })

  it('times: today ends now; a given start and length are kept; the past gets the backfill 18:00 and hour', () => {
    const today = build(profile(), curls({ durationMin: 45 })).workout
    expect([today.start, today.end]).toEqual([NOW - 45 * 60000, NOW])
    // no length given: the backfill's hour, not a zero-minute session
    const untimed = build(profile(), curls()).workout
    expect(untimed.end - untimed.start).toBe(60 * 60000)
    const given = build(profile(), curls({ start: '17:10', durationMin: 50 })).workout
    expect(given.start).toBe(new Date('2026-10-20T17:10:00').getTime())
    expect(given.end - given.start).toBe(50 * 60000)
    const past = build(profile(), curls({ date: '2026-10-18' }))
    expect(past.past).toBe(true)
    expect(past.workout.start).toBe(new Date('2026-10-18T18:00:00').getTime())
    expect(past.workout.end - past.workout.start).toBe(60 * 60000)
  })
})

describe('the same call twice is one workout', () => {
  it('the id comes from the description, not the clock: a retry minutes later names the same workout', () => {
    const a = build(profile(), curls()).workout
    const b = build(profile(), curls(), NOW + 7 * 60000).workout
    expect(a.end).not.toBe(b.end)
    expect(b.id).toBe(a.id)
  })

  it('a retry after the first write landed adds nothing', () => {
    const S = profile()
    expect(appendLoggedWorkout(S, build(S, curls()), { now: NOW }).added).toBe(true)
    const again = appendLoggedWorkout(S, build(S, curls(), NOW + 60000), { now: NOW + 60000 })
    expect(again).toMatchObject({ added: false, reason: 'duplicate' })
    expect(S.workouts).toHaveLength(1)
  })

  it('the same sets reworded (another note) are a duplicate too, unless the caller says it is a second session', () => {
    const S = profile()
    appendLoggedWorkout(S, build(S, curls()), { now: NOW })
    const reworded = build(S, curls({ note: 'felt strong' }))
    expect(findDuplicate(S, reworded.workout)).not.toBe(null)
    expect(appendLoggedWorkout(S, reworded, { now: NOW }).added).toBe(false)
    expect(appendLoggedWorkout(S, reworded, { now: NOW, allowDuplicate: true }).added).toBe(true)
    expect(new Set(S.workouts.map(w => w.id)).size).toBe(2)
  })
})

describe('filed the way Finish files it', () => {
  it('today: a heavier top set than history is a PR, and becomes the confirmed weight', () => {
    const S = profile({ workouts: [bench('2026-10-13', 100, ['0025'])], exWeights: { '0025': { w: 100, d: '2026-10-13' } } })
    const r = appendLoggedWorkout(S, build(S, { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 3, weight: 105 }] }] }), { now: NOW })
    expect(r.workout.prs).toEqual(['0025'])
    expect(S.exWeights['0025']).toEqual({ w: 105, d: TODAY })
    expect(S._ts).toBeGreaterThanOrEqual(NOW)
  })

  it('today, assisted: less help is the better set, and a warm-up with more help moves nothing', () => {
    const S = profile({ exWeights: { 1432: { w: 25, d: '2026-10-13' } } })
    appendLoggedWorkout(S, build(S, { date: TODAY, exercises: [{ exercise: '1432', sets: [{ reps: 8, weight: 35, warmup: true }, { reps: 8, weight: 20 }, { reps: 8, weight: 22.5 }] }] }), { now: NOW })
    expect(S.exWeights['1432']).toEqual({ w: 20, d: TODAY })
  })

  it('into the past: confirmed weights stay; badges are held against the history around it', () => {
    const later = bench('2026-10-15', 100, ['0025'])
    const S = profile({ workouts: [later], exWeights: { '0025': { w: 100, d: '2026-10-15' } } })
    const r = appendLoggedWorkout(S, build(S, { date: '2026-10-10', exercises: [{ exercise: '0025', sets: [{ reps: 3, weight: 110 }] }] }), { now: NOW })
    expect(S.exWeights['0025']).toEqual({ w: 100, d: '2026-10-15' })
    expect(S.workouts.map(w => w.d)).toEqual(['2026-10-10', '2026-10-15'])
    expect(r.workout.prs).toEqual(['0025'])
    expect(r.workout._ts).toBe(NOW)
    expect(S.workouts[1].prs).toEqual([])
  })

  it('a new custom exercise is filed with the workout, once', () => {
    const S = profile()
    const built = build(S, { date: TODAY, exercises: [{ exercise: 'Frobnicator', createCustom: true, bodyPart: 'back', sets: [{ reps: 8 }] }] })
    appendLoggedWorkout(S, built, { now: NOW })
    expect(S.customEx.map(c => c.n)).toEqual(['Frobnicator'])
  })
})

describe('what a device does with it on its next sync', () => {
  it("a phone with its own unsent change keeps the logged workout, and the phone's change", () => {
    const old = bench('2026-10-13', 100)
    const server0 = profile({ workouts: [old], routines: [{ id: 'r1', name: 'Push', ex: [], _ts: 1 }], _ts: 1 })
    // the MCP's write: the server's document plus the workout
    const server1 = clone(server0)
    appendLoggedWorkout(server1, build(server1, curls()), { now: NOW })
    // the phone, offline since server0: renamed a routine and deleted last week's session
    const phone = clone(server0)
    phone.routines[0].name = 'Push day'
    phone.workouts = []
    phone._ts = stampChange(server0, phone, NOW - 60000)
    const merged = mergeStates(phone, server1)
    expect(merged.routines[0].name).toBe('Push day')
    expect(merged.workouts.map(w => w.entries[0].id)).toEqual(['0294'])
  })
})

describe('found in review', () => {
  it('a description without a unit is read in the unit the caller fixed, and its id does not depend on the profile', () => {
    const input = { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 100 }] }] }
    const kg = buildLoggedWorkout(profile(), input, { now: NOW, unit: 'kg' })
    const nowLb = buildLoggedWorkout(profile({ unit: 'lb' }), input, { now: NOW, unit: 'kg' })
    expect(nowLb.workout.entries[0].sets[0].w).toBe(220.5)
    expect(nowLb.workout.id).toBe(kg.workout.id)
    expect(build(profile({ unit: 'lb' }), input).workout.id).toBe(kg.workout.id)
  })

  it('a second session with the same sets, allowed once, is not logged a third time by a retry', () => {
    const S = profile()
    appendLoggedWorkout(S, build(S, curls({ start: '08:00', durationMin: 30 })), { now: NOW })
    const second = curls({ start: '17:00', durationMin: 30, name: 'Evening' })
    expect(appendLoggedWorkout(S, build(S, second), { now: NOW, allowDuplicate: true }).added).toBe(true)
    const retry = appendLoggedWorkout(S, build(S, second, NOW + 60000), { now: NOW + 60000, allowDuplicate: true })
    expect(retry).toMatchObject({ added: false, reason: 'duplicate' })
    expect(S.workouts).toHaveLength(2)
  })

  it("this morning's session logged after tonight's takes tonight's badge away, as a backfill does", () => {
    const evening = { ...bench(TODAY, 100, ['0025']), start: new Date(`${TODAY}T18:00:00`).getTime(), end: new Date(`${TODAY}T19:00:00`).getTime() }
    const S = profile({ workouts: [evening], exWeights: { '0025': { w: 100, d: TODAY } } })
    const r = appendLoggedWorkout(S, build(S, { date: TODAY, start: '10:00', durationMin: 60, exercises: [{ exercise: '0025', sets: [{ reps: 3, weight: 110 }] }] }), { now: NOW })
    expect(S.workouts.map(w => w.id)).toEqual([r.workout.id, evening.id])
    expect(r.workout.prs).toEqual(['0025'])
    expect(S.workouts[1].prs).toEqual([])
  })

  it('a session that would end later than now is refused, today or from yesterday', () => {
    expect(build(profile(), curls({ start: '19:00', durationMin: 120 })).problems[0].field).toBe('durationMin')
    expect(build(profile(), curls({ date: '2026-10-19', start: '23:00', durationMin: 24 * 60 })).problems[0].field).toBe('durationMin')
  })

  it("a custom exercise's muscles ride on the entry, so a device deleting it unseen leaves the sets their credit", () => {
    const own = { id: 'c1', n: 'Landmine press thing', custom: true, eq: 'custom', bp: 'chest', tg: '', desc: '' }
    const w = build(profile({ customEx: [own] }), { date: TODAY, exercises: [{ exercise: 'c1', sets: [{ reps: 8, weight: 20 }] }] }).workout
    expect(w.entries[0].muscleSnapshot).toBeTruthy()
    expect(build(profile(), { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5 }] }] }).workout.entries[0].muscleSnapshot).toBeUndefined()
  })

  it('a new custom exercise filed under cardio takes rep sets as reps, not as "0 min @ 0 km/h"', () => {
    const r = build(profile(), { date: TODAY, exercises: [{ exercise: 'Frobnicator', createCustom: true, bodyPart: 'cardio', sets: [{ reps: 8 }] }] })
    expect(r.problems).toBeUndefined()
    const e = r.workout.entries[0]
    expect(e.target.mode).toBe('reps')
    expect(setLabel(e.id, e.sets[0], e.target)).toBe('0×8')
  })
})

describe('found in review, round 2', () => {
  it("today with a start and no length is the backfill's hour, not start-until-now", () => {
    const w = build(profile(), curls({ start: '09:00' })).workout
    expect(w.end - w.start).toBe(60 * 60000)
    // and an hour that would run past now ends now
    const late = build(profile(), curls({ start: '19:00' })).workout
    expect(late.end).toBe(NOW)
  })

  it('"just did" after a session logged in the app this past hour is filed after it, as a live finish', () => {
    const app = { ...bench(TODAY, 100), id: 'w-app', start: new Date(`${TODAY}T18:00:00`).getTime(), end: new Date(`${TODAY}T19:10:00`).getTime(), entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }], topW: 100, target: null }] }
    const S = profile({ workouts: [app], exWeights: { '0294': { w: 10, d: '2026-10-13' } } })
    const built = build(S, curls())
    expect(built.workout.start).toBeGreaterThanOrEqual(app.end)
    const r = appendLoggedWorkout(S, built, { now: NOW })
    expect(S.workouts.map(w => w.id)).toEqual(['w-app', r.workout.id])
    expect(S.exWeights['0294']).toEqual({ w: 12, d: TODAY })
    expect(r.workout._ts).toBeUndefined()
  })

  it('just after midnight, the default hour does not start yesterday', () => {
    const at = new Date(`${TODAY}T00:30:00`).getTime()
    const w = buildLoggedWorkout(profile(), curls(), { now: at }).workout
    expect(w.start).toBe(new Date(`${TODAY}T00:00:00`).getTime())
    expect(w.d).toBe(TODAY)
  })

  it('a key every object has is no exercise', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const r = build(profile(), { date: TODAY, exercises: [{ exercise: name, sets: [{ reps: 8, weight: 20 }] }] })
      expect(r.workout, name).toBeUndefined()
    }
  })

  it('a name nothing is close to says so, even with suggestions', () => {
    const r = build(profile(), { date: TODAY, exercises: [{ exercise: 'zercher frobnicate', sets: [{ reps: 5 }] }] })
    expect(r.problems[0].problem).toMatch(/^no exercise in the library matches/)
  })

  it('the meaning fixed for a request wins over a default changed since', () => {
    const S = profile({ dbLoad: { '0289': { mode: 'total', _ts: 2 } } })
    const w = buildLoggedWorkout(S, { date: TODAY, exercises: [{ exercise: '0289', sets: [{ reps: 10, weight: 20 }] }] }, { now: NOW, meanings: { '0289': 'each' } }).workout
    expect(w.entries[0].target.dbLoad).toBe('each')
    expect(w.vol).toBe(400)
    const asIs = buildLoggedWorkout(S, { date: TODAY, exercises: [{ exercise: '0289', sets: [{ reps: 10, weight: 20 }] }] }, { now: NOW, meanings: { '0289': 'as' } }).workout
    expect(asIs.entries[0].target.dbLoad).toBeUndefined()
  })
})

describe('found in review, round 3', () => {
  const appSession = (start, end, w = 100, prs = []) => ({
    ...bench(TODAY, w, prs), id: 'w-app', start: new Date(`${TODAY}T${start}`).getTime(), end: new Date(`${TODAY}T${end}`).getTime(),
  })

  it('a length the caller gave is kept, even when it reaches back past the session just logged', () => {
    const S = profile({ workouts: [appSession('18:00:00', '19:10:00')] })
    const r = build(S, curls({ durationMin: 60 }))
    expect(r.problems).toBeUndefined()
    expect(r.workout.end - r.workout.start).toBe(60 * 60000)
  })

  it('a given length that would start yesterday is a question, not a shorter session', () => {
    const r = buildLoggedWorkout(profile(), curls({ durationMin: 90 }), { now: new Date(`${TODAY}T00:30:00`).getTime() })
    expect(r.problems[0].field).toBe('durationMin')
  })

  it('a "just did" seconds after the app session lasts the five-minute floor and is filed after it, as a live finish', () => {
    for (const [from, to] of [['18:00:00', '19:29:55'], ['18:50:00', '19:27:00']]) {
      const S = profile({ workouts: [appSession(from, to)] })
      const built = build(S, curls())
      expect(built.workout.end - built.workout.start, from).toBe(5 * 60000)
      const r = appendLoggedWorkout(S, built, { now: NOW })
      expect(S.workouts.map(w => w.id), from).toEqual(['w-app', r.workout.id])
      expect(r.workout._ts, from).toBeUndefined()
      expect(S.exWeights['0294'], from).toEqual({ w: 12, d: TODAY })
    }
  })

  it("a session on file newer than now (another device's clock ahead) is not jumped: badges are rebuilt", () => {
    const ahead = appSession('19:32:00', '19:35:00', 100, ['0025'])
    const S = profile({ workouts: [ahead] })
    const built = build(S, { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 3, weight: 110 }] }] })
    expect(built.workout.end - built.workout.start).toBe(5 * 60000)
    const r = appendLoggedWorkout(S, built, { now: NOW })
    expect(S.workouts.map(w => w.id)).toEqual([r.workout.id, 'w-app'])
    expect(r.workout.prs).toEqual(['0025'])
    expect(S.workouts[1].prs).toEqual([])
  })
})

const walk = (sets, over = {}) => ({ date: TODAY, exercises: [{ exercise: 'treadmill walk', sets }], ...over })
const row0 = r => r.workout.entries[0].sets[0]

describe('cardio: minutes at a speed, the row the app stores', () => {
  it('"20 min treadmill walk at 5.6 km/h, incline 7": one native cardio row, no volume, no badge', () => {
    const r = build(profile(), walk([{ minutes: 20, speed: 5.6, incline: 7 }]))
    expect(r.problems).toBeUndefined()
    const e = r.workout.entries[0]
    expect(e.id).toBe('3666')
    expect(e.sets).toEqual([{ min: 20, speed: 5.6, incline: 7, done: true }])
    expect(e.target).toEqual({ id: '3666', mode: 'cardio' })
    expect(modeOf(e.target)).toBe('cardio')
    expect(setLabel(e.id, e.sets[0], e.target, 'kmh')).toBe('20 min @ 5.6 km/h · 7% incline')
    expect(r.workout.vol).toBe(0)
    expect(r.resolved[0].mode).toBe('cardio')
    const S = profile()
    const added = appendLoggedWorkout(S, r, { now: NOW })
    expect(added.workout.prs).toEqual([])
    expect(S.exWeights).toEqual({})
    const h = exerciseHistory(S, '3666')
    expect(h.metric).toBe('min')
  })

  it('mph into the km/h the app stores; a pound profile that never chose reads mph, a kilo one km/h', () => {
    expect(row0(build(profile(), walk([{ minutes: 20, speed: 3.5 }], { speedUnit: 'mph' }))).speed).toBe(5.63)
    expect(row0(build(profile({ unit: 'lb' }), walk([{ minutes: 20, speed: 3.5 }]))).speed).toBe(5.63)
    expect(row0(build(profile(), walk([{ minutes: 20, speed: 5.6 }]))).speed).toBe(5.6)
    expect(row0(build(profile({ unit: 'lb', speedUnit: 'kmh' }), walk([{ minutes: 20, speed: 5.6 }]))).speed).toBe(5.6)
    // The caller's frozen unit (the first read) wins over the profile as it is now.
    expect(row0(buildLoggedWorkout(profile({ unit: 'lb' }), walk([{ minutes: 20, speed: 5.6 }]), { now: NOW, speedUnit: 'kmh' })).speed).toBe(5.6)
    // A weight unit in the description says nothing about the speed's.
    expect(row0(build(profile({ unit: 'lb' }), walk([{ minutes: 20, speed: 3.5 }], { unit: 'kg' }))).speed).toBe(5.63)
    expect(build(profile(), walk([{ minutes: 20, speed: 3 }], { speedUnit: 'knots' })).problems[0].field).toBe('speedUnit')
  })

  it('a distance instead of a speed becomes the average speed; both at once is a question', () => {
    expect(row0(build(profile(), walk([{ minutes: 30, distance: 2.5 }]))).speed).toBe(5)
    expect(row0(build(profile(), walk([{ minutes: 30, distance: 1.5 }], { speedUnit: 'mph' }))).speed).toBe(4.83)
    expect(build(profile(), walk([{ minutes: 30, distance: 2.5, speed: 5 }])).problems[0].problem).toMatch(/not both/)
    expect(build(profile(), walk([{ minutes: 30, distance: 0 }])).problems[0].problem).toMatch(/distance/)
  })

  it('minutes are required and whole; no speed is stored as 0; a bike-beating speed is a unit mix-up', () => {
    expect(row0(build(profile(), walk([{ minutes: 20 }])))).toEqual({ min: 20, speed: 0, done: true })
    for (const minutes of [0, 361, 12.5]) expect(build(profile(), walk([{ minutes }])).problems[0].problem).toMatch(/minutes/)
    expect(build(profile(), walk([{ speed: 5, incline: 3 }])).problems[0].problem).toMatch(/minutes/)
    expect(build(profile(), walk([{ minutes: 20, speed: 61 }])).problems[0].problem).toMatch(/60 km\/h/)
    expect(build(profile(), walk([{ minutes: 20, speed: 38 }], { speedUnit: 'mph' })).problems[0].problem).toMatch(/60 km\/h/)
  })

  it('the grade lands on the half percent, flat leaves no key, and a bike has none', () => {
    expect(row0(build(profile(), walk([{ minutes: 20, speed: 5, incline: 7.3 }]))).incline).toBe(7.5)
    expect(row0(build(profile(), walk([{ minutes: 20, speed: 5, incline: 0 }])))).toEqual({ min: 20, speed: 5, done: true })
    expect(build(profile(), walk([{ minutes: 20, speed: 5, incline: 41 }])).problems[0].problem).toMatch(/incline/)
    const bike = build(profile(), { date: TODAY, exercises: [{ exercise: 'stationary bike', sets: [{ minutes: 30, speed: 25, incline: 3 }] }] })
    expect(bike.problems[0].problem).toMatch(/no incline/)
    expect(build(profile(), { date: TODAY, exercises: [{ exercise: 'stationary bike', sets: [{ minutes: 30, speed: 25 }] }] }).problems).toBeUndefined()
    const own = { id: 'c9', n: 'Hill path', custom: true, eq: 'custom', bp: 'cardio', tg: 'cardiovascular system', desc: '' }
    expect(row0(build(profile({ customEx: [own] }), { date: TODAY, exercises: [{ exercise: 'c9', sets: [{ minutes: 40, speed: 5, incline: 8 }] }] })).incline).toBe(8)
  })

  it('RPE rides on a cardio set; weight, RIR, failure and a warm-up do not, all reported at once', () => {
    expect(row0(build(profile(), walk([{ minutes: 20, speed: 5, rpe: 7 }]))).rpe).toBe(7)
    const r = build(profile(), walk([{ minutes: 20, weight: 10 }, { minutes: 20, rir: 2 }, { minutes: 20, failure: true }, { minutes: 20, warmup: true }]))
    expect(r.problems.map(p => p.field)).toEqual(['exercises[0].sets[0]', 'exercises[0].sets[1]', 'exercises[0].sets[2]', 'exercises[0].sets[3]'])
    expect(build(profile(), walk([{ minutes: 20, weight: 0 }])).problems).toBeUndefined()
  })

  it('minutes do not mix with reps or seconds in one exercise', () => {
    expect(build(profile(), walk([{ minutes: 20 }, { reps: 10 }])).problems[0].problem).toMatch(/not a mix/)
    expect(build(profile(), walk([{ minutes: 20 }, { seconds: 60 }])).problems[0].problem).toMatch(/not a mix/)
  })

  it('a cardio exercise counted in reps or seconds says so on its target, the profile\'s own included', () => {
    const reps = build(profile(), walk([{ reps: 30 }])).workout.entries[0]
    expect(reps.target).toEqual({ id: '3666', mode: 'reps' })
    expect(setLabel(reps.id, reps.sets[0], reps.target)).toBe('0×30')
    const secs = build(profile(), walk([{ seconds: 90 }])).workout.entries[0]
    expect(secs.target.mode).toBe('time')
    const own = { id: 'c8', n: 'Skipping', custom: true, eq: 'custom', bp: 'cardio', tg: 'cardiovascular system', desc: '' }
    const e = build(profile({ customEx: [own] }), { date: TODAY, exercises: [{ exercise: 'c8', sets: [{ reps: 100 }] }] }).workout.entries[0]
    expect(e.target.mode).toBe('reps')
    // A lift stays exactly as it was stored before cardio could be logged.
    expect(build(profile(), curls()).workout.entries[0].target.mode).toBeUndefined()
  })

  it('a mixed session: the lift earns its badge and confirmed weight, the walk nothing, volume is the lift\'s', () => {
    const S = profile()
    const r = build(S, { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 100 }] }, { exercise: '3666', sets: [{ minutes: 20, speed: 5 }] }] })
    expect(r.workout.vol).toBe(500)
    const added = appendLoggedWorkout(S, r, { now: NOW })
    expect(added.workout.prs).toEqual(['0025'])
    expect(Object.keys(S.exWeights)).toEqual(['0025'])
  })

  it('the same walk twice is one workout; another speed, grade or unit is another request', () => {
    const a = build(profile(), walk([{ minutes: 20, speed: 5, incline: 7 }])).workout.id
    expect(build(profile(), walk([{ minutes: 20, speed: 5, incline: 7 }])).workout.id).toBe(a)
    expect(build(profile(), walk([{ minutes: 20, speed: 5.5, incline: 7 }])).workout.id).not.toBe(a)
    expect(build(profile(), walk([{ minutes: 20, speed: 5, incline: 8 }])).workout.id).not.toBe(a)
    expect(build(profile(), walk([{ minutes: 20, speed: 5, incline: 7 }], { speedUnit: 'mph' })).workout.id).not.toBe(a)
    // A lifting description keeps the id it had before cardio existed: a retry across versions.
    expect(build(profile(), curls()).workout.id).toBe('mwe0qrmj72ea')
  })
})

describe('a dry run shows the badges the save will give', () => {
  it('today: a heavier bench is a PR in the preview and in the filed workout, and S is untouched', () => {
    const S = profile({ workouts: [bench('2026-10-13', 90, ['0025'])] })
    const before = clone(S)
    const r = build(S, { date: TODAY, exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 100 }] }] })
    expect(r.workout.prs).toEqual([])
    const preview = previewLoggedWorkout(S, r, { now: NOW }).workout
    expect(preview.prs).toEqual(['0025'])
    expect(S).toEqual(before)
    expect(appendLoggedWorkout(S, r, { now: NOW }).workout.prs).toEqual(preview.prs)
  })

  it('a backfill: the preview holds badges against the history around it, as the save does', () => {
    const S = profile({ workouts: [bench('2026-10-13', 90, ['0025']), bench('2026-10-18', 95, ['0025'])] })
    const r = build(S, { date: '2026-10-15', exercises: [{ exercise: '0025', sets: [{ reps: 5, weight: 92.5 }] }] })
    const preview = previewLoggedWorkout(S, r, { now: NOW }).workout
    const saved = appendLoggedWorkout(clone(S), r, { now: NOW }).workout
    expect(preview.prs).toEqual(saved.prs)
    expect(preview.prs).toEqual(['0025'])
  })
})

describe('found in review, cardio round 1', () => {
  it('a session holds its cardio: a 120-minute walk with no length is not filed in the default hour', () => {
    const past = build(profile(), { date: '2026-10-18', exercises: [{ exercise: '3666', sets: [{ minutes: 120, speed: 5 }] }] }).workout
    expect(past.end - past.start).toBe(120 * 60000)
    const now = build(profile(), walk([{ minutes: 90, speed: 5 }])).workout
    expect([now.end, now.end - now.start]).toEqual([NOW, 90 * 60000])
    const started = build(profile(), walk([{ minutes: 75, speed: 5 }], { date: '2026-10-18', start: '07:00' })).workout
    expect(started.end - started.start).toBe(75 * 60000)
  })

  it('a walk just after a session reaches back over its end rather than fit 20 minutes into 5', () => {
    const S = profile({ workouts: [{ ...bench(TODAY, 80), start: NOW - 65 * 60000, end: NOW - 5 * 60000 }] })
    const w = build(S, walk([{ minutes: 20, speed: 5 }])).workout
    expect(w.end - w.start).toBe(20 * 60000)
  })

  it('a length shorter than its cardio, or a start that leaves no room for it before now, is a question', () => {
    expect(build(profile(), walk([{ minutes: 20, speed: 5 }], { durationMin: 15 })).problems[0]).toMatchObject({ field: 'durationMin' })
    expect(build(profile(), walk([{ minutes: 20, speed: 5 }], { start: '19:20' })).problems[0]).toMatchObject({ field: 'start' })
    expect(build(profile(), walk([{ minutes: 20, speed: 5 }], { start: '19:00' })).problems).toBeUndefined()
    const night = build(profile(), walk([{ minutes: 360 }, { minutes: 360 }, { minutes: 360 }, { minutes: 360 }, { minutes: 360 }])).problems
    expect(night[0].problem).toMatch(/timed minutes/)
  })

  it('minutes on an exercise that is not cardio are refused, as the config sheet offers no cardio there', () => {
    const r = build(profile(), { date: TODAY, exercises: [{ exercise: '0025', sets: [{ minutes: 20 }] }] })
    expect(r.problems[0]).toMatchObject({ field: 'exercises[0].sets' })
    expect(r.problems[0].problem).toMatch(/not a cardio exercise/)
  })

  it('a missing set among cardio sets is a problem, not a crash', () => {
    const r = build(profile(), walk([{ minutes: 20, speed: 5 }, null]))
    expect(r.problems[0]).toMatchObject({ field: 'exercises[0].sets[1]' })
  })
})

describe('found in review, cardio round 2', () => {
  it('holds count too: an hour on the treadmill and five 1-minute planks is a 65-minute session', () => {
    const input = { date: '2026-10-18', exercises: [{ exercise: '3666', sets: [{ minutes: 60, speed: 5 }] }, { exercise: '0463', sets: Array.from({ length: 5 }, () => ({ seconds: 60 })) }] }
    const w = build(profile(), input).workout
    expect(w.end - w.start).toBe(65 * 60000)
    expect(build(profile(), { ...input, durationMin: 60 }).problems[0]).toMatchObject({ field: 'durationMin' })
  })

  it('reaching back to fit the cardio never crosses the start of the session it followed', () => {
    const S = profile({ workouts: [{ ...bench(TODAY, 80), start: NOW - 55 * 60000, end: NOW - 45 * 60000 }] })
    const r = build(S, { date: TODAY, exercises: [{ exercise: 'stationary bike', sets: [{ minutes: 60, speed: 25 }] }] })
    expect(r.problems[0]).toMatchObject({ field: 'start' })
    // 50 minutes still begin after that session began: filed after it, overlapping its end.
    const w = build(S, { date: TODAY, exercises: [{ exercise: 'stationary bike', sets: [{ minutes: 50, speed: 25 }] }] }).workout
    expect(w.start).toBe(NOW - 50 * 60000)
  })
})

describe('found in review, cardio round 3', () => {
  // The active set lengths the FIT export writes (set messages, active ones), in seconds.
  const fitActive = w => workoutFitMessages(w)
    .filter(m => m.global === 225 && m.fields.find(f => f[0] === 5)[2] === 1)
    .map(m => Math.round(m.fields.find(f => f[0] === 0)[2] / 1000))

  it('an hour on the treadmill beside ten bench sets keeps its hour in the FIT export', () => {
    const w = build(profile(), { date: '2026-10-18', exercises: [
      { exercise: '3666', sets: [{ minutes: 60, speed: 5 }] },
      { exercise: '0025', sets: Array.from({ length: 10 }, () => ({ reps: 10, weight: 50 })) },
    ] }).workout
    expect(w.end - w.start).toBe(65 * 60000)
    expect(fitActive(w)[0]).toBe(3600)
    // A lifting session is filed in the hour it always was.
    const lift = build(profile(), { date: '2026-10-18', exercises: [{ exercise: '0025', sets: Array.from({ length: 30 }, () => ({ reps: 10, weight: 50 })) }] }).workout
    expect(lift.end - lift.start).toBe(60 * 60000)
  })

  it('a length that holds the timed work exactly is accepted, fractions and all', () => {
    expect(build(profile(), { date: '2026-10-18', durationMin: 20.5, exercises: [
      { exercise: '3666', sets: [{ minutes: 20, speed: 5 }] }, { exercise: '0463', sets: [{ seconds: 30 }] },
    ] }).problems).toBeUndefined()
    expect(build(profile(), { date: '2026-10-18', durationMin: 1.5, exercises: [{ exercise: '0463', sets: [{ seconds: 90 }] }] }).problems).toBeUndefined()
    expect(build(profile(), { date: '2026-10-18', durationMin: 1.4, exercises: [{ exercise: '0463', sets: [{ seconds: 90 }] }] }).problems[0].problem).toMatch(/1\.5 timed minutes/)
  })
})

describe('found in review, cardio round 3: the preview of a duplicate', () => {
  it('a repeated request previews as described, with what it repeats, not the copy edited since', () => {
    const S = profile()
    const r = build(S, curls())
    appendLoggedWorkout(S, r, { now: NOW })
    S.workouts[0].entries[0].sets[0].w = 99
    const p = previewLoggedWorkout(S, r, { now: NOW })
    expect(p.duplicateOf).toBe(r.workout.id)
    expect(p.workout.entries[0].sets[0].w).toBe(12)
    // The same sets as a second session the caller vouches for: previewed as filed, no duplicate.
    S.workouts[0].entries[0].sets[0].w = 12
    const again = build(S, curls({ name: 'Evening' }))
    expect(previewLoggedWorkout(S, again, { now: NOW }).duplicateOf).toBeDefined()
    expect(previewLoggedWorkout(S, again, { now: NOW, allowDuplicate: true }).duplicateOf).toBeUndefined()
  })
})

describe('found in review, cardio round 4: a given start or length keeps the walk its hour', () => {
  const fitActive = w => workoutFitMessages(w)
    .filter(m => m.global === 225 && m.fields.find(f => f[0] === 5)[2] === 1)
    .map(m => Math.round(m.fields.find(f => f[0] === 0)[2] / 1000))
  const mixed = over => ({ date: TODAY, exercises: [
    { exercise: '3666', sets: [{ minutes: 60, speed: 5 }] },
    { exercise: '0025', sets: Array.from({ length: 10 }, () => ({ reps: 10, weight: 50 })) },
  ], ...over })

  it('a start an hour ago, or a length of an hour: the rep sets give way, not the logged walk', () => {
    for (const over of [{ start: '18:30' }, { durationMin: 60 }]) {
      const r = build(profile(), mixed(over))
      expect(r.problems).toBeUndefined()
      const secs = fitActive(r.workout)
      expect(secs[0]).toBe(3600)
      expect(secs.slice(1).every(s => s >= 1 && s < 30)).toBe(true)
    }
  })

  it('with two minutes to spare beside the walk, the ten rep sets share them: 12 s each', () => {
    const secs = fitActive(build(profile(), mixed({ durationMin: 62 })).workout)
    expect(secs).toEqual([3600, ...Array(10).fill(12)])
  })

  it('a reach-back needs the exact timed minutes, not a whole minute more', () => {
    const S = profile({ workouts: [{ ...bench(TODAY, 80), start: NOW - 20.8 * 60000, end: NOW - 20.7 * 60000 }] })
    const r = build(S, { date: TODAY, exercises: [{ exercise: '3666', sets: [{ minutes: 20, speed: 5 }] }, { exercise: '0463', sets: [{ seconds: 30 }] }] })
    expect(r.problems).toBeUndefined()
    expect(r.workout.start).toBeGreaterThan(NOW - 20.8 * 60000)
  })

  it('timed work that overruns the session on its own still shrinks alike, as before', () => {
    const w = { id: 'x', d: TODAY, start: NOW - 30 * 60000, end: NOW, name: 'W', routineIds: [], prs: [],
      entries: [{ id: '3666', target: { id: '3666', mode: 'cardio' }, sets: [{ min: 60, speed: 5, done: true }] },
        { id: '0025', target: { id: '0025' }, sets: [{ w: 50, r: 10, done: true }] }] }
    const secs = fitActive(w)
    expect(secs[0] + secs[1]).toBeLessThanOrEqual(1800)
    expect(Math.abs(secs[0] / secs[1] - 3600 / 30)).toBeLessThan(5)
  })
})

describe('found in review, cardio round 4: the rep-set guess never refuses a session', () => {
  const walkAndLift = (mins, lift = '0652') => ({ date: TODAY, exercises: [
    { exercise: '3666', sets: [{ minutes: mins, speed: 5 }] },
    { exercise: lift, sets: [{ reps: 8 }, { reps: 8 }, { reps: 8 }] },
  ] })

  it('a 30-minute walk and pull-ups after a session that began 31 minutes ago: filed after it', () => {
    const S = profile({ workouts: [{ ...bench(TODAY, 80), start: NOW - 31 * 60000, end: NOW - 25 * 60000 }] })
    const r = build(S, walkAndLift(30))
    expect(r.problems).toBeUndefined()
    expect(r.workout.start).toBe(NOW - 30 * 60000)
  })

  it('a 15-minute walk and bench sets at 00:19: today, not "began yesterday"', () => {
    const early = new Date(TODAY + 'T00:19:00').getTime()
    const r = build(profile(), walkAndLift(15, '0025'), early)
    expect(r.problems).toBeUndefined()
    expect(r.workout.start).toBeGreaterThanOrEqual(new Date(TODAY + 'T00:00:00').getTime())
    expect(r.workout.end - r.workout.start).toBeGreaterThanOrEqual(15 * 60000)
  })

  it('when the timed minutes themselves do not fit, it is still a question', () => {
    const S = profile({ workouts: [{ ...bench(TODAY, 80), start: NOW - 29 * 60000, end: NOW - 25 * 60000 }] })
    expect(build(S, walkAndLift(30)).problems[0]).toMatchObject({ field: 'start' })
  })
})

