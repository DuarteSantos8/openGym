// Reduce Motion (html.reduce-motion or the OS setting): the held row keeps riding the finger but has
// no tilt, scale, shadow or slide, only a plain outline, and the dashed slot still shows.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const rule = sel => css.split('\n').find(l => l.startsWith(sel))

describe('drag look under Reduce Motion', () => {
  it('html.reduce-motion: outline, no tilt or shadow, no transform transition', () => {
    const lifted = rule('.reduce-motion .drag-row.is-lifted .drag-in{')
    expect(lifted).toContain('outline:2px solid var(--label)')
    expect(lifted).toContain('transform:translateY(var(--dy))')
    expect(lifted).toContain('box-shadow:none')
    expect(lifted).not.toMatch(/scale|rotate/)
    expect(rule('.reduce-motion .drag-row.is-lifted::before')).toMatch(/transition:none/)
  })
  it('the OS setting does the same', () => {
    const m = css.split('\n').find(l => l.startsWith('@media (prefers-reduced-motion:reduce){.drag-row.is-lifted .drag-in'))
    expect(m).toContain('outline:2px solid var(--label)')
    expect(m).toMatch(/transition:none/)
  })
  it('the dashed slot is not hidden: the held row is moved off it', () => {
    expect(rule('.drag-row.is-lifted::before{')).toContain('border:2px dashed')
  })
})
