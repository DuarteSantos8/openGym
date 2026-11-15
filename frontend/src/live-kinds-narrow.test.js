// Settings > Live widget > Per exercise type: five kinds in one segmented control. In Danish
// "Kondition" and "Bæreøvelser" ran out of their segments and into each other at 390px (QA 1.4.5).
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

describe('live widget kinds at phone width', () => {
  it('lets a long kind name wrap inside its own segment', () => {
    const rule = css.match(/\n\.gl-kinds button span\{min-width:0[^}]*\}/)?.[0] || ''
    expect(rule).toMatch(/overflow-wrap:anywhere/)
    expect(rule).toMatch(/hyphens:auto/)
  })
  it('gives the five labels more room than the default segment padding', () => {
    expect(css.match(/\n\.gl-kinds button\{([^}]*)\}/)?.[1]).toMatch(/padding-inline:3px/)
  })
})
