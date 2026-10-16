import { describe, expect, it } from 'vitest'
import { PROFILE_RENAMED, isTabRoot, launchPath, legacyPath, parentOf, slotOf, tabOf, workoutRunning } from './tab-route.js'

describe('the tab comes from the route', () => {
  it('Home, Training, Nutrition and Progress own their own paths', () => {
    expect(tabOf('/home')).toBe('home')
    expect(tabOf('/train')).toBe('train')
    expect(tabOf('/train/routines/abc')).toBe('train')
    expect(tabOf('/food')).toBe('food')
    expect(tabOf('/progress/body/photos')).toBe('progress')
  })

  it('the workout and Profile belong to no tab: they sit on the one that opened them', () => {
    for (const p of ['/train/workout', '/me', '/me/workout', '/me/admin', '/', ''])
      expect(tabOf(p), p).toBeNull()
  })

  it('does not take a lookalike for a tab', () => {
    expect(tabOf('/training')).toBeNull()
    expect(tabOf('/progress-photos')).toBeNull()
    expect(tabOf('/homes')).toBeNull()
  })

  it('knows the four roots', () => {
    for (const p of ['/home', '/train', '/food', '/progress']) expect(isTabRoot(p), p).toBe(true)
    for (const p of ['/train/history', '/progress/body', '/me', '/train/workout']) expect(isTabRoot(p), p).toBe(false)
  })

  it('never puts a tab on the centre +', () => {
    expect([0, 1, 2, 3].map(slotOf)).toEqual([0, 1, 3, 4])
  })
})

describe('back on a cold entry goes to the parent', () => {
  it('one level up, down to the tab root', () => {
    expect(parentOf('/train/history')).toBe('/train')
    expect(parentOf('/train/routines/abc')).toBe('/train/routines')
    expect(parentOf('/train/exercises/muscles')).toBe('/train/exercises')
    expect(parentOf('/progress/strength/balance')).toBe('/progress/strength')
    expect(parentOf('/progress/load')).toBe('/progress')
  })

  it('a Body segment to Progress: the three are one page, not a stack', () => {
    expect(parentOf('/progress/body')).toBe('/progress')
    expect(parentOf('/progress/body/measurements')).toBe('/progress')
    expect(parentOf('/progress/body/photos')).toBe('/progress')
  })

  it('the Coach to Training, Profile pages to Profile, Profile and the workout to Home', () => {
    expect(parentOf('/train/coach/intake')).toBe('/train')
    expect(parentOf('/me/workout')).toBe('/me')
    expect(parentOf('/me')).toBe('/home')
    expect(parentOf('/train/workout')).toBe('/home')
  })
})

describe('the routes from before the tabs', () => {
  it('go where they live now, the rest of the path kept', () => {
    expect(legacyPath('/home')).toBeNull()   // still Home
    expect(legacyPath('/plan')).toBe('/train/schedule')
    expect(legacyPath('/plan/r/abc')).toBe('/train/routines/abc')
    expect(legacyPath('/workout')).toBe('/train/workout')
    expect(legacyPath('/history')).toBe('/train/history')
    expect(legacyPath('/library')).toBe('/train/exercises')
    expect(legacyPath('/muscles')).toBe('/train/exercises/muscles')
    expect(legacyPath('/checkin')).toBe('/train/checkin')
    expect(legacyPath('/coach/intake')).toBe('/train/coach/intake')
    expect(legacyPath('/stats')).toBe('/progress')
    expect(legacyPath('/structural-balance')).toBe('/progress/strength/balance')
    expect(legacyPath('/progress-photos')).toBe('/progress/body/photos')
    expect(legacyPath('/measurements')).toBe('/progress/body/measurements')
    expect(legacyPath('/body')).toBe('/progress/body')
    expect(legacyPath('/settings')).toBe('/me')
    expect(legacyPath('/settings/workout')).toBe('/me/workout')
    expect(legacyPath('/admin')).toBe('/me/admin')
  })

  it('send the Profile pages the §5 merge renamed to their new names', () => {
    expect(legacyPath('/settings/look')).toBe('/me/appearance')
    expect(legacyPath('/settings/reminders')).toBe('/me/notifications')
    expect(legacyPath('/settings/plan')).toBe('/me/schedule')
    expect(legacyPath('/settings/data', '?x=1')).toBe('/me/backup?x=1')
    expect(legacyPath('/settings/advanced')).toBe('/me/advanced')
    expect(PROFILE_RENAMED).toEqual({ look: 'appearance', reminders: 'notifications', plan: 'schedule', data: 'backup' })
  })

  it('leave new and unknown routes alone', () => {
    expect(legacyPath('/train/history')).toBeNull()
    expect(legacyPath('/plans')).toBeNull()
    expect(legacyPath('/nope')).toBeNull()
  })
})

describe('the launch', () => {
  it('opens Home, or straight into a running workout', () => {
    expect(launchPath(false)).toBe('/home')
    expect(launchPath(true)).toBe('/train/workout')
  })
  it('counts a live session only, not a past workout being edited or logged', () => {
    expect(workoutRunning({ active: { start: 1 } })).toBe(true)
    expect(workoutRunning({ active: { start: 1, editingWorkoutId: 'w' } })).toBe(false)
    expect(workoutRunning({ active: { start: 1, backfill: true } })).toBe(false)
    expect(workoutRunning({ active: null })).toBe(false)
  })
})
