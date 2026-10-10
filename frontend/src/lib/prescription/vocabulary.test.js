import { describe, expect, it } from 'vitest'
import * as engine from './vocabulary.js'
import * as coach from '../../../../api/coach/core/vocabulary.js'

// A52. The API keeps its own closed list because frontend/ is not in its Docker build context
// (api/Dockerfile copies only server.js, push-messages.js, verify-error.js and coach/). This
// test runs in the frontend Vitest suite — the CI gate — on a checkout where both paths exist,
// and never in the API container. It catches exactly the drift a cross-import was meant to
// prevent, at a fraction of the risk.
const LISTS = ['CHANGE_TYPES', 'POLICIES', 'MODES']

describe.each(LISTS)('%s is set-equal on both sides', name => {
  it('matches', () => {
    expect(Array.isArray(engine[name]), `engine.${name}`).toBe(true)
    expect(Array.isArray(coach[name]), `coach.${name}`).toBe(true)
    expect([...engine[name]].sort()).toEqual([...coach[name]].sort())
  })
  it('has no duplicates on either side', () => {
    expect(new Set(engine[name]).size).toBe(engine[name].length)
    expect(new Set(coach[name]).size).toBe(coach[name].length)
  })
})

describe('the API vocabulary module is a leaf', () => {
  it('imports nothing, so it cannot drag frontend/ into the container', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../../../../api/coach/core/vocabulary.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/^\s*import\s/m)
    expect(src).not.toMatch(/require\(/)
  })
})
