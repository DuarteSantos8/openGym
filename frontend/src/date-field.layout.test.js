// A date field ran off the right edge of the screen on iPhone Safari (#940): the browser gives
// <input type="date"> a width of its own that ignores width:100%. The fix was first written for one
// container (.measure-date) and the photo viewer's new day field, in another, had the bug again,
// so the rule is on every date .field, and this keeps it from being scoped down to one place.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = sel => css.match(new RegExp('(?:^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}'))?.[1] || ''

describe('date fields stay inside the screen (#940)', () => {
  it('takes the browser\'s own width away from every date .field', () => {
    const r = rule('input[type=date].field')
    expect(r).toMatch(/min-width:0/)
    expect(r).toMatch(/max-width:100%/)
    expect(r).toMatch(/-webkit-appearance:none/)
  })

  it('does not hang that rule on a container, which is how it was missed in the photo viewer', () => {
    expect(css).not.toMatch(/\.measure-date input\[type=date\]\{/)
  })
})
