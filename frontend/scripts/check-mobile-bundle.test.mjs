/* check-mobile-bundle.mjs: the guard `npm run build:mobile` runs after `cap sync`. The broken APK
 * it exists for had the web index.html (a second build into the same dist/) beside the mobile
 * chunks; these fixtures are that tree and the good one. */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkMobileBundle } from './check-mobile-bundle.mjs'

const MOBILE_HTML = '<head><meta name="opengym-flavor" content="mobile"><script type="module" crossorigin src="./assets/index-BKpgfSzf.js"></script><link rel="stylesheet" href="./assets/index-x.css"></head>'
const WEB_HTML = '<head><script type="module" crossorigin src="./assets/index-C_XIl0Rk.js"></script><link rel="stylesheet" href="./assets/index-x.css"></head>'

const tree = (files) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-mobile-'))
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), body)
  }
  return dir
}
const copy = (prefix, html, { sw = 'const CACHE = "og-1a2b3c"' } = {}) => ({
  [`${prefix}/index.html`]: html,
  [`${prefix}/assets/index-BKpgfSzf.js`]: '',
  [`${prefix}/assets/index-C_XIl0Rk.js`]: '',
  [`${prefix}/assets/index-x.css`]: '',
  [`${prefix}/sw.js`]: sw,
})
const check = files => {
  const dir = tree(files)
  try { return checkMobileBundle(dir).map(p => p.replace(dir + '/', '')) }
  finally { rmSync(dir, { recursive: true, force: true }) }
}

describe('check-mobile-bundle', () => {
  it('passes a mobile build synced into android', () => {
    expect(check({ ...copy('dist', MOBILE_HTML), ...copy('android/app/src/main/assets/public', MOBILE_HTML) })).toEqual([])
  })

  it('fails when the synced index.html is the web build (two builds into one dist/)', () => {
    const problems = check({ ...copy('dist', WEB_HTML), ...copy('android/app/src/main/assets/public', WEB_HTML) })
    expect(problems.some(p => p.startsWith('android/app/src/main/assets/public/index.html is not the mobile build'))).toBe(true)
  })

  it('fails when index.html loads a chunk that is not there', () => {
    const files = copy('dist', MOBILE_HTML)
    delete files['dist/assets/index-BKpgfSzf.js']
    expect(check(files)).toEqual(['dist/index.html loads assets/index-BKpgfSzf.js, which is missing'])
  })

  it('fails on an unstamped service worker', () => {
    expect(check(copy('dist', MOBILE_HTML, { sw: 'const CACHE = "og-__BUILD__"' }))).toEqual(['dist/sw.js is not stamped (__BUILD__ left in it)'])
  })

  it('fails when there is no build at all', () => {
    expect(check({})).toEqual(['dist: no index.html'])
  })
})
