// Settings > Workout > Live widget after its rework (1.4.5): the moments are a segmented control
// that fits, the surfaces wrap like the kinds do, the stage steps back when the widget is off on
// this phone, and nothing of the old chip strip or the old "Try it" button is left in the sheet.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = sel => { const i = css.indexOf('\n' + sel + '{'); return i < 0 ? '' : css.slice(i + 1, css.indexOf('}', i) + 1) }

describe('live widget settings at phone width', () => {
  it('a long surface or moment name wraps inside its own segment (“Dynamic Island” with three tabs)', () => {
    const r = rule('.gl-surface button span,.gl-moments button span')
    expect(r).toMatch(/min-width:0/)
    expect(r).toMatch(/overflow-wrap:anywhere/)
    expect(r).toMatch(/hyphens:auto/)
    expect(rule('.gl-surface button,.gl-moments button')).toMatch(/padding-inline:4px/)
  })
  it('the moments keep a full-size target though the segment is 36px tall', () => {
    expect(rule('.gl-moments button')).toMatch(/min-height:36px/)
    // 36 + 4 above + 4 below = 44.
    expect(rule('.gl-moments button::before')).toMatch(/inset:-4px 0/)
  })
  it('the chip strip and the old button are gone', () => {
    expect(css).not.toMatch(/\.gl-samples?\b/)
    expect(css).not.toMatch(/\.gl-try \.btn/)
  })
  it('off on this phone: the drawing fades to 40 %, the word stays readable', () => {
    expect(rule('.gl-stage.off>:not(.gl-off)')).toMatch(/opacity:\.4/)
    expect(rule('.gl-stage>:not(.gl-off)')).toMatch(/transition:opacity 200ms/)
    expect(rule('.gl-off')).toMatch(/color:var\(--label\)/)
  })
  it('a short screen lets the preview scroll away, and a focused row never hides under it', () => {
    expect(css).toMatch(/@media \(max-height:599px\)\{\.gl-sticky\{position:static\}\}/)
    expect(rule('.gl-settings .lrow,.gl-settings .seg')).toMatch(/scroll-margin-top:calc\(var\(--gl-stuck,280px\) \+ 8px\)/)
  })
  it('a part that joins the card fades in from 96 %, and only fades with reduced motion', () => {
    const start = css.match(/@starting-style\{\.gl-settled [^{]*\{([^}]*)\}/)?.[1] || ''
    expect(start).toMatch(/opacity:0/)
    expect(start).toMatch(/transform:scale\(\.96\)/)
    expect(css).toMatch(/180ms cubic-bezier\(\.23,1,\.32,1\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion:reduce\)\{\s*@starting-style\{\.gl-settled [^{]*\{transform:none\}/)
  })
  it('a missing still is a quiet tile, not a white square', () => {
    expect(rule('.gl-still-none,.gl-and-img.gl-still-none')).toMatch(/background:var\(--gl-btn\)/)
  })
})
