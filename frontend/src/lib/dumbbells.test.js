// What a dumbbell weight means (issue #474): as entered by default, counted once exactly as every
// set before the setting was; per bell (both bells counted, one-arm work once) or both together
// when an exercise says so; stamped on the session it was logged in; compared like with like.
import { describe, expect, it } from 'vitest'
import {
  dbLoadOf, dbLoadFor, withDbLoad, isBellEx, isOneArm, bellsIn, entryDbLoad, volumeFactor,
  meaningFactor, entryAs, historyAs, currentDbLoad, withMeaning,
} from './dumbbells.js'
import { workoutVolume, setLabel, bestWeightFor as canonicalBestWeightFor, freestyleConfig } from './history.js'
import { best1RM as canonicalBest1RM, is1RMRecord as canonicalIs1RMRecord, e1rmSeries as canonicalE1rmSeries } from './onerm.js'
import { exerciseHistory as canonicalExerciseHistory, bestSetFor as canonicalBestSetFor } from './exercise-history.js'
import { migratedFixture, startMigratedFixture } from './test-fixtures.js'
import { mergeStates, stampChange } from './sync-merge.js'
import { buildPlanBundle as canonicalBuildPlanBundle, parsePlan } from './plan-share.js'
import { EXIDX } from './exercises.js'

const BENCH = '0289'     // dumbbell bench press: two bells
const ROW = '0292'       // dumbbell one arm bent-over row: one bell
const CURL = '0294'      // dumbbell biceps curl
const KB = '0517'        // a kettlebell exercise
const SQUAT = '0043'     // barbell

const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const entry = (id, sets, target = {}) => ({ id, sets, target: { sets: sets.length, reps: 8, mode: 'reps', ...target } })
const workout = (d, entries, extra = {}) => ({ id: 'w' + d, d, start: new Date(d + 'T10:00:00').getTime(), entries, ...extra })
const state = (workouts = [], extra = {}) => ({ unit: 'kg', workouts, routines: [], exWeights: {}, ...extra })

describe('the exercises this file assumes', () => {
  it('are what the tests below need', () => {
    expect(EXIDX[BENCH].eq).toBe('dumbbell')
    expect(EXIDX[ROW].eq).toBe('dumbbell')
    expect(EXIDX[ROW].n).toMatch(/one arm/)
    expect(EXIDX[CURL].eq).toBe('dumbbell')
    expect(EXIDX[KB].eq).toBe('kettlebell')
    expect(EXIDX[SQUAT].eq).toBe('barbell')
  })
})

describe('the setting', () => {
  it('is offered for dumbbells and kettlebells only', () => {
    expect(isBellEx(BENCH)).toBe(true)
    expect(isBellEx(KB)).toBe(true)
    expect(isBellEx(SQUAT)).toBe(false)
  })

  it('reads as entered unless a routine slot or the exercise says otherwise', () => {
    expect(dbLoadFor(state(), BENCH)).toBe('as')
    const S = state([], { dbLoad: withDbLoad({}, BENCH, 'each', 5) })
    expect(S.dbLoad[BENCH]).toEqual({ mode: 'each', _ts: 5 })
    expect(dbLoadFor(S, BENCH)).toBe('each')
    // The routine's own choice wins over the exercise's default, an explicit "as entered" too.
    expect(dbLoadFor(S, { id: BENCH, dbLoad: 'total' })).toBe('total')
    expect(dbLoadFor(S, { id: BENCH, dbLoad: 'as' })).toBe('as')
    // Junk reads as nothing.
    expect(dbLoadOf('both')).toBe(null)
    expect(dbLoadFor({ dbLoad: { [BENCH]: { mode: 'x' } } }, BENCH)).toBe('as')
  })

  it('goes back to as entered as a stamped null, so it wins a sync', () => {
    const map = withDbLoad(withDbLoad({}, BENCH, 'each', 1), BENCH, 'as', 2)
    expect(map[BENCH]).toEqual({ mode: null, _ts: 2 })
    expect(dbLoadFor({ dbLoad: map }, BENCH)).toBe('as')
  })

  it('knows one-arm work holds one bell', () => {
    expect(isOneArm({ id: ROW })).toBe(true)
    expect(isOneArm({ id: BENCH })).toBe(false)
    expect(isOneArm({ id: CURL, side: true })).toBe(true)
    expect(bellsIn({ id: BENCH })).toBe(2)
    expect(bellsIn({ id: ROW })).toBe(1)
  })
})

