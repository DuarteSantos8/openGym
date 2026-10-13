// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import HomeMascot from './HomeMascot.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
afterEach(() => {
  if (root) act(() => root.unmount())
  host?.remove()
  root = null
  host = null
})

describe('home mascot on mobile-sized pages', () => {
  it('mounts at the document level, not inside the route container', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(<HomeMascot />))

    expect(host.querySelector('.home-mascot')).toBeNull()
    const image = document.body.querySelector('img.home-mascot')
    expect(image).not.toBeNull()
    expect(image.getAttribute('src')).toMatch(/sumrak\/idle\.gif$/)
  })

  it('shows the static image if the animation fails to load', () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(<HomeMascot />))

    const image = document.body.querySelector('img.home-mascot')
    act(() => image.dispatchEvent(new Event('error')))
    expect(image.getAttribute('src')).toMatch(/sumrak\/idle\.png$/)
  })
})
