import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Night QA 146: Sets / Reps / Weight abreast at 320 px clipped "72.5" to "72.".
describe('the exercise settings steppers at 320 px', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  it('three abreast get narrower buttons below 360px, the four-up row keeps its own wrap', () => {
    expect(css).toMatch(/@media \(max-width:359px\)\{\.cfgrow:not\(\.cfgrow-4\) \.stp button\{width:22px\}\}/)
  })
})
