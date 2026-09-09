// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Stretching from './Stretching.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container
let root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('stretching section', () => {
  it('renders every guide and its local image in the dedicated route', () => {
    act(() => root.render(<MemoryRouter initialEntries={['/stretching']}><Stretching /></MemoryRouter>))

    expect(container.querySelector('h1').textContent).toBe('Stretching')
    expect(container.querySelectorAll('article.stretch-card')).toHaveLength(12)
    expect(container.querySelectorAll('img.stretch-image')).toHaveLength(12)
    expect([...container.querySelectorAll('img.stretch-image')].every(img => img.src.endsWith('.png'))).toBe(true)
    expect(container.querySelector('img.stretch-image').getAttribute('alt')).toContain('Stand tall')
    expect(container.querySelector('img.stretch-image').getAttribute('loading')).toBe('lazy')
    expect(container.querySelector('img.stretch-image').getAttribute('decoding')).toBe('async')
    expect(container.querySelector('img.stretch-image').getAttribute('data-resolution')).toBe('1K')
    expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
  })

  it('shows a visible fallback when a local image cannot load', () => {
    act(() => root.render(<MemoryRouter initialEntries={['/stretching']}><Stretching /></MemoryRouter>))

    act(() => container.querySelector('img.stretch-image').dispatchEvent(new Event('error')))

    expect(container.querySelector('.stretch-image-fallback').textContent).toBe('Image unavailable')
    expect(container.querySelector('.stretch-image-fallback').getAttribute('role')).toBe('img')
  })
})
