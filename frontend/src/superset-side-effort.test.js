// The RIR stepper on a unilateral row inside a superset (issue #60 / 1.2). happy-dom and
// linkedom apply neither media queries nor layout, so — like list-columns.test.js and
// android-system-bars.test.js — this reads the rule out of index.css as text.
//
// The regression: at the narrow widths where a superset nests three insets deep, the effort
// cell used to DROP its −/+ buttons (display:none) and hand the freed width to an already
// oversized weight column. A unilateral set is logged per side, so the rating is the field you
// reach for most; it must keep the same +/- stepper a normal exercise row has, with the weight
// column paying for it instead.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

// The inside of one @media block, by brace depth (same helper shape as list-columns.test.js).
function mediaBody(query) {
  const at = css.indexOf(`@media ${query}{`)
  expect(at, query).toBeGreaterThanOrEqual(0)
  let depth = 0
  const open = css.indexOf('{', at)
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  throw new Error('unclosed ' + query)
}

// The block that governs an L/R row in a superset in the list view: wide enough that the row's
// three insets still leave room to shuffle width between columns (below 360px every row, normal
// ones included, drops its effort +/- — that is the shared narrow-screen behaviour, not this bug).
const body = mediaBody('(max-width:429px)')

// A declaration block for one of the superset per-side selectors, by the text that targets it.
const declsFor = needle => {
  const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const hit = rules.find(m => m[1].includes(needle) && m[1].includes('.ss-card') && m[1].includes('.setrow.side'))
  return hit ? hit[2] : null
}

describe('a superset L/R row keeps its RIR +/- stepper', () => {
  it('does not hide the effort +/- buttons the way it used to', () => {
    const effortButtons = declsFor('effcell-stp>button')
    expect(effortButtons, 'the effort +/- rule for a superset L/R row should exist').toBeTruthy()
    // the bug was `display:none` on these buttons; now they stay, just shrunk to a floor
    expect(effortButtons).not.toMatch(/display\s*:\s*none/)
    expect(effortButtons).toMatch(/min-width\s*:\s*\d+px/)
  })

  it('gives the effort cell room for the value plus both buttons, not a bare value', () => {
    const cell = declsFor('.effcell-stp,') || declsFor('.effcell,')
    expect(cell, 'the effort cell min-width rule should exist').toBeTruthy()
    const min = Number(cell.match(/min-width\s*:\s*(\d+)px/)?.[1])
    // 28px value + two button floors + borders; the old collapsed value-only floor was 34px
    expect(min).toBeGreaterThanOrEqual(50)
  })

  it('reclaims that width from the weight column instead', () => {
    // the weight cell for these rows gives up reserve (--num) and/or button floor inside the
    // same media block, so the row total is unchanged and still fits
    const weight = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .find(m => m[1].includes('.ss-card') && m[1].includes('.stp.w') && /--num|--btn-floor/.test(m[2]))
    expect(weight, 'the weight column should shrink to pay for the effort stepper').toBeTruthy()
  })
})
