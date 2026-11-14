// @vitest-environment happy-dom
// bwDeltaColor keeps its old colours for existing callers; with `ink` it returns the text-safe
// ones (--acc-ink / --red-ink) that pass 4.5:1 on the light theme. Goal direction is unchanged.
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { useStore } from './store/useStore.js'
import { bwDeltaColor } from './sheets.jsx'

const setGoal = targetW => useStore.setState(s => ({ S: { ...s.S, targetW } }))
beforeEach(() => setGoal(75))

describe('bwDeltaColor', () => {
  it('old callers: accent toward the goal, red away', () => {
    expect(bwDeltaColor(-0.5, 82)).toBe('var(--acc)')
    expect(bwDeltaColor(0.5, 82)).toBe('var(--red)')
  })
  it('ink: toward the goal (losing, goal below)', () => { expect(bwDeltaColor(-0.5, 82, true)).toBe('var(--acc-ink)') })
  it('ink: away from the goal', () => { expect(bwDeltaColor(0.5, 82, true)).toBe('var(--red-ink)') })
  it('ink: gaining toward a higher goal', () => { setGoal(90); expect(bwDeltaColor(0.5, 82, true)).toBe('var(--acc-ink)') })
  it('ink: no goal and no change keep their neutral colours', () => {
    setGoal(null); expect(bwDeltaColor(0.5, 82, true)).toBe('var(--label)')
    expect(bwDeltaColor(0, 82, true)).toBe('var(--label-2)')
  })
})

const lum = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2] }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05) }
describe('light-theme ink contrast on a white card', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
  it('--red-ink and every light --acc-ink pass 4.5:1', () => {
    const inks = [...css.matchAll(/data-theme="light"\](?:\[data-accent="\w+"\])?\s*\{\s*--(?:acc|red)-ink:(#[0-9a-f]{6})/gi)].map(m => m[1])
    expect(inks.length).toBeGreaterThanOrEqual(8)
    for (const h of inks) expect(ratio(h, '#ffffff'), h).toBeGreaterThanOrEqual(4.5)
  })
})
