// Android back after a sheet that closes and moves on (#/train/workout ⋯ > Workout settings > All
// settings, Finish > Nice!, Start > a routine): the sheet's history entry, or the chooser's
// #/train/workout, stayed under the new page, so one back press landed on the same screen and
// seemed to do nothing.
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { closeThenNav, closeThenReplace, nav, navToWorkout, noteSheetEntries, setNav } from './nav.js'

let calls
beforeEach(() => {
  calls = []
  setNav((...args) => { calls.push(args) })
  history.replaceState(null, '', '#/home')
})

describe('nav', () => {
  it('passes the router its options', () => {
    nav('/train/routines', { replace: true })
    nav('/progress')
    expect(calls).toEqual([['/train/routines', { replace: true }], ['/progress']])
  })

  it('a closing sheet hands its history entry to the next page', () => {
    history.pushState({ gainsSheet: true }, '')
    const close = vi.fn()
    closeThenNav(close, '/me/workout')
    expect(close).toHaveBeenCalledOnce()
    expect(calls).toEqual([['/me/workout', { replace: true }]])
  })

  it('pushes when the entry is not a sheet\'s (it was spent already)', () => {
    closeThenNav(() => {}, '/home')
    expect(calls).toEqual([['/home']])
  })

  describe('closeThenReplace', () => {
    it('replaces the page at once when no sheet entry sits on it', () => {
      const close = vi.fn()
      closeThenReplace(close, '/progress/body/photos')
      expect(close).toHaveBeenCalledOnce()
      expect(calls).toEqual([['/progress/body/photos', { replace: true }]])
    })

    it('waits for the sheet\'s entry to be walked off, then replaces the page under it', () => {
      history.pushState({ gainsSheet: true }, '')
      noteSheetEntries(1)
      const close = vi.fn()
      closeThenReplace(close, '/progress/body/photos')
      expect(close).toHaveBeenCalledOnce()
      expect(calls).toEqual([])
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(calls).toEqual([['/progress/body/photos', { replace: true }]])
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(calls).toHaveLength(1)
      noteSheetEntries(0)
    })

    it('replaces anyway when the walk-off never comes', () => {
      vi.useFakeTimers()
      history.pushState({ gainsSheet: true }, '')
      noteSheetEntries(1)
      closeThenReplace(() => {}, '/progress/body/photos')
      vi.advanceTimersByTime(500)
      expect(calls).toEqual([['/progress/body/photos', { replace: true }]])
      window.dispatchEvent(new PopStateEvent('popstate'))
      expect(calls).toHaveLength(1)
      noteSheetEntries(0)
      vi.useRealTimers()
    })
  })

  it('starting from the routine chooser replaces its #/train/workout', () => {
    history.replaceState(null, '', '#/train/workout')
    navToWorkout()
    expect(calls).toEqual([['/train/workout', { replace: true }]])
  })

  it('starting through the weigh-in sheet replaces the sheet\'s entry', () => {
    history.pushState({ gainsSheet: true }, '')
    navToWorkout()
    expect(calls).toEqual([['/train/workout', { replace: true }]])
  })

  it('starting from Home pushes, so back returns there', () => {
    navToWorkout()
    expect(calls).toEqual([['/train/workout']])
  })
})
