// @vitest-environment happy-dom
// Issue #238: openGym behind a reverse proxy that serves it under a subpath. The assets were
// already relative; the API call was not, so it went to the proxy's own root where nothing
// answers it. The base is read from where the app is being served.
import { describe, it, expect } from 'vitest'
import { appBase } from './api.js'

const at = pathname => appBase({ pathname })

describe('the app knows where it is served from', () => {
  it('is the site root for an ordinary deployment', () => {
    expect(at('/')).toBe('/')
    expect(at('/index.html')).toBe('/')
  })

  it('keeps the proxy prefix of a subpath deployment', () => {
    expect(at('/myGym/')).toBe('/myGym/')
    expect(at('/myGym/index.html')).toBe('/myGym/')
    expect(at('/a/b/c/')).toBe('/a/b/c/')
  })

  it('drops a stale deep path rather than inventing a base from it', () => {
    // nginx sends these back to the app root before React boots; this is the belt and braces.
    expect(at('/myGym/plan/r/x')).toBe('/myGym/plan/r/')
    expect(at('/plan')).toBe('/')
  })

  it('survives a missing or odd location', () => {
    expect(appBase(null)).toBe('/')
    expect(at('')).toBe('/')
  })
})
