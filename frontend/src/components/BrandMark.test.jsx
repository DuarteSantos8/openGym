// @vitest-environment happy-dom
/* The G as the app draws it (BrandMark), and the copy of it index.html draws before any script runs:
 * the same two paths, so the first frame and the first React frame are one picture. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import BrandMark, { BootMark, MARK } from './BrandMark.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
let root, host
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })
const draw = el => act(() => root.render(el))

describe('BrandMark', () => {
  it('is an SVG cropped to the letter, sized by the text around it, and decorative by default', () => {
    draw(<BrandMark />)
    const svg = host.querySelector('svg.brand-mark')
    expect(svg.getAttribute('viewBox')).toBe(MARK.box)
    expect([svg.getAttribute('width'), svg.getAttribute('height')]).toEqual(['1em', '1em'])
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.hasAttribute('role')).toBe(false)
  })

  it('is an image with a name when it is given one', () => {
    draw(<BrandMark label="Gains" />)
    const svg = host.querySelector('svg')
    expect(svg.getAttribute('role')).toBe('img')
    expect(svg.getAttribute('aria-label')).toBe('Gains')
    expect(svg.hasAttribute('aria-hidden')).toBe(false)
  })

  it('draws the ring and bar in the text colour, with the groove cut out by a mask', () => {
    draw(<BrandMark />)
    const stroke = host.querySelector('path[mask]')
    expect(stroke.getAttribute('d')).toBe(MARK.centre)
    expect(stroke.getAttribute('stroke')).toBe('currentColor')
    expect(stroke.getAttribute('stroke-width')).toBe(String(MARK.width))
    const mask = host.querySelector('mask')
    expect(stroke.getAttribute('mask')).toBe(`url(#${mask.id})`)
    expect(mask.querySelector('path').getAttribute('d')).toBe(MARK.groove)
    expect(mask.querySelector('path').getAttribute('stroke-width')).toBe(String(MARK.grooveWidth))
  })

  it('gives each mark its own mask, so two on a page cannot share (or lose) one', () => {
    draw(<><BrandMark /><BrandMark /></>)
    const ids = [...host.querySelectorAll('mask')].map(m => m.id)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every(id => /^[\w-]+$/.test(id))).toBe(true)
  })

  it('adds a class without losing its own', () => {
    draw(<BrandMark className="big-one" />)
    expect(host.querySelector('svg').getAttribute('class')).toBe('brand-mark big-one')
  })
})

describe('BootMark and the first frame', () => {
  it('is the mark in the place the splash holds it', () => {
    draw(<BootMark />)
    expect(host.querySelector('.boot-mark > svg.brand-mark')).not.toBeNull()
  })

  it('index.html draws the same geometry', () => {
    const html = readFileSync(join(FRONTEND, 'index.html'), 'utf8')
    expect(html).toContain(`d="${MARK.centre}"`)
    expect(html).toContain(`d="${MARK.groove}"`)
    expect(html).toContain(`viewBox="${MARK.box}"`)
    expect(html).toContain(`stroke-width="${MARK.width}"`)
    expect(html).toContain(`stroke-width="${MARK.grooveWidth}"`)
  })

  it('the style sheet gives the mask its two colours', () => {
    const css = readFileSync(join(FRONTEND, 'src', 'ui-kit.css'), 'utf8')
    expect(css).toMatch(/\.brand-mark \.mark-keep\{fill:var\(--mark-cut-on\)\}/)
    expect(css).toMatch(/\.brand-mark \.mark-cut\{stroke:var\(--mark-cut-off\)\}/)
    expect(css).toMatch(/--mark-cut-on:#fff;\s*--mark-cut-off:#000;/)
  })
})
