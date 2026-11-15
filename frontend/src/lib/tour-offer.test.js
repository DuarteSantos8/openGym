// @vitest-environment happy-dom
// P1 (1.4.5 UX round): the first-run question waits for an idle app. It used to open 1.2 s after
// the first screen whatever was going on, and a tap on "Load starter plan" in that moment put
// the sheet underneath it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { tourState, closeTour, readTour, markOffered, noteStep } from './tour.js'
import { watchTourOffer, offerDue, offerBlocked, OFFER_SETTLE_MS, OFFER_QUIET_MS } from './tour-offer.js'

let stop = null
let S0
const fresh = () => useStore.setState(st => ({ user: null, S: { ...st.S, active: null, workouts: [] } }))
const tick = async ms => { await vi.advanceTimersByTimeAsync(ms) }
const fire = type => window.dispatchEvent(new Event(type))

beforeEach(async () => {
  // The hashchange of this line arrives on a real timer: it is over before a test starts.
  if (window.location.hash !== '#/home') { window.location.hash = '#/home'; await new Promise(r => setTimeout(r, 40)) }
  vi.useFakeTimers()
  localStorage.clear()
  S0 = useStore.getState().S
  fresh()
})
afterEach(() => {
  stop?.(); stop = null
  closeTour()
  useUI.getState().closeAll()
  useStore.setState({ S: S0 })
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('the first-run question waits for an idle app', () => {
  it('someone who just sits on Home gets it after the settle wait, exactly once', async () => {
    const asked = vi.fn()
    stop = watchTourOffer({ onAsked: asked })
    await tick(OFFER_SETTLE_MS - 10)
    expect(tourState()).toBe(null)
    await tick(20)
    expect(tourState()).toEqual({ kind: 'offer' })
    expect(asked).toHaveBeenCalledTimes(1)
    // answered (the card marks it), closed: a second watch has nothing left to ask
    markOffered(); closeTour()
    expect(offerDue()).toBe(null)
    stop = watchTourOffer({ onAsked: asked })
    await tick(10000)
    expect(tourState()).toBe(null)
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('a sheet opened in that moment keeps it away, and it comes once the sheet is closed and things are quiet', async () => {
    stop = watchTourOffer()
    await tick(OFFER_SETTLE_MS - 100)
    fire('pointerdown'); fire('pointerup')
    const sheet = useUI.getState().openSheet(() => null)
    await tick(5000)
    expect(tourState()).toBe(null)
    sheet.close()
    await tick(OFFER_QUIET_MS - 100)
    expect(tourState()).toBe(null)       // just closed: not yet
    await tick(OFFER_QUIET_MS)
    expect(tourState()).toEqual({ kind: 'offer' })
  })

  it('a tap, a key or a scroll just before pushes it back by the quiet time', async () => {
    stop = watchTourOffer()
    await tick(OFFER_SETTLE_MS - 50)
    fire('pointerdown'); fire('pointerup')
    await tick(OFFER_QUIET_MS - 100)
    expect(tourState()).toBe(null)
    fire('scroll')
    await tick(OFFER_QUIET_MS - 100)
    expect(tourState()).toBe(null)
    fire('keydown')
    await tick(OFFER_QUIET_MS - 100)
    expect(tourState()).toBe(null)
    await tick(300)
    expect(tourState()).toEqual({ kind: 'offer' })
  })

  it('waits while a finger is down, a field has the keyboard, or a viewer is open', async () => {
    expect(offerBlocked({ at: Date.now() - 2000, down: 1 })).toBe('finger')
    expect(offerBlocked({ at: Date.now() - 60000, down: 1 })).toBe('')       // a release we never heard of
    const input = document.body.appendChild(document.createElement('input'))
    input.focus()
    expect(offerBlocked(null)).toBe('field')
    input.blur()
    const viewer = document.body.appendChild(document.createElement('div'))
    viewer.setAttribute('aria-modal', 'true')
    expect(offerBlocked(null)).toBe('dialog')
    viewer.remove()
    expect(offerBlocked(null)).toBe('')
    expect(offerBlocked({ at: Date.now() - 100, down: 0 })).toBe('busy')
  })

  it('never during a workout, and a logged workout ends the question for good', async () => {
    stop = watchTourOffer()
    useStore.setState(st => ({ S: { ...st.S, active: { id: 'w', entries: [] } } }))
    await tick(20000)
    expect(tourState()).toBe(null)
    expect(offerDue()).toBe(null)
    expect(offerBlocked(null)).toBe('workout')
    useStore.setState(st => ({ S: { ...st.S, active: null, workouts: [{ id: 'w1', date: '2026-11-01', entries: [] }] } }))
    stop(); stop = watchTourOffer()
    await tick(20000)
    expect(tourState()).toBe(null)
    // on the workout screen without a session (it redirects): still not there
    fresh(); window.location.hash = '#/workout'
    expect(offerBlocked(null)).toBe('workout')
  })

  it('the chunk is fetched first, and a tap during the fetch sends it back to waiting', async () => {
    let done
    const preload = vi.fn(() => new Promise(r => { done = r }))
    stop = watchTourOffer({ preload })
    await tick(OFFER_SETTLE_MS + 10)
    expect(preload).toHaveBeenCalledTimes(1)
    expect(tourState()).toBe(null)
    const sheet = useUI.getState().openSheet(() => null)
    done(); await tick(10)
    expect(tourState()).toBe(null)
    sheet.close()
    done = null
    await tick(OFFER_QUIET_MS * 2 + 100)
    done?.(); await tick(10)
    expect(tourState()).toEqual({ kind: 'offer' })
  })

  it('a tour closed halfway is offered to finish the same way', async () => {
    noteStep('lib-search')
    expect(offerDue()).toEqual({ kind: 'resume', at: 'lib-search' })
    stop = watchTourOffer()
    const sheet = useUI.getState().openSheet(() => null)
    await tick(4000)
    expect(tourState()).toBe(null)
    sheet.close()
    await tick(OFFER_QUIET_MS * 2 + 100)
    expect(tourState()).toEqual({ kind: 'resume', at: 'lib-search' })
    expect(readTour().at).toBe('lib-search')
  })
})
