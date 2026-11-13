// Android back after a sheet that closes and moves on (#/workout ⋯ > Workout settings > All
// settings, Finish > Nice!, Start > a routine): the sheet's history entry, or the chooser's
// #/workout, stayed under the new page, so one back press landed on the same screen and seemed
// to do nothing.
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { afterSheets, closeThenNav, nav, navToWorkout, setNav } from './nav.js'

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

  it('afterSheets goes at once on a page, and after the sheet entry is gone on a sheet', () => {
    const go = vi.fn()
    afterSheets(go)
    expect(go).toHaveBeenCalledTimes(1)
    history.pushState({ openGymSheet: true }, '')
    afterSheets(go)
    expect(go).toHaveBeenCalledTimes(1)
    history.replaceState(null, '', '#/home')   // the sheet's step back landed
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(go).toHaveBeenCalledTimes(2)   // once, not per popstate
  })

  // CodeRabbit on #1050: no blind step back while a sheet is still up, and none from a page moved on to.
  it('afterSheets waits while a sheet is up and never goes from another page', () => {
    vi.useFakeTimers()
    try {
      const go = vi.fn()
      history.pushState({ openGymSheet: true }, '')
      afterSheets(go)
      vi.advanceTimersByTime(600)
      expect(go).not.toHaveBeenCalled()
      history.replaceState(null, '', '#/library')   // closeThenNav took the sheet's entry for another page
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(go).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  // CodeRabbit on #1050: a detail page left another way (closeThenNav) drops its wait, or a later
  // Back onto the same URL would run it and skip the page.
  it('afterSheets can be cancelled when the page is left another way', () => {
    const go = vi.fn()
    history.pushState({ openGymSheet: true }, '')
    const cancel = afterSheets(go)
    cancel()
    history.replaceState(null, '', '#/home')
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(go).not.toHaveBeenCalled()
  })
})
