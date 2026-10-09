import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('the own colour swatch takes the tap', () => {
  // QA round 2 (2026-10-06): the selection ring (.swatch.on::after) lay over the invisible colour
  // input, so once an own colour was set a tap on its swatch never opened the picker.
  it('the selection ring lets taps through to the colour input under it', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = css.match(/\.swatch\.on::after\{([^}]*)\}/)?.[1] || ''
    expect(rule).toMatch(/position:absolute/)
    expect(rule).toMatch(/pointer-events:none/)
  })
})
