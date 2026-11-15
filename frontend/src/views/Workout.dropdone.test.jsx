// @vitest-environment happy-dom
// Discord, dark._.ninja: a drop set ticked done greyed its main row, but its drops (and a
// rest-pause set's bursts) stayed bright as if still to do. They carry the row's done state now.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Workout from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const SQUAT = '0043'

let root, container
beforeEach(() => { useUI.setState({ sheets: [], toastMsg: '', timer: null, work: null }) })
afterEach(() => {
  if (root) act(() => root.unmount())
  if (container) container.remove()
  root = container = null
})

function mount(sets) {
  const S = clone(DEF)
  S.workoutView = 'list'
  S.active = { id: 'drop-done', d: '2026-11-04', start: Date.now(), routineId: null, name: 'Drops', bw: null, cur: 0, entries: [{ id: SQUAT, target: { sets: sets.length, reps: 8 }, sets }], workoutView: 'list' }
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

describe('drops and bursts of a done set', () => {
  it('are marked done with their set, and stay open while it is open', () => {
    mount([
      { w: 100, r: 8, done: true, type: 'dropset', drops: [{ w: 80, r: 8 }, { w: 60, r: 8 }] },
      { w: 100, r: 8, done: false, type: 'dropset', drops: [{ w: 80, r: 8 }] },
      { w: 100, r: 8, done: true, type: 'restpause', clusters: [{ r: 3, restSec: 15 }] },
    ])
    const subs = [...container.querySelectorAll('.subrow')]
    expect(subs.map(el => el.classList.contains('done'))).toEqual([true, true, false, true])
  })

  it('the stylesheet greys them like the row', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    expect(css).toMatch(/\.subrow\.done>\*\{opacity:\.6\}/)
  })
})
