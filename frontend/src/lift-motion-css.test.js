// The drag lift's Reduce Motion form is written twice in index.css (the class and the media query),
// and neither lets the lifted row tilt, scale, cast a shadow layer or transition.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('long-press drag, Reduce Motion', () => {
  it('has the class form and the media-query form', () => {
    for (const pre of ['.reduce-motion ', '@media (prefers-reduced-motion:reduce){']) {
      const at = css.indexOf(pre + '.drag-row.is-lifted .drag-in{')
      expect(at).toBeGreaterThan(-1)
      const rule = css.slice(at, css.indexOf('}', at))
      expect(rule).toMatch(/scale:none/)
      expect(rule).toMatch(/rotate:none/)
      expect(rule).toMatch(/transition:none/)
    }
  })
  it('keeps the lift on scale and rotate, never box-shadow transitions', () => {
    expect(css).toMatch(/\.drag-row\.is-lifted \.drag-in\{[^}]*scale:1\.03;rotate:1deg/)
    expect(css).not.toMatch(/transition:[^;}]*box-shadow[^;}]*\.35/)
  })
})
