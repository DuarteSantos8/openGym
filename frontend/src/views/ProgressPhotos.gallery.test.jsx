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
  it('picks up to nine to compare, numbered in tap order', () => {
    act(() => btn('Compare').click())
    const tiles = [...host.querySelectorAll('.pp-tile')]
    act(() => tiles[0].click())
    expect(host.querySelector('.pp-cta')).toBeNull()
    for (let i = 1; i < 10; i++) act(() => tiles[i].click())
    expect(host.querySelectorAll('.pp-selected')).toHaveLength(9)
    expect(tiles[0].querySelector('.pp-check').textContent).toBe('1')
    expect(useUI.getState().toastMsg).toBe('Up to 9 photos at once.')
    act(() => btn('Compare 9 photos').click())
    expect(useUI.getState().sheets.at(-1).kind).toBe('viewer')
  })
})
