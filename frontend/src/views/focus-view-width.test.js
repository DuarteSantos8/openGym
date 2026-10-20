import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// #655: with nine sets the pager's dots were 9 × 44px wide, and since a grid track's minimum is its
// widest child's min-content, that widened the whole focus card past the screen — the badges and
// the superset line then laid out on one line beyond the right edge. happy-dom does no layout, so
// the rules that keep the card to the screen are checked as written.
const css = readFileSync(resolve(process.cwd(), 'src/views/FocusView.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = sel => css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'))?.[1] || ''

describe('the focus card stays as wide as the screen', () => {
  it('the view is one column that can shrink below its content', () => {
    expect(rule('.focus-view')).toMatch(/grid-template-columns:minmax\(0,1fr\)/)
  })

  it('the pager gives the dots only the room between the arrows', () => {
    expect(rule('.focus-pager')).toMatch(/grid-template-columns:44px minmax\(0,1fr\) 44px/)
    expect(rule('.focus-dots')).toMatch(/min-width:0/)
  })

  it('the dots share that room instead of keeping 44px each', () => {
    const dot = rule('.focus-dots button')
    expect(dot).toMatch(/flex:0 1 44px/)
    expect(dot).toMatch(/min-width:0/)
    expect(dot).not.toMatch(/(^|;)width:44px/)
  })
})
