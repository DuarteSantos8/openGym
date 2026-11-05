// Q6: the notification at the end of a rest names the set waiting, not just "Next set!".
import { describe, expect, it } from 'vitest'
import { restNextLine, restOverTitle } from './rest-next.js'

const S = (entries, over = {}) => ({ unit: 'kg', active: { id: 'a', cur: 0, entries }, ...over })
const bench = { id: '0025', target: { mode: 'reps' }, sets: [{ w: 80, r: 8, done: true }, { w: 80, r: 8, done: false }] }

describe('the next set, in a line', () => {
  it('names the exercise with weight × reps', () => {
    const line = restNextLine(S([bench]), 0)
    expect(line).toMatch(/, 80 kg × 8$/)
    expect(line.split(', ')[0].length).toBeGreaterThan(2)   // the exercise's own name first
    expect(restOverTitle(line)).toBe('Rest’s over: ' + line)
  })

  it('a hold, a cardio block, bodyweight reps, a per-side set, a warm-up and pounds', () => {
    expect(restNextLine(S([{ id: 'x1', n: 'Plank', target: { mode: 'time', sec: 45 }, sets: [{ done: false }] }]), 0)).toBe('Plank, 45 s')
    expect(restNextLine(S([{ id: 'x2', n: 'Treadmill', target: { mode: 'cardio' }, sets: [{ min: 20, done: false }] }]), 0)).toBe('Treadmill, 20 min')
    expect(restNextLine(S([{ id: 'x3', n: 'Pull-up', target: { mode: 'reps' }, sets: [{ w: 0, r: 8, done: false }] }]), 0)).toBe('Pull-up, 8 reps')
    expect(restNextLine(S([{ id: 'x4', n: 'Lunge', target: { mode: 'reps' }, sets: [{ sides: { L: { w: 20, r: 10, done: false }, R: { w: 20, r: 10, done: false } } }] }]), 0)).toBe('Lunge, 20 kg × 10 per side')
    expect(restNextLine(S([{ id: 'x5', n: 'Squat', target: { mode: 'reps' }, sets: [{ w: 60, r: 5, done: false, phase: 'warmup' }] }]), 0)).toBe('Squat, Warm-up, 60 kg × 5')
    expect(restNextLine(S([{ id: 'x6', n: 'Row', target: { mode: 'reps' }, sets: [{ w: 135, r: 10, done: false }] }], { unit: 'lb' }), 0)).toBe('Row, 135 lb × 10')
  })

  it('moves on to the next exercise once this one is done, and says nothing when all is done', () => {
    const done = { ...bench, sets: bench.sets.map(s => ({ ...s, done: true })) }
    const row = { id: 'x7', n: 'Row', target: { mode: 'reps' }, sets: [{ w: 50, r: 12, done: false }] }
    expect(restNextLine(S([done, row]), 0)).toBe('Row, 50 kg × 12')
    expect(restNextLine(S([done]), 0)).toBe('')
    expect(restOverTitle('')).toBe('Rest’s over. Next set!')
    expect(restNextLine({}, 0)).toBe('')
  })
})
