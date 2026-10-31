import { describe, expect, it } from 'vitest'
import {
  monthKeyOf, shiftMonth, weeksOfMonth, factsFor, levelOf, stretch, pickChallenges, CHALLENGES, CHALLENGE_IDS,
  monthChallenges, progressOf, newlyDone, savePicks, markDone, isGold, cleanChallenges, mergeChallenges,
  shelfOf, MONTHS_KEPT, PICKS, challengesOn, hiddenFor, GROUP_IDS,
} from './challenges.js'
import { mergeStates } from './sync-merge.js'
import { convertStateUnit } from './units.js'
import * as api from '../../../api/sync-stamps.js'

// Catalogue ids: barbell bench press, full squat, curl, cable row, floor crunch, band shoulder
// press, pull-up, chin-up, push-up, run.
const BENCH = '0025', SQUAT = '0043', CURL = '0031', ROW = '0861', CRUNCH = '0274', PRESS = '0997'
const PULLUP = '0652', CHINUP = '1326', PUSHUP = '0662', RUN = '0685'

const sets = (n, w, r) => Array.from({ length: n }, () => ({ w, r, done: true }))
let seq = 0
const wo = (d, entries, extra = {}) => ({ id: 'w' + (++seq), d, start: new Date(d + 'T18:00:00').getTime(), end: new Date(d + 'T19:00:00').getTime(), entries, ...extra })
const lift = (d, w = 100, extra) => wo(d, [{ id: BENCH, sets: sets(3, w, 10) }, { id: SQUAT, sets: sets(3, w, 10) }], extra)
const state = (o = {}) => ({ unit: 'kg', workouts: [], bodyweight: [], routines: [], week: {}, dayPlan: {}, ...o })
// `n` workouts spread over a month's first 28 days.
const month = (key, n, mk = d => lift(d)) => Array.from({ length: n }, (_, i) => mk(`${key}-${String(1 + Math.floor(i * 27 / Math.max(1, n))).padStart(2, '0')}`))

