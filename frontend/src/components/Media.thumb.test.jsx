// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// A still that will not load (offline and never cached, a lapsed session on a gated instance)
// gets the neutral tile an exercise without media has, not the browser's broken-image glyph (#281).
vi.mock('../store/useStore.js', () => ({ useStore: () => null }))
const { Thumb } = await import('./Media.jsx')

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return { host, root }
}
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('Thumb', () => {
  it('shows the still, and the neutral tile once it fails to load', () => {
    const { host } = mount(<Thumb ex={{ id: 'a', img: 'a.jpg' }} />)
    const img = host.querySelector('img.thumb')
    expect(img.getAttribute('src')).toMatch(/a\.jpg$/)
    act(() => { img.dispatchEvent(new Event('error')) })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.thumb.thumb-x')).toBeTruthy()
  })

  it('another exercise in the same place tries its own still', () => {
    const { host, root } = mount(<Thumb ex={{ id: 'a', img: 'a.jpg' }} />)
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')) })
    act(() => root.render(<Thumb ex={{ id: 'b', img: 'b.jpg' }} />))
    expect(host.querySelector('img.thumb').getAttribute('src')).toMatch(/b\.jpg$/)
  })

  it('an exercise without media has the tile from the start', () => {
    const { host } = mount(<Thumb ex={{ id: 'c' }} />)
    expect(host.querySelector('.thumb-x')).toBeTruthy()
  })

  it('the tile is the line art of what the exercise is done with', () => {
    const scene = ex => mount(<Thumb ex={ex} />).host.querySelector('.thumb-x > svg.lineart')
    expect(scene({ id: 'c', eq: 'barbell' }).dataset.scene).toBe('equipment')
    // each piece of equipment draws its own: a barbell's two plates, the mat for bodyweight
    expect(scene({ id: 'c', eq: 'barbell' }).querySelectorAll('rect.il-occ')).toHaveLength(2)
    expect(scene({ id: 'd', eq: 'body weight' }).querySelectorAll('rect')).toHaveLength(1)
    expect(scene({ id: 'e' }).querySelectorAll('rect')).toHaveLength(1)
  })

  it('a still that fails falls back to its equipment too', () => {
    const { host } = mount(<Thumb ex={{ id: 'a', img: 'a.jpg', eq: 'cable' }} />)
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')) })
    expect(host.querySelector('.thumb-x circle.il-occ')).toBeTruthy()
  })
})
