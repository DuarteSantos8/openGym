// The profile fields used to grade strength levels (`sex`, `birthYear`, set in the About you sheet)
// are plain top-level settings: each change is stamped in `edited` and the merge takes each one
// from the device that changed it last. These cases pin that down, so a clear is not undone by an
// older copy and a change to one field does not wipe the other.
import { describe, expect, it } from 'vitest'
import { mergeStates, stampChange } from './sync-merge.js'

const clone = o => JSON.parse(JSON.stringify(o))
const base = (over = {}) => ({
  unit: 'kg', lang: 'en', restSec: 90, workouts: [], routines: [], bodyweight: [], customEx: [],
  favEx: [], exWeights: {}, exNotes: {}, barWeights: {}, equipProfiles: [], gymCards: [], _ts: 0, ...over,
})
// An edit made on one device, stamped the way the store does on every update.
const edit = (prev, fn, wall) => {
  const next = clone(prev)
  fn(next)
  stampChange(prev, next, wall)
  return next
}

describe('profile fields across devices', () => {
  it('a sex and birth year set on one device reach a device that never had them', () => {
    const start = base()
    const phone = edit(start, s => { s.sex = 'male'; s.birthYear = 1990 }, 1000)
    const desktop = clone(start)
    expect(mergeStates(phone, desktop)).toMatchObject({ sex: 'male', birthYear: 1990 })
    expect(mergeStates(desktop, phone)).toMatchObject({ sex: 'male', birthYear: 1990 })
  })

  it('a cleared sex stays cleared against an older copy that still has it, in either order', () => {
    const start = edit(base(), s => { s.sex = 'female'; s.birthYear = 1990 }, 1000)
    const cleared = edit(start, s => { delete s.sex }, 2000)
    const stale = clone(start)
    for (const merged of [mergeStates(cleared, stale), mergeStates(stale, cleared)]) {
      expect(merged.sex).toBeUndefined()
      expect(merged.birthYear).toBe(1990)
    }
  })

  it('a change to birth year on one device does not undo a clear of sex on the other', () => {
    const start = edit(base(), s => { s.sex = 'male'; s.birthYear = 1980 }, 1000)
    const phone = edit(start, s => { s.birthYear = 1985 }, 2000)
    const desktop = edit(start, s => { delete s.sex }, 3000)
    const merged = mergeStates(phone, desktop)
    expect(merged.sex).toBeUndefined()
    expect(merged.birthYear).toBe(1985)
  })
})
