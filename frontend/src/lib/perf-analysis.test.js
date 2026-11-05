import { describe, it, expect } from 'vitest'
import { analyzePerf, epley, judge, sessionBest } from './perf-analysis.js'

const TODAY = '2026-11-05'   // a Thursday
const BENCH = '0025', SQUAT = '0043', SITUP = '0001'

const set = (w, r) => ({ w, r, done: true })
const day = (d, entries, extra = {}) => ({ id: 'w' + d, d, start: Date.parse(d + 'T10:00:00'), entries, ...extra })
const entry = (id, sets, gym) => ({ id, sets, ...(gym ? { gym } : {}) })
const state = (workouts, over = {}) => ({
  unit: 'kg', routines: [{ id: 'push', name: 'Push', ex: [] }], week: {}, dayPlan: {}, workouts,
  gyms: [{ id: 'bf', name: 'Basic-Fit' }, { id: 'tg', name: 'Technogym' }], ...over,
})
const find = (a, id, gym = null) => a.exercises.find(e => e.id === id && e.gym === gym)

describe('epley', () => {
  it('is w * (1 + r / 30), one rep being the measurement itself', () => {
    expect(epley(100, 10)).toBe(133.3)
    expect(epley(80, 1)).toBe(80)
    expect(epley(60, 5)).toBe(70)
  })
  it('refuses what cannot support an estimate', () => {
    expect(epley(0, 8)).toBeNull()
    expect(epley(50, 0)).toBeNull()
    expect(epley(50, 25)).toBeNull()
    expect(epley('x', 5)).toBeNull()
  })
})

describe('judge', () => {
  it('calls fewer than two sessions new', () => {
    expect(judge([100]).status).toBe('new')
  })
  it('sees steady gains as progress', () => {
    expect(judge([100, 104, 108]).status).toBe('progress')
  })
  it('sees three sessions without a new best as a stagnation', () => {
    const v = judge([100, 110, 110, 109, 110])
    expect(v.status).toBe('stagnation')
    expect(v.stalledFor).toBe(3)
  })
  it('does not call two flat sessions a stagnation yet', () => {
    expect(judge([110, 112, 112, 111]).status).toBe('stable')
  })
  it('sees a drop of more than 5% under the best as a regression', () => {
    expect(judge([100, 110, 104]).status).toBe('regression')
    expect(judge([100, 110, 106]).status).not.toBe('regression')
  })
})

describe('sessionBest', () => {
  it('takes the best estimate, not the heaviest set', () => {
    expect(sessionBest([set(100, 3), set(90, 8)]).e1rm).toBe(epley(90, 8))
  })
  it('falls back to reps for a lift with no load', () => {
    expect(sessionBest([{ w: 0, r: 8 }, { w: 0, r: 11 }])).toMatchObject({ e1rm: null, reps: 11 })
  })
})

