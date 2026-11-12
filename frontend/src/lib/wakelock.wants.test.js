import { describe, expect, it } from 'vitest'
import { wantsWakeLock } from './wakelock.js'

describe('wantsWakeLock', () => {
  it('holds the screen for a running workout', () => {
    expect(wantsWakeLock({ active: { start: 1 } })).toBe(true)
  })
  it('lets it sleep with no workout, in the editor of a saved one, or with the setting off', () => {
    expect(wantsWakeLock({ active: null })).toBe(false)
    expect(wantsWakeLock({ active: { start: 1, editingWorkoutId: 'w1' } })).toBe(false)
    expect(wantsWakeLock({ active: { start: 1 }, keepAwake: false })).toBe(false)
    expect(wantsWakeLock(undefined)).toBe(false)
  })
  it('lets it sleep while the workout is paused, and holds it again on resume', () => {
    expect(wantsWakeLock({ active: { start: 1, pausedAt: 1794380000000 } })).toBe(false)
    expect(wantsWakeLock({ active: { start: 1, pausedAt: null } })).toBe(true)
  })
})
