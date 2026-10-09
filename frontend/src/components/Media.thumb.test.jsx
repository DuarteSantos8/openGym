// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Built-in stills try local first, then CDN, and use a neutral tile when neither loads.
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
  const CDN = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/'

  it('shows the local still, tries the CDN on failure, then uses the neutral tile', () => {
    const { host } = mount(<Thumb ex={{ id: 'a', img: 'a.jpg' }} />)
    const img = host.querySelector('img.thumb')
    expect(img.getAttribute('src')).toBe('img/a.jpg')
    act(() => { img.dispatchEvent(new Event('error')) })
    expect(host.querySelector('img.thumb').getAttribute('src')).toBe(CDN + 'a.jpg')
    act(() => { host.querySelector('img.thumb').dispatchEvent(new Event('error')) })
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('.thumb.thumb-x')).toBeTruthy()
  })

  it('another exercise in the same place tries its own still', () => {
    const { host, root } = mount(<Thumb ex={{ id: 'a', img: 'a.jpg' }} />)
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')) })
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')) })
    act(() => root.render(<Thumb ex={{ id: 'b', img: 'b.jpg' }} />))
    expect(host.querySelector('img.thumb').getAttribute('src')).toBe('img/b.jpg')
  })

  it('keeps a successful local still when the same exercise renders again', () => {
    const ex = { id: 'a', img: 'a.jpg' }
    const { host, root } = mount(<Thumb ex={ex} />)
    act(() => { host.querySelector('img').dispatchEvent(new Event('load')) })
    act(() => root.render(<Thumb ex={ex} />))
    expect(host.querySelector('img.thumb').getAttribute('src')).toBe('img/a.jpg')
  })

  it('starts a changed image locally even when its exercise id stays the same', () => {
    const { host, root } = mount(<Thumb ex={{ id: 'a', img: 'a.jpg' }} />)
    act(() => { host.querySelector('img').dispatchEvent(new Event('error')) })
    act(() => root.render(<Thumb ex={{ id: 'a', img: 'b.jpg' }} />))
    expect(host.querySelector('img.thumb').getAttribute('src')).toBe('img/b.jpg')
  })

  it('an exercise without media has the tile from the start', () => {
    const { host } = mount(<Thumb ex={{ id: 'c' }} />)
    expect(host.querySelector('.thumb-x')).toBeTruthy()
  })
})
