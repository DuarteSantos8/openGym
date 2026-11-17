import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Full QA 146 still applies after the approved layout moved these destinations out of the header:
// Community, By muscle, Ladders and Cards/List wrap under More, with every label kept on one line.
describe('the Library secondary destination buttons', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/views/Library.css'), 'utf8')
  const jsx = readFileSync(resolve(process.cwd(), 'src/views/Library.jsx'), 'utf8')
  it('wrap under More and keep each label on one line', () => {
    expect(jsx).toContain('className="iv-lib-more-actions"')
    expect(css).toMatch(/\.iv-lib-more-actions\{display:flex;flex-wrap:wrap;gap:8px/)
    expect(css).toMatch(/\.iv-lib-more-actions \.btn\{[^}]*white-space:nowrap/)
    expect(css).toMatch(/\.iv-lib-more-actions \.ex-view-btn\.with-label\{[^}]*white-space:nowrap/)
  })
})
