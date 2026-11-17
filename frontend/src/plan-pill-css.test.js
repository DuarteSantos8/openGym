// The Plan pill (Starred, New) clears a running rest timer and stays opaque under Reduce Transparency.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('plan pill css', () => {
  it('sits above the rest timer while one runs', () => {
    expect(css).toMatch(/body\.resting \.plan-pill\{bottom:calc\(166px \+ var\(--sab\)\)\}/)
  })
  it('the Reduce Transparency override comes after the base pill rule', () => {
    const base = css.indexOf('\n.plan-pill{')
    const over = css.lastIndexOf('.plan-pill{-webkit-backdrop-filter:none')
    expect(base).toBeGreaterThan(0)
    expect(over).toBeGreaterThan(base)
  })
})
