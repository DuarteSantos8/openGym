// EP-02 static scope check on index.css only: the new animation rules name only the metric card,
// loading bars and the sheet, and have a reduced-motion branch. This does NOT prove set, rest-timer
// or save behaviour; that is the real-browser probe in docs/superpowers/evidence/EP-02/probe.py.
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
  it('the sheet keeps its baseline easing; the spring is behind @supports linear()', () => {
    expect(css).toMatch(/animation:sheetup \.34s var\(--ease\);/)
    expect(css).toMatch(/@supports \(transition-timing-function:linear\(0,1\)\)\{[^}]*--spring/)
    expect(css).not.toMatch(/var\(--spring,/)
  })
})
