// QA 1.4.5: at text size Largest on a 360 px phone a per-side set's weight read "12.!". Below 400 px
// its numbers had a rem font (×1.4 at Largest) in a fixed 41 px field; every other set row stops
// growing its numbers at Large (--num-k). The L/R rows follow the same cap now.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('per-side set numbers on a narrow phone', () => {
  it('cap their font and size their fields with the text like every set row', () => {
    expect(css).toContain('.setrow-side .setrow.side .stp .num{font-size:min(.875rem, calc(14px * var(--num-k)))}')
    expect(css).toContain('.setrow-side .setrow.side .stp.w,.sethead.per-side .w-sp{--num:calc(41px * var(--num-k))}')
    expect(css).toContain('.setrow-side .setrow.side .stp.r,.sethead.per-side .r-sp{--num:calc(30px * var(--num-k))}')
    // the 320 px notch has no room to grow at all: 13 px at most
    expect(css).toContain('.setrow-side .setrow.side.eff3 .stp .num{font-size:min(var(--fs-footnote), 13px)}')
    expect(css).not.toMatch(/\.setrow-side \.setrow\.side \.stp \.num\{font-size:\.875rem\}/)
  })
})
