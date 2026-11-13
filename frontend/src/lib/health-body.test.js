import { describe, expect, it } from 'vitest'
import { mergeBodyComp, bodyCompSummary, BODY_KEEP } from './health-read.js'
import { bodyCompValue } from '../components/HealthBodyCard.jsx'

// Body composition from the health hub (#197, #589): what a smart scale saved, kept on this phone.
const DAY = 24 * 3600e3
const T = 1_762_400_000_000

describe('mergeBodyComp', () => {
  // #1014: the water a Renpho or a Withings scale saves, in kg like the other masses.
  it('keeps body water as its own kind, in kg and within a plausible range', () => {
    const got = mergeBodyComp({}, [
      { kind: 'water', t: T, v: 41.27, id: 'w1' },
      { kind: 'water', t: T - DAY, v: 3, id: 'w2' },
      { kind: 'water', t: T - 2 * DAY, v: 400, id: 'w3' },
    ])
    expect(got.water).toEqual([{ t: T, v: 41.27, id: 'w1' }])
    expect(bodyCompSummary(got).map(r => r.kind)).toEqual(['water'])
    expect(bodyCompValue('water', 41.27, 'lb')).toEqual({ v: 91, unit: 'lb' })
  })
  it('keeps each kind in order, once per reading, and leaves out our own and the implausible', () => {
    const got = mergeBodyComp({}, [
      { kind: 'fat', t: T, v: 18.24, id: 'a', origin: 'com.withings' },
      { kind: 'fat', t: T - DAY, v: 18.6, id: 'b' },
      { kind: 'lean', t: T, v: 62.1, id: 'c' },
      { kind: 'bone', t: T, v: 3.2, id: 'd' },
      { kind: 'bmr', t: T, v: 1780, id: 'e' },
      { kind: 'fat', t: T, v: 90, id: 'f' },
      { kind: 'fat', t: T + 1, v: 17, id: 'g', origin: 'ch.duartesantos.opengym' },
      { kind: 'height', t: T, v: 180, id: 'h' },
    ])
    expect(got.fat).toEqual([{ t: T - DAY, v: 18.6, id: 'b' }, { t: T, v: 18.24, id: 'a' }])
    expect(got.lean[0].v).toBe(62.1)
    expect(got.bone).toHaveLength(1)
    expect(got.bmr).toHaveLength(1)
  })
  it('is null when nothing new came in, and keeps only the newest readings', () => {
    const once = mergeBodyComp({}, [{ kind: 'fat', t: T, v: 20, id: 'a' }])
    expect(mergeBodyComp(once, [{ kind: 'fat', t: T, v: 20, id: 'a' }])).toBeNull()
    const many = Array.from({ length: BODY_KEEP + 5 }, (_, i) => ({ kind: 'fat', t: T + i * DAY, v: 20, id: 'x' + i }))
    const kept = mergeBodyComp({}, many).fat
    expect(kept).toHaveLength(BODY_KEEP)
    expect(kept.at(-1).id).toBe('x' + (BODY_KEEP + 4))
  })
})

describe('bodyCompSummary', () => {
  it('shows the latest per kind and the change over about a month', () => {
    const s = bodyCompSummary({ fat: [{ t: T - 40 * DAY, v: 21 }, { t: T - 29 * DAY, v: 20 }, { t: T, v: 18.5 }], lean: [{ t: T, v: 60 }] })
    expect(s).toEqual([
      { kind: 'fat', t: T, v: 18.5, change: -1.5 },
      { kind: 'lean', t: T, v: 60, change: null },
    ])
    expect(bodyCompSummary({})).toEqual([])
  })
})

describe('bodyCompValue', () => {
  it('shows masses in the profile unit, fat in percent and BMR in whole kcal', () => {
    expect(bodyCompValue('lean', 60, 'lb')).toEqual({ v: 132.3, unit: 'lb' })
    expect(bodyCompValue('bone', 3.24, 'kg')).toEqual({ v: 3.2, unit: 'kg' })
    expect(bodyCompValue('fat', 18.26, 'kg')).toEqual({ v: 18.3, unit: '%' })
    expect(bodyCompValue('bmr', 1780.4, 'kg')).toEqual({ v: 1780, unit: 'kcal' })
  })
})
