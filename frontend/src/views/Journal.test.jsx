// @vitest-environment happy-dom
// gm-journal (1.4.5): Stats → More → Journal, one feed of every note, with filters and folders.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Journal from './Journal.jsx'
import { DEF, useStore } from '../store/useStore.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))

let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null })

function mount(patch = {}) {
  const S = clone(DEF)
  Object.assign(S, {
    workouts: [
      { id: 'a', d: '2026-10-01', start: 1, name: 'Push', note: 'Slept badly', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true, note: 'shoulder pinch' }] }] },
      { id: 'b', d: '2026-11-01', start: 2, name: 'Legs', entries: [{ id: '0043', note: 'Knees happy', sets: [] }] },
    ],
    measurements: [{ d: '2026-10-15', t: 1, waist: 80, note: 'After the holidays' }],
    journalFolders: { f: { name: 'Shoulder', filter: { q: 'shoulder' }, _ts: 1 } },
  }, patch)
  useStore.setState({ S, user: null })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Journal /></MemoryRouter>))
}
const rows = () => [...container.querySelectorAll('.jn-row .jn-text')].map(e => e.textContent)
const chip = text => [...container.querySelectorAll('.chip')].find(c => c.textContent.includes(text))

describe('Journal', () => {
  it('lists every note newest first, grouped by month', () => {
    mount()
    expect(rows()).toEqual(['Knees happy', 'After the holidays', 'Slept badly', 'shoulder pinch'])
    expect(container.querySelectorAll('.jn-group')).toHaveLength(2)
  })
  it('a kind chip narrows the feed, a folder applies its saved filter', () => {
    mount()
    act(() => chip('Set notes').click())
    expect(rows()).toEqual(['shoulder pinch'])
    act(() => chip('Set notes').click())
    act(() => chip('Shoulder').click())
    expect(rows()).toEqual(['shoulder pinch'])
    act(() => chip('All notes').click())
    expect(rows()).toHaveLength(4)
  })
  it('says so when nothing is written yet', () => {
    mount({ workouts: [], measurements: [], journalFolders: {} })
    expect(container.textContent).toContain('Nothing written down yet')
  })
})
