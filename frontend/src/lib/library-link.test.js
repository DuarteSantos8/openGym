// A whole routine from the routines library: which links are one, where its plan file is, and
// what comes back from fetching it (checked the way Plan > Import a plan file checks a file).
import { describe, it, expect } from 'vitest'
import { libraryLinkFromUrl, libraryBase, fetchLibraryRoutine, authorFromEntries } from './library-link.js'

const BENCH = '0025', CURL = '0463'
const plan = (over = {}) => ({
  opengym_plan: 1, exported: '2026-11-08', name: 'Bar and floor', unit: 'kg', week: { 1: ['r0'], 4: ['r1'] },
  routines: [
    { id: 'r0', name: 'Day A', emoji: 'barbell', ex: [{ id: BENCH, sets: 3, reps: 8, restSec: 90 }] },
    { id: 'r1', name: 'Day B', emoji: 'dumbbell', ex: [{ id: CURL, sets: 3, reps: 12 }] },
  ],
  customEx: [], ...over,
})
const answer = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })

describe('library links', () => {
  it('reads a routine page in every shape a phone hands over', () => {
    for (const url of [
      'https://opengym.ch/routines/bar-and-floor/',
      'https://opengym.ch/routines/bar-and-floor',
      'https://opengym.ch/routines/bar-and-floor/#copy',
      'https://www.opengym.ch/routines/bar-and-floor/?utm_source=x',
      'https://opengym.ch/routines/Bar-And-Floor/',
      'https://opengym.ch/routines/bar-and-floor/index.html',
    ]) {
      expect(libraryLinkFromUrl(url), url).toEqual({
        kind: 'routine', slug: 'bar-and-floor',
        pageUrl: 'https://opengym.ch/routines/bar-and-floor/',
        planUrl: 'https://opengym.ch/routines/plans/bar-and-floor.opengym-plan.json',
        browserUrl: 'https://opengym.ch/routines/bar-and-floor/index.html',
      })
    }
  })

  it('sends the pages that are not a routine to the website, as index.html', () => {
    expect(libraryLinkFromUrl('https://opengym.ch/routines/')).toEqual({ kind: 'page', browserUrl: 'https://opengym.ch/routines/index.html' })
    expect(libraryLinkFromUrl('https://opengym.ch/routines')).toEqual({ kind: 'page', browserUrl: 'https://opengym.ch/routines/index.html' })
    expect(libraryLinkFromUrl('https://opengym.ch/routines/submit/')).toEqual({ kind: 'page', browserUrl: 'https://opengym.ch/routines/submit/index.html' })
    expect(libraryLinkFromUrl('https://opengym.ch/routines/plans/x.opengym-plan.json')?.kind).toBe('page')
    expect(libraryLinkFromUrl('https://opengym.ch/routines/media/0025.webp')?.kind).toBe('page')
    expect(libraryLinkFromUrl('https://opengym.ch/routines/index.json')?.kind).toBe('page')
    expect(libraryLinkFromUrl('https://opengym.ch/routines/a/b/')?.kind).toBe('page')
  })

  it('leaves everything else alone', () => {
    for (const url of ['https://opengym.ch/r#1.j.e30', 'https://opengym.ch/', 'https://opengym.ch/routinesx/a/', 'https://evil.example/routines/a/',
      'https://opengym.ch.evil.example/routines/a/', 'opengym://routines/a', 'ftp://opengym.ch/routines/a/', 'not a url', '', null, 'https://opengym.ch/routines/' + 'a'.repeat(2000)]) {
      expect(libraryLinkFromUrl(url), String(url).slice(0, 60)).toBe(null)
    }
  })

  it('also reads the library this instance points the Coach at', () => {
    const at = 'https://lib.example.org/gym/routines/index.json'
    expect(libraryBase(at)).toBe('https://lib.example.org/gym/routines/')
    expect(libraryLinkFromUrl('https://lib.example.org/gym/routines/hotel-hiit/', at)).toMatchObject({
      kind: 'routine', slug: 'hotel-hiit', planUrl: 'https://lib.example.org/gym/routines/plans/hotel-hiit.opengym-plan.json',
    })
    expect(libraryLinkFromUrl('https://lib.example.org/gym/routines/hotel-hiit/')).toBe(null)
    expect(libraryLinkFromUrl('https://opengym.ch/routines/x/', at)?.slug).toBe('x')
    expect(libraryBase('http://plain.example/index.json')).toBe(null)
    expect(libraryBase('nope')).toBe(null)
  })
})

describe('fetching a library routine', () => {
  const link = libraryLinkFromUrl('https://opengym.ch/routines/bar-and-floor/')

  it('fetches the plan file and reads it like an imported one, with the author', async () => {
    const asked = []
    const fetchImpl = async (url, init) => { asked.push([url, init.method]); return answer(plan({ from: 'Ana' }))() }
    const b = await fetchLibraryRoutine(link, { fetchImpl })
    expect(asked).toEqual([['https://opengym.ch/routines/plans/bar-and-floor.opengym-plan.json', 'GET']])
    expect(b.name).toBe('Bar and floor')
    expect(b.routineCount).toBe(2)
    expect(b.exerciseCount).toBe(2)
    expect(b.scheduledDays).toBe(2)
    expect(b.from).toBe('Ana')
  })

  it('asks the index for the author when an older plan file has none', async () => {
    const b = await fetchLibraryRoutine(link, { fetchImpl: answer(plan()), authorOf: async l => authorFromEntries([{ url: 'https://opengym.ch/routines/bar-and-floor/', author: 'Bea' }], l) })
    expect(b.from).toBe('Bea')
    const none = await fetchLibraryRoutine(link, { fetchImpl: answer(plan()), authorOf: async () => { throw new Error('offline') } })
    expect(none.from).toBe('')
    expect(none.routineCount).toBe(2)
  })

  it('keeps the author name short and plain', async () => {
    const b = await fetchLibraryRoutine(link, { fetchImpl: answer(plan({ from: 'Ana\u0007 ' + 'x'.repeat(80) })) })
    expect(b.from.length).toBeLessThanOrEqual(40)
    expect(b.from).not.toMatch(/\u0007/)
  })

  it('says why when it cannot', async () => {
    const code = p => p.then(() => 'ok', e => e.code)
    expect(await code(fetchLibraryRoutine(link, { fetchImpl: async () => { throw new TypeError('Failed to fetch') } }))).toBe('offline')
    expect(await code(fetchLibraryRoutine(link, { fetchImpl: answer('', 503) }))).toBe('offline')
    expect(await code(fetchLibraryRoutine(link, { fetchImpl: answer('<html>', 404) }))).toBe('missing')
    expect(await code(fetchLibraryRoutine(link, { fetchImpl: answer('<html>not json') }))).toBe('bad-file')
    expect(await code(fetchLibraryRoutine(link, { fetchImpl: answer({ hello: 1 }) }))).toBe('bad-file')
    expect(await code(fetchLibraryRoutine(link, { fetchImpl: answer(plan({ routines: [{ id: 'r0', name: 'X', ex: [{ id: 'nope', sets: 3, reps: 5 }] }] })) }))).toBe('bad-file')
    expect(await code(fetchLibraryRoutine(link, { fetchImpl: answer('x'.repeat(300 * 1024)) }))).toBe('bad-file')
    expect(await code(fetchLibraryRoutine({ kind: 'page' }, { fetchImpl: answer(plan()) }))).toBe('bad-file')
  })
})
