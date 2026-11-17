import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Full QA 146 still applies after the approved layout moved these destinations out of the header:
// Community, By muscle, Ladders and Cards/List wrap under More, with every label kept on one line.
describe('the Library secondary destination buttons', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/views/Library.css'), 'utf8')
  const jsx = readFileSync(resolve(process.cwd(), 'src/views/Library.jsx'), 'utf8')
  it('wrap under More and keep each label on one line', () => {
    expect(jsx).toContain('className="iv-lib-more-actions"')
    expect(css).toMatch(/\.iv-lib-more-actions\{display:flex;flex-wrap:wrap;gap:8px/)
    expect(css).toMatch(/\.iv-lib-more-actions \.btn\{[^}]*white-space:nowrap/)
    expect(css).toMatch(/\.iv-lib-more-actions \.ex-view-btn\.with-label\{[^}]*white-space:nowrap/)
  })
})

// Review fixes on the approved layout (PR #39): the CSS cannot be laid out in jsdom, so these pin
// the rules that keep the controls clear of each other.
describe('the Library layout rules', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/views/Library.css'), 'utf8')
  it('lifts the Add action above a running rest timer, phone and desktop, auto row included', () => {
    expect(css).toMatch(/body\.resting \.iv-lib-primary\{bottom:calc\(88px \+ 5\.5rem \+ var\(--sab\)\)\}/)
    expect(css).toMatch(/body\.resting:has\(#timer\.auto\) \.iv-lib-primary\{bottom:calc\(142px/)
    expect(css).toMatch(/@media \(min-width:1000px\)\{[^@]*body\.resting \.iv-lib-primary\{bottom:calc\(112px/)
  })
  it('keeps the phone thumbnail size to list rows, so Cards keep their full-width pictures', () => {
    expect(css).toMatch(/\.iv-library \.list:not\(\.ex-grid\) \.iv-lib-row \.thumb\{width:56px;height:56px\}/)
    expect(css).not.toMatch(/\.iv-library \.iv-lib-row \.thumb\{/)
  })
  it('moves the result count in past the enlarged Clear button', () => {
    expect(css).toMatch(/\.iv-library \.search\.has-clear \.search-count\{inset-inline-end:60px\}/)
    expect(css).toMatch(/\.iv-library \.search\.has-count\.has-clear \.input\{padding-inline-end:114px\}/)
  })
})
