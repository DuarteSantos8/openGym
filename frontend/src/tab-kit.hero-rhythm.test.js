// The hero's vertical rhythm belongs to the shell: the hero takes a top pad from --hero-pad-top
// (shorter right under the WeekStrip, past the sr-only status line DayNav renders between them),
// owns no bottom space inside a TabSection, and the ⋯ follows the same variable. At every width
// the metrics take back the column the ⋯ reserves.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const css = readFileSync(join(resolve(process.cwd(), 'src'), 'tab-kit.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const flat = css.replace(/\s+/g, ' ')

describe('tab-kit.css hero rhythm', () => {
  it('defaults the top pad and shortens it under the week strip, with or without the status line between', () => {
    expect(flat).toContain(':root{--hero-pad-top:var(--space-11)}')
    expect(flat).toContain('.wk-strip+.tab-sec,.wk-strip+.sr-only+.tab-sec{--hero-pad-top:var(--space-6)}')
  })

  it('pads the hero from the variable and drops its bottom pad inside a section', () => {
    expect(flat).toContain('.hero{display:flex;flex-direction:column;align-items:center;gap:var(--space-2);padding-block:var(--hero-pad-top) var(--space-11)')
    expect(flat).toContain('.tab-sec>.hero{padding-bottom:0}')
    expect(flat).toContain('.tab-sec>.act-row{padding-top:0}')
    expect(flat).toMatch(/\.hero-a\{position:absolute;top:var\(--hero-pad-top\)/)
  })

  it('gives the ⋯ column back to the metrics and the P/C/F line at every width', () => {
    expect(flat).toContain('.hero-has-a>.hero-m,.hero-has-a>.hero-macros{margin-inline:calc(-1 * (var(--hdr-btn) + var(--space-2)))}')
    expect(flat).toContain('.hero-has-a>.hero-m{width:auto;align-self:stretch}')
    expect(flat).not.toContain('@media (width<340px)')
  })
})
