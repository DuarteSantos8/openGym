// Every plain string the Apple Watch app shows or reads out (Text("…"), LocalizedStringKey("…"),
// Label/Button("…")) is in its string catalog in every language, so VoiceOver and the screen never
// fall back to English. watch-apple verification: the rest's ‹ read "Back" in English everywhere.
// Phrases with interpolation are left to ios/ci/watch-strings.mjs, which writes them.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const app = resolve('ios/App')
const KEY = /(?:\bText|LocalizedStringKey|\bLabel|\bButton|navigationTitle)\(\s*"((?:[^"\\]|\\.)*)"/g

function plainKeys (dir) {
  const keys = new Set()
  for (const f of readdirSync(join(app, dir)).filter(f => f.endsWith('.swift'))) {
    const src = readFileSync(join(app, dir, f), 'utf8')
    for (const m of src.matchAll(KEY)) if (m[1].trim() && !m[1].includes('\\(')) keys.add(m[1])
  }
  return keys
}

function catalog (file) {
  const have = new Set()
  let src = ''
  try { src = readFileSync(file, 'utf8') } catch { return have }
  for (const m of src.matchAll(/^"((?:[^"\\]|\\.)*)"\s*=/gm)) have.add(m[1])
  return have
}

describe('the Apple Watch string catalog', () => {
  it('has every plain key the watch app uses, in every language', () => {
    const keys = plainKeys('Watch')
    expect(keys.size).toBeGreaterThan(50)
    const langs = readdirSync(join(app, 'Watch')).filter(d => d.endsWith('.lproj'))
    expect(langs.length).toBeGreaterThanOrEqual(26)
    const missing = []
    for (const l of langs) {
      const have = catalog(join(app, 'Watch', l, 'Localizable.strings'))
      for (const k of keys) if (!have.has(k)) missing.push(`${l}: ${k}`)
    }
    expect(missing).toEqual([])
  })
})
