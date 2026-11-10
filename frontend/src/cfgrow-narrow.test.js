import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Night QA 146: Sets / Reps / Weight abreast at 320 px clipped "72.5" to "72.".
describe('the exercise settings steppers at 320 px', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  it('three abreast get narrower buttons below 360px, the four-up row keeps its own wrap', () => {
    expect(css).toMatch(/@media \(max-width:359px\)\{\.cfgrow:not\(\.cfgrow-4\) \.stp button\{width:min\(22px, calc\(30px \/ var\(--text-k, 1\)\)\)\}\}/)
  })
  // Full QA 146: at Text size Largest on a 360 px phone the Tools RPE row clipped "108" to "10".
  it('at the bigger text sizes the buttons give width back and the number stops growing past Large', () => {
    expect(css).toMatch(/\.cfgrow \.stp button\{width:min\(30px, calc\(30px \/ var\(--text-k, 1\)\)\)\}/)
    expect(css).toMatch(/\.cfgrow \.stp \.num\{font-size:min\(var\(--fs-body\), calc\(17px \* 1\.12\)\)\}/)
  })
  it('a long exercise name on the Tools chips stays inside its card', () => {
    expect(css).toMatch(/\.tools-chips \.chip\{flex:none;max-width:100%;display:inline-flex\}/)
    expect(css).toMatch(/\.tools-chips \.chip>span\{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/)
  })
})
