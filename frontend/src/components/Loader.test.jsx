// @vitest-environment happy-dom
/* The loader and the loading line: the brand mark (an SVG cropped to the G, so the G fills the box
 * the loader is sized to) with its stroke animated in CSS, decoration only; and the line that pairs
 * it with its words as one live status. The animation and its reduced-motion stop are CSS, so they
 * are checked in the stylesheet, which is what the browser runs. */
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MARK } from '../lib/brand-mark.js'
import { Loader, Loading, LoadingList } from './Loader.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, host
const draw = el => act(() => root.render(el))
const css = readFileSync(join(process.cwd(), 'src', 'ui-kit.css'), 'utf8')

beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('Loader', () => {
  it('is the brand mark, decoration only, medium by default', () => {
    draw(<Loader />)
    const svg = host.querySelector('svg')
    expect(svg.getAttribute('class')).toBe('brand-mark loader loader-md')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('canvas')).toBeNull()
  })

  it('takes a size and a class', () => {
    draw(<Loader size="lg" className="here" />)
    expect(host.querySelector('svg').getAttribute('class')).toBe('brand-mark loader loader-lg here')
  })

  it('the G fills the box at every size: the viewBox is the G\'s own extent, not the 100 box', () => {
    expect(MARK.box).toBe('21.8 21.8 56.4 56.4')
    for (const size of ['xs', 'sm', 'md', 'lg', 'icon']) {
      draw(<Loader size={size} />)
      expect(host.querySelector('svg').getAttribute('viewBox'), size).toBe(MARK.box)
    }
  })

  it('the stroke is one path of pathLength 1, so a dash offset is a fraction of the G', () => {
    draw(<Loader />)
    const path = host.querySelector('path.mark-path')
    expect(path.getAttribute('pathLength')).toBe('1')
    expect(path.getAttribute('d')).toBe(MARK.centre)
  })

  it('has a size in the stylesheet for each size, and icon is the 24px glyph size', () => {
    for (const [size, px] of [['xs', 14], ['sm', 20], ['md', 32], ['lg', 48]]) {
      expect(css, size).toContain(`.loader-${size}.loader-${size}.loader-${size}{width:${px}px;height:${px}px}`)
    }
    expect(css).toContain('.loader-icon.loader-icon.loader-icon{width:var(--glyph);height:var(--glyph)}')
    expect(css).toMatch(/--glyph:24px/)
  })

  it('animates the dash offset 1, 0, -1 over 2.4 s, and stops on the whole G for reduced motion (device and app)', () => {
    expect(css).toMatch(/\.loader \.mark-path\{stroke-dasharray:1 1;stroke-dashoffset:0;animation:loader-draw 2\.4s infinite\}/)
    expect(css).toMatch(/@keyframes loader-draw\{\s*0%\{stroke-dashoffset:1;[^}]*\}\s*44%\{stroke-dashoffset:0\}\s*56%\{stroke-dashoffset:0;[^}]*\}\s*100%\{stroke-dashoffset:-1\}/)
    expect(css).toContain('@media (prefers-reduced-motion:reduce){.loader .mark-path{animation:none;stroke-dashoffset:0}}')
    expect(css).toContain('html[data-motion=reduce] .loader .mark-path{animation:none;stroke-dashoffset:0}')
  })
})

describe('LoadingList', () => {
  it('is skeleton rows in one live status, named, with no loader in it', () => {
    draw(<LoadingList label="Loading foods" />)
    const status = host.querySelector('[role="status"]')
    expect(status.getAttribute('aria-label')).toBe('Loading foods')
    expect(status.querySelectorAll('.loadrow')).toHaveLength(3)
    expect(status.querySelectorAll('.skel').length).toBeGreaterThan(3)
    expect(status.querySelector('.loader')).toBeNull()
  })

  it('says Loading… by default and takes a row count', () => {
    draw(<LoadingList rows={5} />)
    expect(host.querySelector('[role="status"]').getAttribute('aria-label')).toBe('Loading…')
    expect(host.querySelectorAll('.loadrow')).toHaveLength(5)
  })
})

describe('Loading', () => {
  it('is one live status: the loader and the words', () => {
    draw(<Loading />)
    const line = host.querySelector('[role="status"]')
    expect(line.className).toBe('loadline')
    expect(line.textContent).toBe('Loading…')
    expect(line.querySelector('svg.loader.loader-sm').getAttribute('aria-hidden')).toBe('true')
    expect(line.hasAttribute('aria-label')).toBe(false)
  })

  it('says what it is asked to say', () => {
    draw(<Loading>Loading Coach status…</Loading>)
    expect(host.querySelector('[role="status"]').textContent).toBe('Loading Coach status…')
  })

  it('inline sits in a sentence, with the small loader, and keeps the classes it is given', () => {
    draw(<Loading inline className="muted small">Fetching</Loading>)
    const line = host.querySelector('[role="status"]')
    expect(line.className).toBe('loadline loadline-inline muted small')
    expect(line.querySelector('svg').getAttribute('class')).toContain('loader-xs')
  })

  it('without words it is named by its label, so it is still announced', () => {
    draw(<Loading label="Loading photos">{null}</Loading>)
    const line = host.querySelector('[role="status"]')
    expect(line.getAttribute('aria-label')).toBe('Loading photos')
    expect(line.querySelector('span')).toBeNull()
  })
})
