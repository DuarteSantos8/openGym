// @vitest-environment happy-dom
// Stats in four parts with a sticky index (redesign 1.4.5, P5): one page, each part with its
// heading, an index that jumps there and writes the part into the address.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit',
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const start = Date.now() - 2 * 86400000
const workout = { id: 'w1', d: new Date(start).toISOString().slice(0, 10), start, end: start + 3600000, name: 'Push',
  entries: [{ id: '0025', target: { id: '0025', sets: 1, reps: 5 }, sets: [{ w: 60, r: 5, done: true }] }] }
let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); window.history.replaceState(null, '', '#/') })
function mount() {
  mocks.S = { body: 'male', effort: 'none', unit: 'kg', targetW: null, bodyweight: [], routines: [], exWeights: {}, workouts: [workout] }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
const index = () => [...host.querySelectorAll('.stats-index .seg button')]

describe('Stats sections (P5)', () => {
  it('groups the cards into parts with headings, the tour anchors inside them', () => {
    mount()
    const parts = index().map(b => b.textContent)
    expect(parts.slice(0, 3)).toEqual(['Overview', 'Body', 'Lifts'])
    // every part but the first has its heading, and Effort is offered only when its part is there
    expect([...host.querySelectorAll('.stats-sect-h')].map(h => h.textContent)).toEqual(parts.slice(1))
    expect(!!host.querySelector('#stats-effort')).toBe(parts.includes('Effort'))
    expect(host.querySelector('#stats-overview [data-tour="stats-tiles"]')).toBeTruthy()
    expect(host.querySelector('#stats-lifts [data-tour="stats-records"]')).toBeTruthy()
    expect(host.querySelector('#stats-body [data-tour="stats-measure"]')).toBeTruthy()
  })
  it('a tap marks the part, scrolls to it and puts it in the address', () => {
    window.history.replaceState(null, '', '#/stats')
    mount()
    const into = vi.fn()
    host.querySelector('#stats-lifts').scrollIntoView = into
    act(() => index()[2].click())
    expect(index()[2].getAttribute('aria-pressed')).toBe('true')
    expect(into).toHaveBeenCalled()
    expect(window.location.hash).toBe('#/stats?section=lifts')
    act(() => index()[0].click())
    expect(window.location.hash).toBe('#/stats')
  })
  it('opens on the part the address names', () => {
    window.history.replaceState(null, '', '#/stats?section=body')
    mount()
    expect(index()[1].getAttribute('aria-pressed')).toBe('true')
  })
  it('leaves the highlight alone while a sheet pins the page (it jumped to the last part)', async () => {
    window.history.replaceState(null, '', '#/stats')
    mount()
    document.body.style.position = 'fixed'
    await act(async () => { window.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 60)) })
    expect(index()[0].getAttribute('aria-pressed')).toBe('true')
    document.body.style.position = ''
    await act(async () => { window.dispatchEvent(new Event('scroll')); await new Promise(r => setTimeout(r, 60)) })
    // unpinned, the spy reads the page again (here every part sits at the top, so the last wins)
    expect(index().at(-1).getAttribute('aria-pressed')).toBe('true')
  })
})
