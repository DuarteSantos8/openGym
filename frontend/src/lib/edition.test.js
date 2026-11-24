import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { editionOf, EDITION, isCloud, featureAvailable } from './edition.js'

const src = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('edition', () => {
  it('is the default unless the build says cloud, exactly', () => {
    expect(editionOf({})).toBe('default')
    expect(editionOf(undefined)).toBe('default')
    expect(editionOf({ VITE_EDITION: '' })).toBe('default')
    expect(editionOf({ VITE_EDITION: 'Cloud' })).toBe('default')
    expect(editionOf({ VITE_EDITION: '1' })).toBe('default')
    expect(editionOf({ VITE_EDITION: 'cloud' })).toBe('cloud')
  })

  it('is the default in the test and CI builds', () => {
    expect(EDITION).toBe('default')
    expect(isCloud()).toBe(false)
  })

  it('unlocks everything in the default edition, whatever the entitlement says', () => {
    expect(featureAvailable('pro', () => false, 'default')).toBe(true)
    expect(featureAvailable('anything', undefined, 'default')).toBe(true)
  })

  it('asks the entitlement in the cloud edition', () => {
    expect(featureAvailable('pro', f => f === 'pro', 'cloud')).toBe(true)
    expect(featureAvailable('pro', () => false, 'cloud')).toBe(false)
    expect(featureAvailable('pro', undefined, 'cloud')).toBe(false)
  })
})

// ADR 0008, rule 1: nothing outside lib/cloud/ may name the hosted providers or import cloud code
// statically. A static import would put the cloud chunk in every build.
describe('the default build stays free of cloud code', () => {
  const files = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) { if (name !== 'cloud' && name !== 'locales' && name !== 'node_modules') walk(p) }
      else if (/\.(js|jsx)$/.test(name) && !/\.test\.(js|jsx)$/.test(name)) files.push(p)
    }
  }
  walk(src)

  it('finds the source tree', () => { expect(files.length).toBeGreaterThan(500) })

  it('has no static import of lib/cloud anywhere outside it', () => {
    const STATIC = /^\s*import\s[^;]*?from\s+['"][^'"]*\/cloud\/[^'"]*['"]/m
    const bad = files.filter(f => STATIC.test(readFileSync(f, 'utf8'))).map(f => relative(src, f))
    expect(bad).toEqual([])
  })

  it('names no hosted provider outside lib/cloud', () => {
    const NAMES = /supabase\.co\b|js\.stripe\.com|checkout\.stripe\.com|@supabase\/|sb_publishable_|sb_secret_|pk_live_|pk_test_/i
    const bad = files.filter(f => NAMES.test(readFileSync(f, 'utf8'))).map(f => relative(src, f))
    expect(bad).toEqual([])
  })
})
