// @vitest-environment happy-dom
// Settings → Modules on Stats: Body, Effort, Motivation and Strength levels each take their parts
// (and their place in the index) with them when off, and bring them back when on.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { presetModules } from '../lib/modules.js'
import Stats from './Stats.jsx'

const mocks = vi.hoisted(() => ({ S: null }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ S: mocks.S }) }))
vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: () => {}, goalSheet: () => {}, calendarSheet: () => {}, workoutDetailSheet: () => {}, exerciseHistorySheet: () => {},
  WorkoutRow: () => null, bwDeltaColor: () => 'inherit', weighInsSheet: () => {},
}))
vi.mock('../components/LineChart.jsx', () => ({ default: () => null }))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null, BodyMapLegend: () => null }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const day = n => { const t = Date.now() - n * 86400000; return { t, d: new Date(t).toISOString().slice(0, 10) } }
const workout = (n, rir) => { const { t, d } = day(n); return { id: 'w' + n, d, start: t, end: t + 3600000, name: 'Push',
  entries: [{ id: '0025', target: { id: '0025', sets: 1, reps: 5 }, sets: [{ w: 60 + n, r: 5, rir, done: true }] }] } }
let root, host
afterEach(() => { act(() => root.unmount()); host.remove(); window.history.replaceState(null, '', '#/') })
function mount(modules) {
  mocks.S = { body: 'male', effort: 'rir', unit: 'kg', targetW: null, bodyweight: [{ d: day(1).d, w: 80, t: day(1).t }], routines: [], exWeights: {},
    workouts: [workout(9, 2), workout(6, 1), workout(3, 2), workout(1, 1)], modules }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Stats />))
}
const parts = () => [...host.querySelectorAll('.stats-index .seg button')].map(b => b.textContent)
const kpis = () => [...host.querySelectorAll('.kpis .tile .l')].map(e => e.textContent)
const links = () => [...host.querySelectorAll('[data-stats-links] .lrow-t')].map(e => e.textContent)

describe('Stats follows the modules', () => {
  it('Everything: Body and Effort in the index, the weight tile, the streak, the links under Body', () => {
    mount(undefined)
    expect(parts()).toEqual(['Overview', 'Body', 'Lifts', 'Effort'])
    expect(kpis()).toContain('Weight 30d')
    expect(host.querySelector('#stats-body [data-stats-links]')).toBeTruthy()
    expect(links()).toContain('Body measurements')
    expect(host.querySelector('.kpis.two')).toBeFalsy()
  })

  it('Just training: no Body, no Effort, no streak; Structural balance moves to the end of Lifts', () => {
    mount(presetModules('training'))
    // Effort stays in "Just training": the part is there
    expect(parts()).toEqual(['Overview', 'Lifts', 'Effort'])
    expect(host.querySelector('#stats-body')).toBeFalsy()
    expect(kpis()).not.toContain('Weight 30d')
    expect(host.querySelector('.kpis.two')).toBeTruthy()
    expect(host.querySelector('#stats-lifts [data-stats-links]')).toBeTruthy()
    expect(links()).toEqual(['Structural balance'])
  })

  it('Effort off takes its part and the effort chart away; on brings them back', () => {
    mount({ effort: false })
    expect(parts()).not.toContain('Effort')
    expect(host.querySelector('#stats-effort')).toBeFalsy()
    expect(host.textContent).not.toMatch(/RIR \d/)
    mount({ effort: true })
    expect(parts()).toContain('Effort')
  })
})
