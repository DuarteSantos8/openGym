// A whole routine from the routines library (docs/ROUTINES_LIBRARY.md), "like Spotify": the page
// https://opengym.ch/routines/<slug>/ opens the app when it is installed (the AASA components and
// the Android intent filter claim it) and the website when it is not. The app fetches the page's
// plan file, `<library>/plans/<slug>.opengym-plan.json` (scripts/routines/build.mjs), reads it
// with the same parsePlan as Plan > Import a plan file, and shows the usual import sheet.
//
// The library is opengym.ch's, or the one this instance points the Coach at (coach.routinesUrl,
// lib/routine-library.js indexUrl): a link into either one is read, anything else is not ours.
//
// Pages of the library that are not a routine (the list, the submit form, the files under it)
// are never claimed by the iPhone, and on Android they can still arrive (an intent filter has no
// "except"): those go back to the browser as .../index.html, which no filter claims, so the
// phone cannot bounce the link straight back into the app.
import { DEFAULT_INDEX_URL } from '../../../api/coach/core/routine-library.js'
import { parsePlan } from './plan-share.js'
import { cleanFrom } from './routine-link.js'

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/
// Library paths that are files or pages of their own, never a routine's slug.
const NOT_SLUGS = new Set(['submit', 'api', 'media', 'plans', 'assets', 'covers', 'index.html', 'index.json', 'names.json', 'routines.json', 'sitemap.xml'])
const MAX_PLAN = 256 * 1024

const libError = code => Object.assign(new Error(code), { code, libraryLink: true })

/** The library's base address (ends in /) from an index address, or null. */
export function libraryBase(indexAddress = DEFAULT_INDEX_URL) {
  if (typeof indexAddress !== 'string') return null
  let u
  try { u = new URL(indexAddress) } catch { return null }
  if (u.protocol !== 'https:') return null
  u.search = ''; u.hash = ''
  u.pathname = u.pathname.replace(/[^/]*$/, '')
  return u.href
}

const DEFAULT_BASE = libraryBase(DEFAULT_INDEX_URL)
const sameHost = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '')

/**
 * What a link into a routines library is, or null for anything else. Never throws.
 *   { kind: 'routine', slug, pageUrl, planUrl, browserUrl }  a routine's page
 *   { kind: 'page', browserUrl }                              the list, the submit form, a file
 * `indexAddress` is the instance's index (indexUrl()); opengym.ch's library is always read.
 */
export function libraryLinkFromUrl(raw, indexAddress = null) {
  if (typeof raw !== 'string' || raw.length > 1024) return null
  let u
  try { u = new URL(raw.trim()) } catch { return null }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const host = u.hostname.toLowerCase()
  const bases = [DEFAULT_BASE]
  const own = indexAddress ? libraryBase(indexAddress) : null
  if (own && own !== DEFAULT_BASE) bases.push(own)
  for (const base of bases) {
    const b = new URL(base)
    if (!sameHost(host, b.hostname.toLowerCase())) continue
    const path = u.pathname
    const root = b.pathname
    if (path !== root.replace(/\/$/, '') && !path.startsWith(root)) continue
    const rest = path.startsWith(root) ? path.slice(root.length) : ''
    const page = (p = '') => ({ kind: 'page', browserUrl: base + p })
    const m = /^([^/]+)(?:\/(index\.html)?)?$/.exec(rest)
    if (!rest || !m) return page(rest ? (rest.endsWith('/') ? rest + 'index.html' : rest) : 'index.html')
    const slug = m[1].toLowerCase()
    if (NOT_SLUGS.has(slug) || !SLUG_RE.test(slug)) return page(slug === 'submit' ? 'submit/index.html' : rest)
    return {
      kind: 'routine',
      slug,
      pageUrl: `${base}${slug}/`,
      planUrl: `${base}plans/${slug}.opengym-plan.json`,
      browserUrl: `${base}${slug}/index.html`
    }
  }
  return null
}

/**
 * Fetches a routine's plan file and checks it the way Plan > Import does. Resolves to the parsed
 * bundle (parsePlan's shape) plus `from`, the author's name. Throws an Error with `code`:
 *   'offline'  no answer at all (no signal, DNS, the server down)
 *   'missing'  the library answered, but has no such routine (404 and friends)
 *   'bad-file' something came back, and it is not a plan this app can use
 */
export async function fetchLibraryRoutine(link, { fetchImpl, unit = 'kg', authorOf } = {}) {
  if (!link || link.kind !== 'routine') throw libError('bad-file')
  let res
  try {
    res = await fetchImpl(link.planUrl, { method: 'GET', headers: { accept: 'application/json' } })
  } catch { throw libError('offline') }
  if (!res || !res.ok) throw libError(res && res.status >= 500 ? 'offline' : 'missing')
  let text
  try { text = await res.text() } catch { throw libError('offline') }
  if (typeof text !== 'string' || text.length > MAX_PLAN) throw libError('bad-file')
  let raw
  try { raw = JSON.parse(text) } catch { throw libError('bad-file') }
  let parsed
  try { parsed = parsePlan(raw, unit) } catch { throw libError('bad-file') }
  if (!parsed.routines.length || !parsed.exerciseCount) throw libError('bad-file')
  let from = cleanFrom(raw?.from)
  // Plan files built before they carried the author: the library's index knows it.
  if (!from && typeof authorOf === 'function') {
    try { from = cleanFrom(await authorOf(link)) } catch { /* no credit then, the routine still works */ }
  }
  return { ...parsed, from }
}

/** The author of a library routine from the index entries (lib/routine-library.js communityEntries). */
export function authorFromEntries(entries, link, indexAddress = null) {
  const e = (entries || []).find(x => typeof x?.url === 'string' && libraryLinkFromUrl(x.url, indexAddress)?.slug === link.slug)
  return e?.author || ''
}
