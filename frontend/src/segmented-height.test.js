// Segmented controls were 30px tall app-wide (Stats tabs, CSV range, cardio mode; night QA 10-19),
// under the 32px the rest of the controls keep. The inline variant in list rows stays compact.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('segmented control height', () => {
  it('gives every segment at least 32px', () => {
    const rule = css.match(/\n\.seg button\{([^}]*)\}/)?.[1] || ''
    expect(rule).toMatch(/min-height:32px/)
  })
  it('keeps the inline one in list rows as it was', () => {
    expect(css.match(/\.seg-inline button\{([^}]*)\}/)?.[1]).toMatch(/min-height:28px/)
  })
})
