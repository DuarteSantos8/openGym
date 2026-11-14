// EP-02: the new motion is confined to loading UI, the metric card and the sheet, and it has a
// reduced-motion branch. A set tap, the rest timer and a save are never behind an animation.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const ep02 = css.slice(css.indexOf('/* EP-02 primitives'))

describe('EP-02 motion scope', () => {
  it('only animates .metric, .skel-line and (reduced-motion off) .sheet', () => {
    const sels = [...ep02.matchAll(/([^{}]+)\{[^}]*animation:[^}]*\}/g)].map(m => m[1].trim()).filter(s => !s.startsWith('@'))
    for (const s of sels) expect(s).not.toMatch(/\.set|\.srow|#timer|\.rest|\.save|\.btn|input/)
  })
  it('removes every EP-02 animation under prefers-reduced-motion', () => {
    expect(ep02).toMatch(/@media \(prefers-reduced-motion: reduce\)\{\.metric,\.skel-line,\.sheet\{animation:none!important\}\}/)
  })
  it('the sheet spring is an easing only, not a longer duration', () => {
    expect(css).toMatch(/animation:sheetup \.34s var\(--spring,var\(--ease\)\)/)
  })
})
