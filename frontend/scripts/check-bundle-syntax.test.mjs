/* check-bundle-syntax.mjs: 1.4.2 never got past the splash on iOS 15.5 to 16.3 because one chunk
 * held a regex lookbehind. The fixtures are what Safari 15.5 cannot run, and the last test builds
 * the real web bundle (a few seconds) and holds every chunk of it to that. */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkBundle, regexFeatures, unsupportedSyntax } from './check-bundle-syntax.mjs'

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('regexFeatures', () => {
  it('finds a lookbehind, either kind', () => {
    expect(regexFeatures('^(?!-)[a-z0-9-]{1,63}(?<!-)$')).toEqual(['regex lookbehind (Safari 16.4)'])
    expect(regexFeatures('(?<=\\$)\\d+')).toEqual(['regex lookbehind (Safari 16.4)'])
  })
  it('leaves lookaheads, named groups and escaped or bracketed look-alikes alone', () => {
    for (const p of ['^(?!-)[a-z]+$', '(?=x)', '(?<year>\\d{4})-(?<m>\\d\\d)', '\\(?<=', '[(?<!]', '\\\\[(]?<!'])
      expect(regexFeatures(p), p).toEqual([])
  })
  it('finds the v flag, a group name used twice and inline modifiers', () => {
    expect(regexFeatures('[\\p{L}--a]', 'v')).toEqual(['regex v flag (Safari 17)'])
    expect(regexFeatures('(?<d>a)|(?<d>b)')).toEqual(['regex duplicate group name (Safari 17)'])
    expect(regexFeatures('(?i:abc)')).toEqual(['regex inline modifier (not in Safari 15)'])
  })
})

describe('unsupportedSyntax', () => {
  const kinds = code => unsupportedSyntax(code).map(p => p.split(': ')[1])
  it('flags a lookbehind in a literal and in a RegExp built from a string', () => {
    expect(kinds('const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/i')).toEqual(['regex lookbehind (Safari 16.4)'])
    expect(kinds('const r = new RegExp("(?<=a)b", "g"); RegExp("(?<!c)d")')).toEqual(['regex lookbehind (Safari 16.4)', 'regex lookbehind (Safari 16.4)'])
  })
  it('flags class static blocks, import attributes and built-ins newer than 15.5', () => {
    expect(kinds('class A { static { init() } }')).toEqual(['class static block (Safari 16.4)'])
    expect(kinds('import("./x.json", { with: { type: "json" } })')).toEqual(['import attributes (Safari 17.2)'])
    expect(kinds('Object.groupBy(xs, f); xs.toSorted(); Promise.withResolvers()')).toEqual([
      'Object.groupBy (newer than Safari 15.5)', '.toSorted() (Safari 16)', 'Promise.withResolvers (newer than Safari 15.5)',
    ])
  })
  it('lets through what Safari 15.5 has: at(), Object.hasOwn, structuredClone, ??=, private fields, top-level await', () => {
    expect(kinds('class A { #x = 1; has(o) { return #x in o } }; a ??= [1].at(-1); Object.hasOwn(o, "k"); structuredClone(o); await 0; "(?<!-)"')).toEqual([])
  })
  it('says so when a chunk does not parse at all', () => {
    expect(unsupportedSyntax('const = 1', 'assets/x.js')[0]).toMatch(/^assets\/x\.js: does not parse/)
  })
})

describe('the built web bundle', () => {
  it('has nothing Safari 15.5, the iOS deployment target, cannot run', () => {
    const out = mkdtempSync(join(tmpdir(), 'og-bundle-syntax-'))
    try {
      execFileSync(process.execPath, [join(frontend, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'],
        { cwd: frontend, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } })
      expect(checkBundle(out)).toEqual([])
    } finally { rmSync(out, { recursive: true, force: true }) }
  }, 180_000)
})
