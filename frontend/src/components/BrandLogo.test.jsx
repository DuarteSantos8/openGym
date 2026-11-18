// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import BrandLogo, { BrandMark } from './BrandLogo.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}

afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })

describe('Ironvane brand', () => {
  it('renders the Ironvane wordmark, not the old openGym lockup', () => {
    const page = mount(<BrandLogo />)
    expect(page.textContent).toBe('Ironvane')
    expect(page.textContent).not.toContain('openGym')
    expect(page.querySelector('.ironvane-lockup-iron')?.textContent).toBe('Iron')
    expect(page.querySelector('.ironvane-lockup-vane')?.textContent).toBe('vane')
    expect(page.querySelectorAll('rect')).toHaveLength(0)
    expect(page.querySelectorAll('path')).toHaveLength(2)
  })

  it('keeps the SVG decorative and the product name as readable text', () => {
    const page = mount(<BrandLogo as="span" />)
    const svg = page.querySelector('svg')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(page.querySelector('.ironvane-lockup').getAttribute('dir')).toBe('ltr')
    expect(page.querySelector('.ironvane-lockup').textContent).toBe('Ironvane')
    expect(page.querySelector('.ironvane-lockup').style.fontSize).toBe('2.125rem')
  })

  it('uses Ironvane orange by default and preserves the standalone mark API', () => {
    const page = mount(<BrandMark height={30} />)
    const svg = page.querySelector('svg')
    expect(svg.getAttribute('fill')).toBe('#ff6b2c')
    expect(svg.getAttribute('viewBox')).toBe('0 0 284 174')
    expect(svg.getAttribute('height')).toBe('30')
    expect(Number(svg.getAttribute('width'))).toBeCloseTo(30 * 284 / 174)

    const custom = mount(<BrandMark color="#123456" className="custom-mark" />)
    expect(custom.querySelector('svg').getAttribute('fill')).toBe('#123456')
    expect(custom.querySelector('svg').classList.contains('custom-mark')).toBe(true)
  })
})
