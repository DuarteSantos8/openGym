// Home's Today row at 320px: the routine name shared ~120px with the mini body map and the Start
// tag, so even "Push Day" wrapped in ru (night QA 10-19). Below 360px the map steps aside; wider
// screens keep it, and the name still clamps to two lines with an ellipsis.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe("Home's Today row on a narrow phone", () => {
  it('hides the mini body map below 360px only', () => {
    const narrow = [...css.matchAll(/@media \(max-width:(\d+)px\)\{([\s\S]*?)\n\}/g)]
      .filter(m => /\.today-row \.bm-mini-wrap\{display:none\}/.test(m[2]))
    expect(narrow).toHaveLength(1)
    expect(+narrow[0][1]).toBe(359)
    // Nowhere outside that query is the map hidden.
    const outside = css.replace(narrow[0][0], '')
    expect(outside).not.toMatch(/\.today-row \.bm-mini-wrap\{[^}]*display:none/)
  })

  it('still clamps the name to two lines', () => {
    const rule = css.match(/\.today-row \.ttl\{([^}]*)\}/)?.[1] || ''
    expect(rule).toMatch(/line-clamp:2/)
    expect(rule).toMatch(/text-overflow:ellipsis/)
  })
})