describe('analyzePerf: by exercise and machine', () => {
  it('never mixes machines: two stacks are two series', () => {
    const S = state([
      day('2026-10-12', [entry(BENCH, [set(40, 8)], 'bf')]),
      day('2026-10-19', [entry(BENCH, [set(60, 8)], 'tg')]),
      day('2026-10-26', [entry(BENCH, [set(42.5, 8)], 'bf')]),
      day('2026-11-02', [entry(BENCH, [set(62.5, 8)], 'tg')]),
    ])
    const a = analyzePerf(S, { today: TODAY })
    const bf = find(a, BENCH, 'bf'), tg = find(a, BENCH, 'tg')
    expect(bf.machine).toBe('Basic-Fit')
    expect(tg.machine).toBe('Technogym')
    expect(bf.sessions).toBe(2)
    expect(bf.first.value).toBe(epley(40, 8))
    expect(bf.last.value).toBe(epley(42.5, 8))
    expect(tg.last.value).toBe(epley(62.5, 8))
    expect(a.exercises).toHaveLength(2)
  })

  it('reads a workout tagged as a whole as the machine of its exercises', () => {
    const S = state([
      day('2026-10-26', [entry(BENCH, [set(50, 8)])], { gym: 'tg' }),
      day('2026-11-02', [entry(BENCH, [set(55, 8)])], { gym: 'tg' }),
    ])
    expect(find(analyzePerf(S, { today: TODAY }), BENCH, 'tg').sessions).toBe(2)
  })

  it('keeps a log without any machine as its own series', () => {
    const S = state([day('2026-10-26', [entry(BENCH, [set(50, 8)])]), day('2026-11-02', [entry(BENCH, [set(52.5, 8)])])])
    expect(find(analyzePerf(S, { today: TODAY }), BENCH).machine).toBeNull()
  })

  it('flags progress, stagnation and regression, each on its own series', () => {
    const S = state([
      day('2026-10-05', [entry(BENCH, [set(60, 8)]), entry(SQUAT, [set(100, 5)]), entry(SITUP, [set(0, 15)])]),
      day('2026-10-12', [entry(BENCH, [set(62.5, 8)]), entry(SQUAT, [set(110, 5)])]),
      day('2026-10-19', [entry(BENCH, [set(65, 8)]), entry(SQUAT, [set(110, 5)])]),
      day('2026-10-26', [entry(BENCH, [set(67.5, 8)]), entry(SQUAT, [set(110, 5)])]),
      day('2026-11-02', [entry(BENCH, [set(70, 8)]), entry(SQUAT, [set(110, 5)])]),
    ])
    const a = analyzePerf(S, { today: TODAY })
    expect(find(a, BENCH).status).toBe('progress')
    expect(find(a, BENCH).changePct).toBeGreaterThan(10)
    expect(find(a, SQUAT).status).toBe('stagnation')
    expect(find(a, SQUAT).stalledFor).toBe(3)
    expect(a.counts).toMatchObject({ progress: 1, stagnation: 1, regression: 0 })
  })

  it('flags a regression and says whether the load or the reps dropped', () => {
    const S = state([
      day('2026-10-12', [entry(BENCH, [set(80, 8)])]),
      day('2026-10-19', [entry(BENCH, [set(82.5, 8)])]),
      day('2026-11-02', [entry(BENCH, [set(70, 8)])]),
    ])
    const b = find(analyzePerf(S, { today: TODAY }), BENCH)
    expect(b.status).toBe('regression')
    expect(b.dropped).toBe(true)
  })

  it('leaves out sets that were never done and anything older than the window', () => {
    const S = state([
      day('2026-08-01', [entry(BENCH, [set(200, 8)])]),
      day('2026-10-26', [entry(BENCH, [{ w: 90, r: 8, done: false }, set(50, 8)])]),
      day('2026-11-02', [entry(BENCH, [set(52.5, 8)])]),
    ])
    const b = find(analyzePerf(S, { today: TODAY }), BENCH)
    expect(b.sessions).toBe(2)
    expect(b.first.value).toBe(epley(50, 8))
  })

  it('tracks a bodyweight exercise by its best reps', () => {
    const S = state([day('2026-10-26', [entry(SITUP, [set(0, 12), set(0, 10)])]), day('2026-11-02', [entry(SITUP, [set(0, 15)])])])
    const s = find(analyzePerf(S, { today: TODAY }), SITUP)
    expect(s.metric).toBe('reps')
    expect(s.last.value).toBe(15)
    expect(s.changePct).toBe(25)
  })
})

describe('analyzePerf: records', () => {
  it('reports a best set in the last two weeks that beats everything before', () => {
    const S = state([
      day('2026-08-10', [entry(BENCH, [set(70, 8)])]),
      day('2026-10-26', [entry(BENCH, [set(65, 8)])]),
      day('2026-11-02', [entry(BENCH, [set(75, 8)])]),
    ])
    const a = analyzePerf(S, { today: TODAY })
    expect(a.records).toHaveLength(1)
    expect(a.records[0]).toMatchObject({ id: BENCH, d: '2026-11-02', value: epley(75, 8), before: epley(70, 8) })
  })
  it('reports none when the best is older than that, or nothing came before it', () => {
    const S = state([
      day('2026-10-12', [entry(BENCH, [set(75, 8)])]),
      day('2026-11-02', [entry(BENCH, [set(70, 8)])]),
    ])
    expect(analyzePerf(S, { today: TODAY }).records).toEqual([])
  })
})

