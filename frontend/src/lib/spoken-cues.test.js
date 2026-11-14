import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('./speech.js', () => ({ speak: vi.fn(() => Promise.resolve(true)), SPEECH_RATES: { slow: 0.8, normal: 1, fast: 1.25 }, speechRateOf: S => S?.speechRate || 'normal' }))
const { speak } = await import('./speech.js')
const { nextSetAfter, setCueText, restStartText, cues, bindCueState, cuesOn, sampleCue } = await import('./spoken-cues.js')

const BENCH = '0025', SQUAT = '0043'
const set = (w, r, done = false, extra = {}) => ({ w, r, done, ...extra })
const entry = (id, sets, target = { mode: 'reps' }, extra = {}) => ({ id, target, sets, ...extra })
const S = (entries, extra = {}) => ({ unit: 'kg', spokenCues: true, active: { cur: 0, entries }, ...extra })

afterEach(() => { speak.mockClear(); bindCueState(null) })

describe('what comes next after a rest', () => {
  test('the same exercise, then the next one down the list', () => {
    const a = { entries: [entry(BENCH, [set(80, 8, true), set(80, 8)]), entry(SQUAT, [set(100, 5)])] }
    expect(nextSetAfter(a, 0)).toEqual({ idx: 0, i: 1 })
    a.entries[0].sets[1].done = true
    expect(nextSetAfter(a, 0)).toEqual({ idx: 1, i: 0 })
  })
  test('round and round a superset', () => {
    const a = { entries: [entry(BENCH, [set(80, 8, true), set(80, 8)], undefined, { sg: 'g' }), entry(SQUAT, [set(100, 5), set(100, 5)], undefined, { sg: 'g' })] }
    expect(nextSetAfter(a, 0)).toEqual({ idx: 1, i: 0 })
    a.entries[1].sets[0].done = true
    expect(nextSetAfter(a, 1)).toEqual({ idx: 0, i: 1 })
  })
  test('nothing left, nothing next', () => {
    expect(nextSetAfter({ entries: [entry(BENCH, [set(80, 8, true)])] }, 0)).toBe(null)
  })
})

describe('the line for a set', () => {
  test('set number, weight and reps', () => {
    const e = entry(BENCH, [set(40, 5, true, { phase: 'warmup' }), set(80, 8, true), set(82.5, 8)])
    expect(setCueText(S([e]), e, 2)).toBe('Set 2, 82.5 kilos, 8 reps')
    expect(setCueText(S([e]), e, 0)).toBe('Warm-up, 40 kilos, 5 reps')
    expect(setCueText(S([e], { unit: 'lb' }), e, 1)).toBe('Set 1, 80 pounds, 8 reps')
  })
  test('bodyweight, holds, per side and cardio', () => {
    const pull = entry('pullup', [set(0, 1)])
    expect(setCueText(S([pull]), pull, 0)).toBe('Set 1, 1 rep')
    const plank = entry('plank', [{ sec: 45, done: false }], { mode: 'time', sec: 45 })
    expect(setCueText(S([plank]), plank, 0)).toBe('Set 1, 45 seconds')
    const lunge = entry('lunge', [{ w: 20, r: 16, done: false, sides: { L: { w: 20, r: 8 }, R: { w: 20, r: 8 } } }])
    expect(setCueText(S([lunge]), lunge, 0)).toBe('Set 1, 20 kilos, 8 reps per side')
    const run = entry('run', [{ min: 20, speed: 10, done: false }], { mode: 'cardio' })
    expect(setCueText(S([run]), run, 0)).toBe('Set 1, 20 minutes')
  })
  test('another exercise is named first', () => {
    const st = S([entry(BENCH, [set(80, 8, true)]), entry(SQUAT, [set(100, 5)])])
    expect(restStartText(st, 0)).toMatch(/^.+\. Set 1, 100 kilos, 5 reps$/)
  })
  test('the Settings sample', () => {
    expect(sampleCue('kg')).toBe('Set 3, 80 kilos, 8 reps')
  })
})

describe('the moments', () => {
  const st = S([entry(BENCH, [set(80, 8, true), set(80, 8)])])
  test('off, or no workout running, says nothing', () => {
    bindCueState(() => ({ ...st, spokenCues: false }))
    cues.restStarted(0); cues.restOver(); cues.count(3)
    bindCueState(() => ({ ...st, active: null }))
    cues.restOver()
    expect(speak).not.toHaveBeenCalled()
    expect(cuesOn({ spokenCues: true, active: {} })).toBe(true)
  })
  test('a rest: the next set, 10 seconds on a long rest only, then over', () => {
    bindCueState(() => st)
    cues.restStarted(0)
    cues.restLeft(11, 90); cues.restLeft(10, 90); cues.restLeft(10, 15)
    cues.restOver()
    expect(speak.mock.calls.map(c => c[0])).toEqual(['Set 2, 80 kilos, 8 reps', '10 seconds', 'Rest is over'])
  })
  test('holds count 3, 2, 1 and go, each cutting off the one before', () => {
    bindCueState(() => ({ ...st, speechRate: 'fast' }))
    cues.count(4); cues.count(3); cues.count(2); cues.count(1); cues.go()
    expect(speak.mock.calls.map(c => c[0])).toEqual(['3', '2', '1', 'Go!'])
    expect(speak.mock.calls.every(c => c[1].queue === false && c[1].rate === 1.25)).toBe(true)
  })
})
