// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import ProgressPhotos from './ProgressPhotos.jsx'
import { isoOf } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* #949/#950: the gallery's line on top, the chart, the month grid with a date on every photo, and
   picking up to nine for a comparison. */
const ref = n => ({ kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', size: 10, width: 3, height: 4, at: 1 })
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return isoOf(d) }

let host, root
beforeEach(() => {
  localStorage.clear()
  const dayPhotos = {}
  for (let i = 1; i <= 11; i++) dayPhotos[ref(i).hash] = { d: ago(3 + i * 9), m: ref(i), _ts: 1 }
  useStore.setState({ S: { ...structuredClone(DEF), workouts: [], dayPhotos }, user: null, ready: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter><ProgressPhotos /></MemoryRouter>))
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll?.() })
const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent === label || b.getAttribute('aria-label') === label)

describe('progress-photo gallery', () => {
  it('says how long since the last photo, draws the chart, and cuts the grid into months', () => {
    expect(host.querySelector('.pp-nudge').textContent).toContain('Last photo: 12 days ago.')
    expect(host.textContent).toContain('Photo days (last 12 months)')
    expect(host.querySelectorAll('.pp-tile')).toHaveLength(11)
    expect(host.querySelectorAll('.pp-tile .pp-tile-date')).toHaveLength(11)
    expect(host.querySelectorAll('.pp-month').length).toBeGreaterThanOrEqual(3)
    expect(btn('Take photo')).toBeTruthy()
    expect(btn('Add photos')).toBeTruthy()
  })
  it('keeps the header to the title, and puts Add photos and Take photo, then Compare, under the chart', () => {
    expect(host.querySelector('.hdr').textContent).not.toContain('Compare')
    const labels = [...host.querySelectorAll('.pp-actions button')].map(b => b.textContent)
    expect(labels).toEqual(['Add photos', 'Take photo', 'Compare'])
    const kids = [...host.children].map(c => c.className)
    expect(kids.findIndex(c => c.includes('pp-activity'))).toBeLessThan(kids.findIndex(c => c.includes('pp-actions')))
    expect(host.textContent).not.toContain('Check-in reminder')
  })
  it('swaps to Confirm and Cancel, pinned, while picking; Confirm waits for two photos', () => {
    act(() => btn('Compare').click())
    const bar = host.querySelector('.pp-actions')
    expect(bar.classList.contains('stick')).toBe(true)
    expect([...bar.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Confirm', 'Cancel'])
    expect(host.querySelector('.pp-cap')).not.toBeNull()
    expect(btn('Confirm').disabled).toBe(true)
    const tiles = [...host.querySelectorAll('.pp-tile')]
    act(() => tiles[0].click()); act(() => tiles[1].click())
    expect(btn('Confirm').disabled).toBe(false)
    act(() => btn('Cancel').click())
    expect([...host.querySelectorAll('.pp-actions button')].map(b => b.textContent)).toEqual(['Add photos', 'Take photo', 'Compare'])
    expect(host.querySelector('.pp-cap')).toBeNull()
  })
  it('picks up to nine to compare, numbered in tap order', () => {
    act(() => btn('Compare').click())
    const tiles = [...host.querySelectorAll('.pp-tile')]
    act(() => tiles[0].click())
    for (let i = 1; i < 10; i++) act(() => tiles[i].click())
    expect(host.querySelectorAll('.pp-selected')).toHaveLength(9)
    expect(tiles[0].querySelector('.pp-check').textContent).toBe('1')
    expect(useUI.getState().toastMsg).toBe('Up to 9 photos at once.')
    act(() => btn('Confirm').click())
    expect(useUI.getState().sheets.at(-1).kind).toBe('viewer')
  })
})
