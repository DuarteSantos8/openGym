// @vitest-environment happy-dom
// gm-tools (1.4.5): Stats → More → Tools, filled in from the log.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Tools from './Tools.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { estimate1RM } from '../lib/onerm.js'
import { dots } from '../lib/calculators.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null })

function mount(patch = {}) {
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', sex: 'male' }, patch)
  const wo = (d, id, w, r) => ({ id: d + id, d, start: new Date(d + 'T17:00:00').getTime(), entries: [{ id, target: { mode: 'reps', sets: 1, reps: r }, sets: [{ w, r, done: true }] }] })
  S.workouts = [wo('2026-10-01', '0043', 140, 5), wo('2026-10-02', '0025', 100, 5), wo('2026-10-03', '0032', 180, 5), wo('2026-10-04', '0025', 100, 3)]
  S.bodyweight = [{ d: '2026-10-04', w: 90 }]
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Tools /></MemoryRouter>))
}

describe('Tools page', () => {
  it('fills the % table from the most logged lift and the scores from the big three', () => {
    mount()
    const pct = container.querySelector('[aria-labelledby="tools-pct"]')
    expect(pct.querySelector('.chip.on').textContent.toLowerCase()).toContain('bench')
    const first = pct.querySelector('tbody tr')
    // 100 × 5 Epley is 116.7, which a 2.5 kg grid loads as 115.
    expect(estimate1RM(100, 5)).toBe(116.7)
    expect(first.textContent).toContain('115')
    const total = Math.round((estimate1RM(140, 5) + estimate1RM(100, 5) + estimate1RM(180, 5)) * 2) / 2
    const tiles = [...container.querySelectorAll('[aria-labelledby="tools-scores"] .tile')]
    expect(tiles[0].textContent).toContain(String(Math.round(dots(total, 90) * 10) / 10))
  })
  it('asks for a height before the body numbers, and uses one when stored', () => {
    mount()
    expect(container.querySelector('[aria-labelledby="tools-body"]').textContent).toContain('Add your height once')
    act(() => root.unmount()); container.remove(); root = null
    mount({ heightCm: 180 })
    const body = container.querySelector('[aria-labelledby="tools-body"]')
    expect(body.querySelector('.tile').textContent).toContain('27.8')
  })
  it('works out a pace', () => {
    mount()
    expect(container.querySelector('[aria-labelledby="tools-pace"] .tools-big').textContent).toBe('5:00 /km')
  })
})
