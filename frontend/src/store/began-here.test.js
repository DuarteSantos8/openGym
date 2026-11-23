// @vitest-environment happy-dom
// The first set is announced only for a workout begun here and now (review 1.4.6): not one that
// arrives by sync from another device, comes back at sign-in, is a backfill or runs in the tour.
import { describe, expect, it } from 'vitest'
import { beganHere, BEGAN_WINDOW_MS } from './useUI.js'

const now = 1_800_000_000_000
const st = (active, extra = {}) => ({ S: { active }, ...extra })

describe('beganHere', () => {
  it('a workout started a moment ago is a beginning', () => {
    expect(beganHere(st({ id: 'a', start: now - 2000 }), now)).toBe(true)
  })
  it('one that started earlier (synced in, restored at sign-in) is not', () => {
    expect(beganHere(st({ id: 'a', start: now - BEGAN_WINDOW_MS - 1 }), now)).toBe(false)
    expect(beganHere(st({ id: 'a', start: now - 3600e3 }), now)).toBe(false)
  })
  it('a backfill, an edit of a past workout and the tour are not', () => {
    expect(beganHere(st({ id: 'a', start: now, backfill: { durationMin: 60 } }), now)).toBe(false)
    expect(beganHere(st({ id: 'a', start: now, editingWorkoutId: 'w1' }), now)).toBe(false)
    expect(beganHere(st({ id: 'a', start: now }, { tourSandbox: true }), now)).toBe(false)
    expect(beganHere(st(null), now)).toBe(false)
  })
})
