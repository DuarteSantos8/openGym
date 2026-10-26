// @vitest-environment happy-dom
// The real pieces together: the real Workout view, the real Modals with its scroll restore, the
// real useUI and the real effort picker. Rating a set in a superset closes the picker AND ticks
// the set in one tap, so the sheet's restore and the card's "bring the partner's row into view"
// are asked for in the same commit. Each half is tested alone elsewhere with the other mocked;
// only both together show the order they land in, and the order is the bug.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout from './Workout.jsx'
import Modals from '../components/Modals.jsx'
import { useUI } from '../store/useUI.js'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/sound.js', async importOriginal => ({
  ...(await importOriginal()), beep: vi.fn(), chime: vi.fn(), unlock: vi.fn(), vibrate: vi.fn(),
}))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.resolve({})), IS_APPLE: false, IS_ANDROID: false, BIO: 'biometrics',
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../components/Media.jsx', () => ({ default: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, originalS, scrolls, rafs

const row = () => ({ w: 60, r: 5, done: false })
const entry = (id, sg) => ({ id, sg, target: { mode: 'reps', sets: 2, reps: 5, weight: 60, bodyweight: false }, sets: [row(), row()] })

// The restore window is module state in Modals.jsx, kept as a time. Each test's fake clock starts
// a minute past the previous one's, so a sheet an earlier test closed is long done.
let clock = Date.now()

beforeEach(() => {
  vi.useFakeTimers({ now: clock += 60_000 })
  originalS = useStore.getState().S
  scrolls = []
  rafs = []

  window.scrollTo = vi.fn(() => scrolls.push('scrollTo'))
  window.requestAnimationFrame = fn => { rafs.push(fn); return rafs.length }
  window.cancelAnimationFrame = () => {}
  Element.prototype.scrollIntoView = vi.fn(function () { scrolls.push(this) })

  const S = JSON.parse(JSON.stringify(DEF))
  S.workoutView = 'cards'
  S.effort = 'rir'
  S.restSec = 90
  S.sound = false
  // Bench and squat as one superset card, then a row press on its own.
  const A = {
    id: 'a', name: 'Test', start: Date.now(), cur: 0,
    entries: [entry('0025', 'g'), entry('0043', 'g'), entry('0001')],
  }
  useStore.setState({ S, A, user: null })
  useUI.setState({ sheets: [], timer: null, work: null, toastMsg: '' })

  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [] })
  useStore.setState({ S: originalS, A: null })
  document.body.style.position = ''
  vi.useRealTimers()
})

const mount = async () => {
  await act(async () => { root.render(<><Workout /><Modals /></>) })
}
const click = async el => {
  expect(el).toBeTruthy()
  await act(async () => { el.dispatchEvent(new window.Event('click', { bubbles: true })) })
}
const runFrames = async () => {
  const queued = rafs
  rafs = []
  await act(async () => { queued.forEach(fn => fn()) })
}

describe('rating a superset set closes a sheet and moves the marker in one tap', () => {
  it('scrolls to the partner row after the sheet has finished putting the page back', async () => {
    await mount()
    const partnerRow = () => host.querySelectorAll('.setrow')[2]

    // The RIR cell of the first set of the first exercise.
    await click(host.querySelector('.setrow .effcell.is-empty'))
    expect(useUI.getState().sheets.length).toBe(1)
    expect(document.body.style.position).toBe('fixed')       // the page is pinned behind the sheet
    await runFrames()
    scrolls.length = 0

    // Pick a level: the sheet closes, the set is ticked and the marker moves to the partner.
    await click(document.querySelector('.effpick .item.menu-item'))
    expect(useUI.getState().sheets.length).toBe(0)
    expect(useStore.getState().A.entries[0].sets[0].done).toBe(true)
    expect(useStore.getState().A.cur).toBe(1)
    expect(scrolls).toEqual(['scrollTo'])                    // the un-pin's restore, nothing else yet

    await runFrames()
    expect(scrolls).toEqual(['scrollTo', 'scrollTo'])         // the next-frame re-assert

    await act(async () => { vi.advanceTimersByTime(349) })
    expect(scrolls).toEqual(['scrollTo', 'scrollTo'])         // still nothing of the card's
    await act(async () => { vi.advanceTimersByTime(3) })

    // The card's scroll comes STRICTLY after the last restore, onto the partner's row.
    expect(scrolls).toEqual(['scrollTo', 'scrollTo', partnerRow()])

    // And nothing undoes it afterwards.
    await runFrames()
    await act(async () => { vi.advanceTimersByTime(1000) })
    expect(scrolls.filter(s => s === 'scrollTo')).toHaveLength(2)
    expect(scrolls.at(-1)).toBe(partnerRow())
  })

  it('a plain tick still scrolls to the partner row at once', async () => {
    await mount()
    scrolls.length = 0
    await click(host.querySelector('[role="checkbox"]'))
    expect(useStore.getState().A.cur).toBe(1)
    expect(scrolls).toEqual([host.querySelectorAll('.setrow')[2]])
  })
})