describe('analyzePerf: volume and balance', () => {
  it('counts completed work sets per group per week, over the whole window', () => {
    const S = state([
      day('2026-10-26', [entry(BENCH, [set(60, 8), set(60, 8), set(60, 8)]), entry(SQUAT, [set(100, 5), set(100, 5)])]),
      day('2026-11-02', [entry(BENCH, [set(60, 8), set(60, 8), set(60, 8)])]),
    ])
    const v = analyzePerf(S, { today: TODAY }).volume
    expect(v.byGroup.find(g => g.id === 'chest').sets).toBe(6)
    expect(v.byGroup.find(g => g.id === 'chest').perWeek).toBe(1)   // 6 sets over 6 weeks
    expect(v.byGroup.find(g => g.id === 'quads').sets).toBe(2)
    expect(v.byGroup.find(g => g.id === 'back').sets).toBe(0)
  })

  it('flags a push-heavy split and a lower-body gap', () => {
    const sets = n => Array.from({ length: n }, () => set(60, 8))
    const S = state([day('2026-10-26', [entry(BENCH, sets(14)), entry(SQUAT, sets(2))])])
    const a = analyzePerf(S, { today: TODAY })
    expect(a.flags).toContain('push-heavy')
    expect(a.flags).toContain('upper-heavy')
    expect(a.volume.pushPull).toBeNull()
  })

  it('raises no flag on a small sample', () => {
    const S = state([day('2026-10-26', [entry(BENCH, [set(60, 8), set(60, 8)])])])
    expect(analyzePerf(S, { today: TODAY }).flags).toEqual([])
  })
})

describe('analyzePerf: regularity', () => {
  it('counts sessions per week and the planned days that went by with nothing logged', () => {
    const S = state([
      day('2026-10-19', [entry(BENCH, [set(60, 8)])]),
      day('2026-11-02', [entry(BENCH, [set(60, 8)])]),
    ], { week: { 1: ['push'], 3: ['push'] } })   // Mondays and Wednesdays
    const a = analyzePerf(S, { today: TODAY })
    expect(a.sessions.total).toBe(2)
    expect(a.sessions.plannedPerWeek).toBe(2)
    expect(a.sessions.skipped.map(s => s.d)).toContain('2026-10-21')   // a Wednesday with nothing
    expect(a.sessions.skipped.map(s => s.d)).not.toContain('2026-10-19')   // trained that Monday
    expect(a.sessions.skipped.map(s => s.d)).not.toContain('2026-11-05')  // today is not missed yet
    expect(a.sessions.skipped[0].names).toEqual(['Push'])
  })

  it('excuses a planned day that has a note (sick, travelling)', () => {
    const S = state([day('2026-10-19', [entry(BENCH, [set(60, 8)])])], {
      week: { 1: ['push'] }, dayNotes: { '2026-10-26': { tag: 'sick', text: '' } },
    })
    const a = analyzePerf(S, { today: TODAY })
    expect(a.sessions.skipped.map(s => s.d)).not.toContain('2026-10-26')
    expect(a.sessions.skipped.map(s => s.d)).toContain('2026-11-02')
  })
})

describe('analyzePerf: edge cases', () => {
  it('has nothing to say about an empty log', () => {
    const a = analyzePerf(state([]), { today: TODAY })
    expect(a.hasData).toBe(false)
    expect(a.exercises).toEqual([])
    expect(a.records).toEqual([])
  })
  it('survives a malformed state', () => {
    expect(() => analyzePerf({ workouts: [null, { d: 5 }, { d: '2026-11-01', entries: [null, { id: BENCH }] }] }, { today: TODAY })).not.toThrow()
  })
  it('does not write to the state it reads', () => {
    const S = state([day('2026-10-26', [entry(BENCH, [set(60, 8)])]), day('2026-11-02', [entry(BENCH, [set(62.5, 8)])])])
    const before = JSON.stringify(S)
    analyzePerf(S, { today: TODAY })
    expect(JSON.stringify(S)).toBe(before)
  })
})
