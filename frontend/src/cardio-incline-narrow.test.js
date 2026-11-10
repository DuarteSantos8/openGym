// A cardio row with the incline at 320px: three steppers pushed the tick past the card's edge
// (found while adding the effort chip, QOL Q5). Below 360px the incline drops its −/+ and keeps
// the typed number, like the effort column; wider screens keep the buttons.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const jsx = readFileSync(resolve(process.cwd(), 'src/views/Workout.jsx'), 'utf8')

describe('the incline column on a narrow phone', () => {
  it('loses its buttons below 360px only, and its header narrows with it', () => {
    const narrow = [...css.matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)].filter(m => /\.setrow \.stp\.inc:not\(\.plain\)>button\{display:none\}/.test(m[2]))
    expect(narrow).toHaveLength(1)
    expect(+narrow[0][1]).toBe(359)
    expect(narrow[0][2]).toMatch(/\.setrow \.stp\.inc,\.sethead \.inc-sp\{--btn-floor:0px\}/)
    expect(css.replace(narrow[0][0], '')).not.toMatch(/\.stp\.inc[^{]*>button\{display:none/)
    expect(jsx).toContain("'r-sp inc-sp'")
    expect(jsx).toContain("cell(s, i, col3, 'r inc')")
  })
})

// Full QA 146: a cardio row with the incline is an eff3 row, which sized its middle column for a
// reps count; at 360 and 375 px the speed "10.5" read "10.!". A decimal middle column is wider.
describe('the speed column of a cardio row with the incline', () => {
  it('is marked decimal on the row and the header, and gets the wider number width', () => {
    expect(jsx).toContain("cell(s, i, col2, col2.dec ? 'r dec' : 'r')")
    expect(jsx).toContain("className={col2.dec ? 'r-sp dec' : 'r-sp'}")
    expect(css).toMatch(/\.setrow\.eff3 \.stp\.r\.dec,\.sethead\.eff3 \.r-sp\.dec\{--num:calc\(36px \* var\(--num-k\)\)\}/)
  })
})
