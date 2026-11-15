import { describe, it, expect } from 'vitest'
import { normalizeTempo, parseTempo, tempoOf, repSec, tutSec, tempoSteps, stepAt, X_SEC } from './tempo.js'

describe('tempo (#572)', () => {
  it('reads the usual ways of writing a tempo', () => {
    expect(normalizeTempo('3-1-1-0')).toBe('3-1-1-0')
    expect(normalizeTempo('3110')).toBe('3-1-1-0')
    expect(normalizeTempo('3/1/1/0')).toBe('3-1-1-0')
    expect(normalizeTempo(' 3 1 x 0 ')).toBe('3-1-X-0')
    expect(normalizeTempo('2.0.1.0')).toBe('2-0-1-0')
  })
  it('refuses what is not a tempo', () => {
    for (const bad of [null, undefined, '', '3-1-1', '3-1-1-0-1', '10-1-1-0', 'abcd', '0-0-0-0', '3--1-0', {}, 31]) {
      expect(normalizeTempo(bad)).toBeNull()
    }
  })
  it('parses X as one quick second', () => {
    expect(parseTempo('3-1-X-0')).toEqual({ down: 3, bottom: 1, up: X_SEC, top: 0, x: ['up'] })
    expect(parseTempo('nope')).toBeNull()
  })
  it('a set’s own tempo wins over the exercise’s', () => {
    expect(tempoOf({ tempo: '3-1-1-0' }, {})).toBe('3-1-1-0')
    expect(tempoOf({ tempo: '3-1-1-0' }, { tempo: '5-0-1-0' })).toBe('5-0-1-0')
    expect(tempoOf({ tempo: 'junk' }, { tempo: 'junk' })).toBeNull()
    expect(tempoOf(null, null)).toBeNull()
  })
  it('counts the time under tension', () => {
    expect(repSec('3-1-1-0')).toBe(5)
    expect(tutSec('3-1-1-0', 8)).toBe(40)
    expect(tutSec('3-1-1-0', 0)).toBe(0)
    expect(tutSec(null, 8)).toBe(0)
  })
  it('scripts the guide, leaving out the phases that take no time', () => {
    const steps = tempoSteps('3-0-1-0', 2)
    expect(steps).toEqual([
      { rep: 1, phase: 'down', at: 0, sec: 3 },
      { rep: 1, phase: 'up', at: 3, sec: 1 },
      { rep: 2, phase: 'down', at: 4, sec: 3 },
      { rep: 2, phase: 'up', at: 7, sec: 1 },
    ])
    expect(tempoSteps('3-0-1-0', 0)).toEqual([])
    expect(tempoSteps('3-0-1-0', 500).length).toBe(100)
  })
  it('knows where the guide is', () => {
    const steps = tempoSteps('3-1-1-0', 1)
    expect(stepAt(steps, 0)).toMatchObject({ done: false, index: 0, left: 3 })
    expect(stepAt(steps, 2.5)).toMatchObject({ index: 0, left: 1 })
    expect(stepAt(steps, 3)).toMatchObject({ index: 1, step: { phase: 'bottom' }, left: 1 })
    expect(stepAt(steps, 4.2)).toMatchObject({ index: 2, step: { phase: 'up' } })
    expect(stepAt(steps, 5)).toEqual({ done: true })
    expect(stepAt([], 0)).toEqual({ done: true })
  })
})

describe('guideReps', () => {
  it('one side’s reps on a per-side set, else the set’s, the plan’s or 8', async () => {
    const { guideReps } = await import('./tempo.js')
    expect(guideReps({ r: 12, sides: { L: { r: 6, done: false }, R: { r: 6, done: false } } })).toBe(6)
    expect(guideReps({ r: 12, sides: { L: { r: 6, done: true }, R: { r: 7, done: false } } })).toBe(7)
    expect(guideReps({ r: 10 }, { reps: 8 })).toBe(10)
    expect(guideReps(null, { reps: 8 })).toBe(8)
    expect(guideReps(undefined, undefined)).toBe(8)
  })
})
