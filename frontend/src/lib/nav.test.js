// Android back after a sheet that closes and moves on (#/workout ⋯ > Workout settings > All
// settings, Finish > Nice!, Start > a routine): the sheet's history entry, or the chooser's
// #/workout, stayed under the new page, so one back press landed on the same screen and seemed
// to do nothing.
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeThenNav, nav, navToWorkout, setNav } from './nav.js'

let calls
beforeEach(() => {
  calls = []
  setNav((...args) => { calls.push(args) })
  history.replaceState(null, '', '#/home')
})

describe('nav', () => {
  it('passes the router its options', () => {
    nav('/plan', { replace: true })
    nav('/stats')
    expect(calls).toEqual([['/plan', { replace: true }], ['/stats']])
  })

  it('a closing sheet hands its history entry to the next page', () => {
    history.pushState({ openGymSheet: true }, '')
    const close = vi.fn()
    closeThenNav(close, '/settings/workout')
    expect(close).toHaveBeenCalledOnce()
    expect(calls).toEqual([['/settings/workout', { replace: true }]])
  })

  it('pushes when the entry is not a sheet\'s (it was spent already)', () => {
    closeThenNav(() => {}, '/home')
    expect(calls).toEqual([['/home']])
  })

  it('starting from the routine chooser replaces its #/workout', () => {
    history.replaceState(null, '', '#/workout')
    navToWorkout()
    expect(calls).toEqual([['/workout', { replace: true }]])
  })

  it('starting through the weigh-in sheet replaces the sheet\'s entry', () => {
    history.pushState({ openGymSheet: true }, '')
    navToWorkout()
    expect(calls).toEqual([['/workout', { replace: true }]])
  })

  it('starting from Home pushes, so back returns there', () => {
    navToWorkout()
    expect(calls).toEqual([['/workout']])
  })
})