describe('volume', () => {
  it('counts every set saved before the setting existed exactly as before', () => {
    const w = workout('2026-10-01', [entry(BENCH, [set(20, 10), set(20, 8)])])
    expect(entryDbLoad(w.entries[0])).toBe('as')
    expect(workoutVolume(w)).toBe(360)
  })

  it('counts both bells for a per-bell entry, once for both-together', () => {
    const each = workout('2026-10-01', [entry(BENCH, [set(20, 10)], { dbLoad: 'each' })])
    const total = workout('2026-10-01', [entry(BENCH, [set(40, 10)], { dbLoad: 'total' })])
    expect(volumeFactor(each.entries[0])).toBe(2)
    expect(workoutVolume(each)).toBe(400)
    expect(workoutVolume(total)).toBe(400)
  })

  it('counts a one-arm exercise once, per bell or not', () => {
    const row = workout('2026-10-01', [entry(ROW, [set(30, 10)], { dbLoad: 'each' })])
    expect(workoutVolume(row)).toBe(300)
  })

  it('doubles the drops of a per-bell drop-set too, and leaves warm-ups out', () => {
    const w = workout('2026-10-01', [entry(BENCH, [
      set(10, 10, { phase: 'warmup', warmup: true }),
      set(20, 8, { type: 'dropset', drops: [{ w: 16, r: 5 }] }),
    ], { dbLoad: 'each' })])
    expect(workoutVolume(w)).toBe((20 * 8 + 16 * 5) * 2)
  })

  it('reaches the exercise history sheet', () => {
    const S = state([workout('2026-10-01', [entry(BENCH, [set(20, 10)], { dbLoad: 'each' })])])
    expect(exerciseHistory(S, BENCH).sessions[0].volume).toBe(400)
  })
})

describe('the set label', () => {
  it('says what the number means when the exercise said', () => {
    expect(setLabel(BENCH, set(20, 8), { id: BENCH, mode: 'reps', dbLoad: 'each' })).toBe('20 each × 8')
    expect(setLabel(BENCH, set(40, 8), { id: BENCH, mode: 'reps', dbLoad: 'total' })).toBe('40 total × 8')
  })

  it('reads as always as entered, and for one-arm work', () => {
    expect(setLabel(BENCH, set(20, 8), { id: BENCH, mode: 'reps' })).toBe('20×8')
    expect(setLabel(ROW, set(30, 8), { id: ROW, mode: 'reps', dbLoad: 'each' })).toBe('30×8')
  })
})

describe('like with like', () => {
  it('converts only between the two explicit meanings', () => {
    expect(meaningFactor('total', 'each', { id: BENCH })).toBe(0.5)
    expect(meaningFactor('each', 'total', { id: BENCH })).toBe(2)
    expect(meaningFactor('as', 'each', { id: BENCH })).toBe(1)
    expect(meaningFactor('each', 'as', { id: BENCH })).toBe(1)
    expect(meaningFactor('total', 'each', { id: ROW })).toBe(1)
  })

  it('reads an entry in another meaning as a copy, weights, sides and drops included', () => {
    const e = entry(BENCH, [set(40, 8, { type: 'dropset', drops: [{ w: 30, r: 4 }] })], { dbLoad: 'total' })
    e.topW = 40
    const as = entryAs(e, 'each')
    expect(as).not.toBe(e)
    expect(as.sets[0].w).toBe(20)
    expect(as.sets[0].drops[0].w).toBe(15)
    expect(as.topW).toBe(20)
    expect(as.target.dbLoad).toBe('each')
    // The stored entry is untouched.
    expect(e.sets[0].w).toBe(40)
    expect(entryAs(e, 'total')).toBe(e)
  })

  it('leaves the state alone when nothing converts', () => {
    const S = state([workout('2026-10-01', [entry(BENCH, [set(20, 8)])])])
    expect(historyAs(S, BENCH, 'each')).toBe(S)
    expect(historyAs(S, BENCH, 'as')).toBe(S)
  })

  it('judges records in the session\'s meaning', () => {
    // 40 kg total last week is 20 a hand. 22 each beats it; read raw, it would look 18 kg short.
    const S = state([workout('2026-10-01', [entry(BENCH, [set(40, 8)], { dbLoad: 'total' })])])
    expect(bestWeightFor(S, BENCH)).toBe(40)
    expect(bestWeightFor(S, BENCH, 'each')).toBe(20)
    const today = entry(BENCH, [set(22, 8)], { dbLoad: 'each' })
    expect(is1RMRecord(S, BENCH, today)).not.toBe(null)
    expect(best1RM(S, BENCH, 'epley', 'each').w).toBe(20)
  })

  it('draws one curve across a switch, in the exercise\'s current meaning', () => {
    const S = state([
      workout('2026-10-01', [entry(BENCH, [set(40, 1)], { dbLoad: 'total' })]),
      workout('2026-10-08', [entry(BENCH, [set(22, 1)], { dbLoad: 'each' })]),
    ])
    expect(currentDbLoad(S, BENCH)).toBe('each')
    expect(e1rmSeries(S, BENCH).map(p => p.y)).toEqual([20, 22])
    expect(exerciseHistory(S, BENCH).best).toBe(22)
    expect(bestSetFor(S, BENCH, 'reps', 'each').set.w).toBe(22)
  })

  it('never converts sets logged as entered', () => {
    const S = state([
      workout('2026-10-01', [entry(BENCH, [set(40, 1)])]),
      workout('2026-10-08', [entry(BENCH, [set(22, 1)], { dbLoad: 'each' })]),
    ])
    expect(e1rmSeries(S, BENCH).map(p => p.y)).toEqual([40, 22])
  })
})

