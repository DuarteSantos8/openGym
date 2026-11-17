// The links that open the phone apps instead of opengym.ch (lib/routine-link.js, lib/nfc-tags.js,
// lib/library-link.js): what the Android intent filters and the iPhone's apple-app-site-association
// claim, matched the way the phones match them, against the paths the app can actually handle.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { libraryLinkFromUrl } from './library-link.js'

const manifest = readFileSync(new URL('../../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
const aasa = JSON.parse(readFileSync(new URL('../../../website/.well-known/apple-app-site-association', import.meta.url), 'utf8'))

// Android's PatternMatcher PATTERN_SIMPLE_GLOB (AOSP), the one android:pathPattern uses: "." any
// char, "x*" any run of x, ".*" any run up to the first occurrence of the character after it,
// and the whole path has to match.
function simpleGlob(pattern, s) {
  let ip = 0, im = 0
  const NP = pattern.length, NM = s.length
  let nextChar = pattern[0]
  while (ip < NP && im < NM) {
    let c = nextChar
    ip++
    nextChar = ip < NP ? pattern[ip] : null
    const escaped = c === '\\'
    if (escaped) { c = nextChar; ip++; nextChar = ip < NP ? pattern[ip] : null }
    if (nextChar === '*') {
      if (!escaped && c === '.') {
        if (ip >= NP - 1) return true
        ip++
        nextChar = pattern[ip]
        if (nextChar === '\\') { ip++; nextChar = ip < NP ? pattern[ip] : null }
        do { if (s[im] === nextChar) break; im++ } while (im < NM)
        if (im === NM) return false
        ip++
        nextChar = ip < NP ? pattern[ip] : null
        im++
      } else {
        while (s[im] === c) { im++; if (im >= NM) break }
        ip++
        nextChar = ip < NP ? pattern[ip] : null
      }
    } else {
      if (c !== '.' && s[im] !== c) return false
      im++
    }
  }
  if (ip >= NP && im >= NM) return true
  return ip === NP - 2 && pattern[ip] === '.' && pattern[ip + 1] === '*'
}

const httpsFilters = [...manifest.matchAll(/<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/g)].map(m => m[1])
const androidClaims = path => httpsFilters.some(f => [...f.matchAll(/<data ([^>]*)\/>/g)].some(([, attrs]) => {
  const a = Object.fromEntries([...attrs.matchAll(/android:(\w+)="([^"]*)"/g)].map(x => [x[1], x[2]]))
  if (a.scheme !== 'https' || a.host !== 'opengym.ch') return false
  if (a.path) return a.path === path
  if (a.pathPrefix) return path.startsWith(a.pathPrefix)
  if (a.pathPattern) return simpleGlob(a.pathPattern.replace(/\\\\/g, '\\'), path)
  return false
}))

// AASA components: the first one that matches decides; "*" is any run of characters (slashes
// too), "?" one character.
const globRe = g => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
const iosClaims = path => {
  const hit = aasa.applinks.details[0].components.find(c => globRe(c['/']).test(path))
  return !!hit && !hit.exclude
}

const ROUTINE_PAGES = ['/routines/bar-and-floor/', '/routines/ppl-six-days/', '/routines/a/']
const NOT_CLAIMED = ['/routines/', '/routines', '/routines/index.html', '/routines/plans/bar-and-floor.opengym-plan.json',
  '/routines/media/0025.webp', '/routines/assets/routines.css', '/routines/covers/x.jpg', '/routines/index.json',
  '/routines/names.json', '/routines/sitemap.xml', '/routines/bar-and-floor/index.html', '/routines/submit/index.html', '/', '/demo/']

describe('app links', () => {
  it('the simple-glob port behaves like Android’s', () => {
    expect(simpleGlob('/routines/.*/', '/routines/x/')).toBe(true)
    expect(simpleGlob('/routines/.*/', '/routines/')).toBe(false)
    expect(simpleGlob('/routines/.*/', '/routines/plans/x.json')).toBe(false)
    expect(simpleGlob('/a.*', '/abc')).toBe(true)
  })

  it('both phones open a library routine’s page in the app', () => {
    for (const p of ROUTINE_PAGES) {
      expect(androidClaims(p), 'android ' + p).toBe(true)
      expect(iosClaims(p), 'ios ' + p).toBe(true)
      expect(libraryLinkFromUrl('https://opengym.ch' + p)?.kind, p).toBe('routine')
    }
  })

  it('neither claims the list, the files under it, or the app’s own way back to the browser', () => {
    for (const p of NOT_CLAIMED) {
      expect(androidClaims(p), 'android ' + p).toBe(false)
      expect(iosClaims(p), 'ios ' + p).toBe(false)
    }
  })

  it('the submit form: never on iPhone; on Android (no "except" there) the app hands it back', () => {
    expect(iosClaims('/routines/submit/')).toBe(false)
    expect(androidClaims('/routines/submit/')).toBe(true)
    const back = libraryLinkFromUrl('https://opengym.ch/routines/submit/')
    expect(back.kind).toBe('page')
    expect(androidClaims(new URL(back.browserUrl).pathname)).toBe(false)
  })

  it('every way back to the browser is a path neither phone claims', () => {
    for (const p of [...ROUTINE_PAGES, ...NOT_CLAIMED, '/routines/submit/', '/routines/a/b/']) {
      const l = libraryLinkFromUrl('https://opengym.ch' + p)
      if (!l) continue
      const back = new URL(l.browserUrl).pathname
      expect(androidClaims(back), 'android ' + back).toBe(false)
      expect(iosClaims(back), 'ios ' + back).toBe(false)
    }
  })

  it('still opens the shared-routine and sticker links', () => {
    expect(androidClaims('/r')).toBe(true)
    expect(iosClaims('/r')).toBe(true)
    expect(iosClaims('/nfc')).toBe(true)
  })
})
