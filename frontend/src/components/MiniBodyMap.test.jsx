// @vitest-environment happy-dom
// The routine thumbnail: shaded like the big map, hidden from screen readers, nothing for an empty routine.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import MiniBodyMap from './MiniBodyMap.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const render = async el => { await act(async () => { root.render(el) }); for (let i = 0; i < 100 && host.querySelector('.bm-ph'); i++) await act(async () => { await new Promise(r => setTimeout(r, 20)) }) }

describe('MiniBodyMap', () => {
  it('shows the muscles a routine hits, out of the screen reader\'s way', async () => {
    await render(<MiniBodyMap routines={[{ ex: [{ id: 'bench', sets: 3, muscleWeights: { chest: 1, triceps: 0.4 } }] }]} body="male" />)
    const wrap = host.querySelector('.bm-mini-wrap')
    expect(wrap).not.toBeNull()
    expect(wrap.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelectorAll('.bm-m.l4').length).toBeGreaterThan(0)
  })
  it('adds up several routines of one day', async () => {
    await render(<MiniBodyMap routines={[{ ex: [{ id: 'bench', sets: 3, muscleWeights: { chest: 1, triceps: 0.4 } }] }, { ex: [{ id: 'squat', sets: 3, muscleWeights: { quadriceps: 1, gluteal: 0.5 } }] }]} body="male" />)
    expect(host.querySelectorAll('.bm-m.l4, .bm-m.l3').length).toBeGreaterThan(1)
  })
  it('renders nothing for a routine without exercises', async () => {
    await render(<MiniBodyMap routines={[{ ex: [] }]} body="male" />)
    expect(host.innerHTML).toBe('')
  })
})
