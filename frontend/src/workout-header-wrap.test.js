// The workout header's clock and set count ("0:02 · 0/19 подходов") sits next to the Finish pill.
// In ru/uk at phone width a one-line ellipsis cut exactly the 0/19; the line may wrap to two now.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('the workout header subtitle', () => {
  it('wraps to a second line instead of cutting the set count', () => {
    const rule = css.match(/\.whdr-mid \.sub\{([^}]*)\}/)?.[1] || ''
    expect(rule).not.toBe('')
    expect(rule).not.toMatch(/nowrap/)
    expect(rule).not.toMatch(/text-overflow:ellipsis/)
    expect(rule).toMatch(/line-clamp:2/)
  })
})
