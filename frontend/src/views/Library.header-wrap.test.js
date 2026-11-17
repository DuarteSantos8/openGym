import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Full QA 146: with the Community button (LIBRARY=on) the Library header held three buttons in a row
// that could not wrap: at 360 px "By muscle" broke in two and Ladders ran off the screen.
describe('the Library header buttons', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  const jsx = readFileSync(resolve(process.cwd(), 'src/views/Library.jsx'), 'utf8')
  it('wrap as a row and keep each label on one line', () => {
    expect(jsx).toContain('className="row lib-hdr-btns"')
    // Unscoped: on the iPhone the row sits outside .hdr.lib-hdr.
    expect(css).toMatch(/\n\.lib-hdr-btns\{flex-wrap:wrap;row-gap:6px;min-width:0\}/)
    expect(css).toMatch(/\n\.lib-hdr-btns \.btn\{white-space:nowrap\}/)
  })
  it('Plan\'s header actions stay one row in the iPhone nav too', () => {
    expect(css).toMatch(/\.hdr>\.hdr-actions,\.gh \.hdr-actions\{display:flex/)
  })
})