describe('months', () => {
  it('names the local month and steps over years', () => {
    expect(monthKeyOf(new Date(2026, 10, 30, 23, 59))).toBe('2026-11')
    expect(monthKeyOf(new Date(2026, 11, 1, 0, 0))).toBe('2026-12')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-03', -14)).toBe('2025-01')
  })

  it('counts the weeks that mostly fall in the month, in the profile’s own weeks', () => {
    // November 2026 starts on a Sunday: with Monday weeks, Oct 26 to Nov 1 has one day in it.
    expect(weeksOfMonth('2026-11', 1)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23'])
    // With Sunday weeks, Nov 1 starts a full week, and Nov 29 to Dec 5 has only two days.
    expect(weeksOfMonth('2026-11', 0)).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22'])
    expect(weeksOfMonth('2026-12', 1)).toHaveLength(5)
  })
})

describe('the target', () => {
  it('is a bit above usual, rounded up, kept between its bounds', () => {
    expect(stretch(12, { min: 4, max: 28 })).toBe(14)
    expect(stretch(4, { min: 4, max: 28 })).toBe(5)
    expect(stretch(0, { min: 4, max: 28 })).toBe(4)
    expect(stretch(40, { min: 4, max: 28 })).toBe(28)
    expect(stretch(83, { min: 20, max: 3000, step: 10 })).toBe(100)
    expect(stretch(5, { min: 20, max: 3000, step: 10 })).toBe(20)
  })

  it('follows the user: more workouts usual, a bigger goal', () => {
    const at = key => pickChallenges(state({ workouts: [...month('2026-08', 8), ...month('2026-09', 8), ...month('2026-10', 8)] }), key)
    const light = at('2026-11').find(p => p.id === 'workouts') || at('2026-12').find(p => p.id === 'workouts')
    const busy = s => {
      const S = state({ workouts: [...month('2026-08', 16), ...month('2026-09', 16), ...month('2026-10', 16)] })
      return [pickChallenges(S, '2026-11'), pickChallenges(S, '2026-12')].flat().find(p => p.id === 'workouts')
    }
    expect(light.n).toBe(10)
    expect(busy().n).toBe(19)
  })

  it('averages only the months since the first workout', () => {
    const S = state({ workouts: month('2026-10', 12) })
    const L = levelOf(S, '2026-11')
    expect(L.months).toBe(1)
    expect(L.workouts).toBe(12)
    expect(levelOf(S, '2026-10').fresh).toBe(true)
  })

  it('sizes volume in tonnes for kg and in round pounds for lb, the same lifting either way', () => {
    // 8 sessions a month, 6 sets of 10 at 100 kg: 48 t a month.
    const S = state({ workouts: [...month('2026-08', 8), ...month('2026-09', 8), ...month('2026-10', 8)] })
    expect(levelOf(S, '2026-11').volumeKg).toBe(48000)
    const vol = st => CHALLENGES.find(c => c.id === 'volume').target(levelOf(st, '2026-11'), { unit: st.unit })
    expect(vol(S)).toEqual({ n: 53000, u: 'kg' })
    const lb = convertStateUnit(S, 'lb')
    const t = vol(lb)
    expect(t.u).toBe('lb')
    expect(t.n % 5000).toBe(0)
    expect(t.n * 0.45359237).toBeGreaterThan(48000 * 1.1 - 1)
  })
})

describe('the pick', () => {
  const regular = () => state({
    workouts: [...month('2026-08', 10), ...month('2026-09', 10), ...month('2026-10', 10)],
    bodyweight: [{ d: '2026-10-02', w: 80 }, { d: '2026-10-09', w: 80 }],
  })

  it('is the same three for the same profile and month, and turns with the month', () => {
    const S = regular()
    const a = pickChallenges(S, '2026-11'), b = pickChallenges(JSON.parse(JSON.stringify(S)), '2026-11')
    expect(a).toEqual(b)
    expect(a).toHaveLength(PICKS)
    expect(new Set(a.map(p => p.id)).size).toBe(PICKS)
    const months = ['2026-11', '2026-12', '2027-01', '2027-02'].map(k => pickChallenges(S, k).map(p => p.id).join())
    expect(new Set(months).size).toBeGreaterThan(1)
  })

  it('takes a habit, an effort and something new when it can', () => {
    for (const k of ['2026-11', '2026-12', '2027-01']) {
      const kinds = pickChallenges(regular(), k).map(p => CHALLENGES.find(c => c.id === p.id).kind)
      expect(kinds).toEqual(['habit', 'effort', 'explore'])
    }
  })

  it('offers pull-ups only to someone who does pull-ups, cardio only with cardio', () => {
    const ids = S => new Set(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04'].flatMap(k => pickChallenges(S, k).map(p => p.id)))
    const plain = ids(regular())
    expect(plain.has('pullups')).toBe(false)
    expect(plain.has('cardio')).toBe(false)
    expect(plain.has('pushups')).toBe(false)
    const S = regular()
    S.workouts.push(wo('2026-10-20', [{ id: PULLUP, sets: sets(3, 0, 8) }, { id: RUN, sets: [{ min: 25, speed: 10, done: true }] }]))
    const L = levelOf(S, '2026-11')
    expect(L.pullups).toBe(8)
    expect(L.cardioMin).toBeCloseTo(25 / 3)
    const fits = CHALLENGES.filter(c => c.fits(L)).map(c => c.id)
    expect(fits).toContain('pullups')
    expect(fits).toContain('cardio')
    const pull = CHALLENGES.find(c => c.id === 'pullups').target(L, {})
    expect(pull.n).toBe(20)
  })

  it('still finds three for someone brand new', () => {
    const p = pickChallenges(state({ workouts: [lift('2026-11-02')] }), '2026-11')
    expect(p).toHaveLength(3)
    expect(p.map(x => x.id)).toEqual(expect.arrayContaining(['newex']))
    expect(p.find(x => x.id === 'workouts')?.n ?? 4).toBe(4)
  })
})

describe('progress, per challenge', () => {
  const F = (S, key = '2026-11') => factsFor(S, [key])[key]

  it('counts workouts by their local day, month boundaries included', () => {
    const late = new Date(2026, 9, 31, 23, 30).getTime()
    const early = new Date(2026, 10, 1, 0, 15).getTime()
    const S = state({
      workouts: [
        lift('2026-10-31'), lift('2026-11-01'), lift('2026-11-30'), lift('2026-12-01'),
        // logged before `d` existed: the start's local day decides
        { id: 'x1', start: late, end: late + 3600e3, entries: [{ id: BENCH, sets: sets(1, 50, 5) }] },
        { id: 'x2', start: early, end: early + 3600e3, entries: [{ id: BENCH, sets: sets(1, 50, 5) }] },
      ],
    })
    expect(F(S).workouts).toBe(3)
    expect(F(S, '2026-10').workouts).toBe(2)
  })

  it('counts the trained weeks of the month, only with workouts inside it', () => {
    const S = state({ workouts: [lift('2026-11-01'), lift('2026-11-03'), lift('2026-11-17'), lift('2026-11-18')] })
    // Nov 1 is in the week of Oct 26 (not one of November's), Nov 3 and 17 are.
    expect(F(S)).toMatchObject({ weeks: 4, weeksTrained: 2 })
  })

  it('reads volume in kg whatever the unit, warm-ups left out', () => {
    const S = state({ workouts: [wo('2026-11-05', [{ id: BENCH, sets: [{ w: 40, r: 10, done: true, phase: 'warmup' }, ...sets(2, 100, 10)] }])] })
    expect(F(S).volumeKg).toBe(2000)
    const lb = convertStateUnit(S, 'lb')
    expect(F(lb).volumeKg).toBeCloseTo(2000, 0)
    // A lb target is reached on the same lifting as its kg twin.
    const p = { key: '2026-11', picked: [{ id: 'volume', n: 4000, u: 'lb' }], done: [] }
    const [pr] = progressOf(lb, p)
    expect(Math.abs(pr.have - 2000 / 0.45359237)).toBeLessThan(5)
    expect(pr.done).toBe(true)
  })

  it('counts records, pull-ups, push-ups and cardio minutes', () => {
    const S = state({
      workouts: [
        wo('2026-11-03', [
          { id: PULLUP, sets: [{ w: 0, r: 5, done: true, phase: 'warmup' }, ...sets(3, 0, 8), { w: 0, r: 8, done: false }] },
          { id: CHINUP, sets: sets(2, 0, 6) },
          { id: PUSHUP, sets: sets(2, 0, 20) },
          { id: RUN, sets: [{ min: 20, speed: 10, done: true }, { min: 10, done: false }] },
        ], { prs: [PULLUP, PULLUP, CHINUP] }),
        wo('2026-11-10', [{ id: RUN, mode: 'time', sets: [{ sec: 600, done: true }] }], { prs: [BENCH] }),
      ],
    })
    expect(F(S)).toMatchObject({ pullups: 36, pushups: 40, prs: 3, cardioMin: 30 })
  })

  it('counts weigh-in days, not weigh-ins', () => {
    const S = state({ workouts: [lift('2026-11-02')], bodyweight: [{ d: '2026-11-02', w: 80, t: 1 }, { d: '2026-11-02', w: 80.4, t: 2 }, { d: '2026-11-09', w: 80 }, { d: '2026-10-30', w: 81 }] })
    expect(F(S).weighDays).toBe(2)
  })

  it('counts an exercise as new only when it was never done before the month, imports included', () => {
    const S = state({
      workouts: [
        wo('2024-03-01', [{ id: CURL, sets: sets(1, 20, 10) }], { source: 'import' }),
        lift('2026-10-01'),
        wo('2026-11-04', [{ id: CURL, sets: sets(2, 20, 10) }, { id: ROW, sets: sets(2, 50, 10) }, { id: PRESS, sets: [{ w: 10, r: 10, done: false }] }]),
        wo('2026-11-06', [{ id: ROW, sets: sets(1, 50, 10) }, { id: BENCH, sets: sets(1, 50, 10) }]),
      ],
    })
    // the row is new; the curl was imported years ago, the press never ticked
    expect(F(S).newEx).toBe(1)
  })

  it('ticks off a muscle group from a set that trains it, not from a helper muscle', () => {
    const S = state({ workouts: [wo('2026-11-04', [{ id: BENCH, sets: sets(3, 60, 10) }, { id: SQUAT, sets: sets(3, 60, 10) }])] })
    // chest and legs: the squat's helpers (lower back, abs) and the press's (shoulders, triceps) do not count
    expect(F(S).groups).toBe(2)
    S.workouts.push(wo('2026-11-05', [ROW, CURL, CRUNCH, PRESS].map(id => ({ id, sets: sets(2, 20, 10) }))))
    expect(F(S).groups).toBe(GROUP_IDS.length)
  })
})

describe('done, stored and merged', () => {
  const key = '2026-11'
  const picked = [{ id: 'workouts', n: 2 }, { id: 'newex', n: 3 }, { id: 'muscles', n: 6 }]

  it('keeps the picks once saved, even if the history before changes', () => {
    const s = state({ workouts: month('2026-10', 4) })
    expect(monthChallenges(s, key).stored).toBe(false)
    savePicks(s, key, picked, 1000)
    s.workouts.push(...month('2026-09', 20))
    const m = monthChallenges(s, key)
    expect(m.stored).toBe(true)
    expect(m.picked).toEqual(picked)
    expect(savePicks(s, key, [{ id: 'weeks', n: 4 }], 2000)).toBe(false)
  })

  it('marks a reached challenge done once, and a deleted workout does not take the badge back', () => {
    const s = state({ workouts: [lift('2026-11-02'), lift('2026-11-03')] })
    savePicks(s, key, picked, 1000)
    const m = monthChallenges(s, key)
    const prog = progressOf(s, m)
    expect(newlyDone(m, prog)).toEqual(['workouts'])
    expect(markDone(s, key, ['workouts'], m.picked)).toBe(true)
    expect(markDone(s, key, ['workouts'], m.picked)).toBe(false)
    s.workouts.pop()
    const after = progressOf(s, monthChallenges(s, key))
    expect(after.find(p => p.id === 'workouts')).toMatchObject({ have: 1, done: true, pct: 1 })
    expect(newlyDone(monthChallenges(s, key), after)).toEqual([])
  })

  it('makes a gold month of all three, and the shelf lists the months with a badge', () => {
    const s = state()
    markDone(s, '2026-09', ['workouts'], picked, 1)
    markDone(s, '2026-10', ['workouts', 'newex', 'muscles'], picked, 2)
    savePicks(s, '2026-11', picked, 3)
    expect(isGold(s.challenges['2026-10'])).toBe(true)
    expect(shelfOf(s)).toEqual([
      { key: '2026-10', done: 3, total: 3, gold: true },
      { key: '2026-09', done: 1, total: 3, gold: false },
    ])
  })

  it('cleans what any device sends: real months only, the last 24, capped lists', () => {
    const v = { nope: {}, '2026-13': { picked }, '2026-11': { picked: [...picked, { id: 'weeks', n: 4 }, { id: 'BAD id', n: 1 }, { id: 'prs', n: -1 }], done: ['workouts', 'workouts', 'weeks', 7], at: 'x' } }
    for (let i = 0; i < 30; i++) v[shiftMonth('2024-01', i)] = { picked, done: ['newex'], at: i + 1 }
    const c = cleanChallenges(v)
    expect(Object.keys(c)).toHaveLength(MONTHS_KEPT)
    expect(c['2026-11']).toEqual({ picked, done: ['workouts'], at: 0 })
    expect(c['2026-13']).toBeUndefined()
    expect(cleanChallenges([])).toBeNull()
    expect(cleanChallenges({ '2026-11': { picked: [], done: [] } })).toBeNull()
  })

  it('merges two devices: the first picks, the union of what was done', () => {
    const a = { '2026-11': { picked, done: ['workouts'], at: 100 }, '2026-10': { picked, done: ['newex'], at: 5 } }
    const b = { '2026-11': { picked: [{ id: 'weeks', n: 4 }, ...picked.slice(1)], done: ['newex', 'weeks'], at: 200 } }
    const m = mergeChallenges(a, b)
    expect(m['2026-11']).toEqual({ picked, done: ['newex', 'workouts'], at: 100 })
    expect(m['2026-10'].done).toEqual(['newex'])
    expect(mergeChallenges(b, a)).toEqual(m)
    expect(mergeChallenges(undefined, undefined)).toBeUndefined()
    expect(mergeChallenges(a, null)).toEqual(cleanChallenges(a))
  })

  it('survives a sync merge either way round, whichever copy is newer', () => {
    const base = state()
    const phone = { ...base, _ts: 10, challenges: { '2026-11': { picked, done: ['workouts'], at: 1 } } }
    const laptop = { ...base, _ts: 20, challenges: { '2026-11': { picked, done: ['muscles'], at: 1 } } }
    for (const [x, y] of [[phone, laptop], [laptop, phone]]) {
      expect(mergeStates(x, y).challenges['2026-11'].done).toEqual(['muscles', 'workouts'])
    }
  })

  it('is merged the same on the server (api/sync-stamps.js), and a push never takes a badge back', () => {
    const R = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()
    const ids = ['workouts', 'weeks', 'newex', 'muscles', 'prs']
    for (let i = 0; i < 200; i++) {
      const one = () => {
        const out = {}
        for (const k of ['2026-09', '2026-10', '2026-11']) {
          if (R() < 0.3) continue
          const pk = ids.filter(() => R() < 0.6).slice(0, 3).map(id => ({ id, n: 1 + Math.floor(R() * 20) }))
          out[k] = { picked: pk, done: pk.filter(() => R() < 0.5).map(p => p.id), at: Math.floor(R() * 5) }
        }
        return out
      }
      const a = one(), b = one()
      expect(api.mergeChallenges(a, b)).toEqual(mergeChallenges(a, b))
    }
    const cur = { _ts: 1, challenges: { '2026-11': { picked, done: ['workouts', 'muscles'], at: 1 } } }
    const next = { _ts: 2, challenges: { '2026-11': { picked, done: ['workouts'], at: 1 } } }
    for (const stamped of [true, false]) {
      const out = api.stampPut(JSON.parse(JSON.stringify(cur)), JSON.parse(JSON.stringify(next)), { stamped, overRead: true, now: 5 })
      expect(out.challenges['2026-11'].done).toEqual(['muscles', 'workouts'])
    }
  })
})

describe('settings', () => {
  it('is on unless switched off, and the × hides one month only', () => {
    expect(challengesOn({})).toBe(true)
    expect(challengesOn({ monthlyChallenges: false })).toBe(false)
    expect(hiddenFor({ challengesHidden: '2026-11' }, '2026-11')).toBe(true)
    expect(hiddenFor({ challengesHidden: '2026-11' }, '2026-12')).toBe(false)
  })

  it('has a unique id per challenge', () => {
    expect(new Set(CHALLENGE_IDS).size).toBe(CHALLENGE_IDS.length)
  })
})