describe('a session', () => {
  it('stamps the meaning it is logged in, and only when there is one', () => {
    const plain = buildPlannedEntry(state(), { id: BENCH, sets: 2, reps: 8, weight: 20, mode: 'reps' }, null)
    expect(plain.target.dbLoad).toBeUndefined()
    const S = state([], { dbLoad: withDbLoad({}, BENCH, 'each', 1) })
    expect(buildPlannedEntry(S, { id: BENCH, sets: 2, reps: 8, weight: 20, mode: 'reps' }, null).target.dbLoad).toBe('each')
    expect(withMeaning(S, { sets: 2 }, BENCH)).toEqual({ sets: 2, dbLoad: 'each' })
    expect(withMeaning(state(), { sets: 2 }, BENCH)).toEqual({ sets: 2 })
  })

  it('starts from last time read in today\'s meaning after a switch', () => {
    // Logged as 40 total; the slot now logs per bell. Linear progression adds a step to 20 each,
    // not to 40 a hand.
    const S = state([workout('2026-10-01', [entry(BENCH, [set(40, 8), set(40, 8)], { dbLoad: 'total', reps: 8, sets: 2 })])])
    const built = buildPlannedEntry(S, { id: BENCH, sets: 2, reps: 8, weight: 0, mode: 'reps', dbLoad: 'each', inc: 2 }, null)
    expect(built.sets.map(s => s.w)).toEqual([22, 22])
    expect(built.target.dbLoad).toBe('each')
  })

  it('keeps today\'s numbers for an exercise that never chose', () => {
    const S = state([workout('2026-10-01', [entry(BENCH, [set(40, 8), set(40, 8)], { reps: 8, sets: 2 })])])
    const built = buildPlannedEntry(S, { id: BENCH, sets: 2, reps: 8, weight: 0, mode: 'reps', inc: 2 }, null)
    expect(built.sets.map(s => s.w)).toEqual([42, 42])
  })

  it('freestyle follows the exercise\'s setting now, not the stamp of last time', () => {
    const S = state([workout('2026-10-01', [entry(BENCH, [set(20, 8)], { dbLoad: 'each' })])])
    expect(freestyleConfig(S, { id: BENCH }).dbLoad).toBeUndefined()
  })
})

describe('sync and sharing', () => {
  it('keeps the exercise default chosen last on either device', () => {
    const a = { ...state(), _ts: 10, dbLoad: withDbLoad({}, BENCH, 'each', 10) }
    const b = { ...state(), _ts: 20, dbLoad: withDbLoad({ [CURL]: { mode: 'total', _ts: 3 } }, BENCH, 'total', 5) }
    const merged = mergeStates(a, b)
    expect(merged.dbLoad[BENCH]).toEqual({ mode: 'each', _ts: 10 })
    expect(merged.dbLoad[CURL]).toEqual({ mode: 'total', _ts: 3 })
  })

  it('re-stamps a changed default after every stamp the copy has seen', () => {
    const prev = { ...state(), _ts: 50, dbLoad: {} }
    const next = { ...prev, dbLoad: withDbLoad({}, BENCH, 'each', 1) }
    const now = stampChange(prev, next, 1)
    expect(next.dbLoad[BENCH]._ts).toBe(now)
    expect(now).toBeGreaterThan(50)
  })

  it('travels with a shared plan', () => {
    const S = state([], { routines: [{ id: 'r1', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 10, weight: 20, mode: 'reps', dbLoad: 'each' }, { id: CURL, sets: 3, reps: 10, weight: 10, mode: 'reps' }] }] })
    const list = buildPlanBundle(S, 'Push').routines[0].ex
    expect(list[0].dbLoad).toBe('each')
    expect(list[1].dbLoad).toBeUndefined()
    const back = parsePlan(JSON.stringify(buildPlanBundle(S, 'Push')), 'kg')
    expect(back.routines[0].ex[0].dbLoad).toBe('each')
  })
})

function buildPlannedEntry(S, cfg, routine) { return startMigratedFixture(S, { ...(routine || {}), ex: [cfg] }).entries[0] }
function buildPlanBundle(S, name) { return canonicalBuildPlanBundle(migratedFixture(S), name) }
function bestWeightFor(S, ...args) { return canonicalBestWeightFor(migratedFixture(S), ...args) }
function best1RM(S, ...args) { return canonicalBest1RM(migratedFixture(S), ...args) }
function e1rmSeries(S, ...args) { return canonicalE1rmSeries(migratedFixture(S), ...args) }
function exerciseHistory(S, ...args) { return canonicalExerciseHistory(migratedFixture(S), ...args) }
function bestSetFor(S, ...args) { return canonicalBestSetFor(migratedFixture(S), ...args) }
function is1RMRecord(S, id, en) { return canonicalIs1RMRecord(migratedFixture(S), id, migratedFixture({ ...S, workouts: [{ id: 'record', d: '2026-10-09', entries: [en] }] }).workouts[0].exposures[0]) }
