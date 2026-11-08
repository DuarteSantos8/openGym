// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { communityEntries, routineHits, importBundle, indexUrl, _resetLibrary } from './routine-library.js'

const INDEX = { format: 'opengym-routines', version: 1, routines: [
  { id: 'community/hangboard', title: 'Pull-up bar only', author: 'Ana', goal: 'general', level: 'beginner', days: 2,
    sessions: [{ name: 'Bar A', exercises: [{ id: '0662', sets: 3, reps: 8 }] }] }
] }
const fetchOk = (calls = []) => async url => { calls.push(url); return { ok: true, text: async () => JSON.stringify(INDEX) } }

describe('the routines library in the app', () => {
  beforeEach(() => { localStorage.clear(); _resetLibrary() })

  it('reads the community index once a day and keeps the good entries', async () => {
    const calls = []
    const a = await communityEntries({ url: 'https://opengym.ch/routines/index.json', fetchImpl: fetchOk(calls), now: 1000 })
    expect(a.map(e => e.id)).toEqual(['community/hangboard'])
    _resetLibrary()
    await communityEntries({ url: 'https://opengym.ch/routines/index.json', fetchImpl: fetchOk(calls), now: 2000 })
    expect(calls.length).toBe(1)
  })

  it('an index that is not there is no library, and no error', async () => {
    const r = await communityEntries({ url: 'https://opengym.ch/routines/index.json', fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }) })
    expect(r).toEqual([])
    expect(await communityEntries({ url: null })).toEqual([])
  })

  it('a question gets the matching built-in and community routines, compact', async () => {
    const hits = await routineHits({}, 'bodyweight only, I have a pull-up bar', { url: 'https://x.example/i.json', fetchImpl: fetchOk() })
    expect(hits.some(h => h.id === 'starter/home-bw')).toBe(true)
    expect(hits.some(h => h.id === 'community/hangboard')).toBe(true)
    expect(hits[0].sessions[0].ex.every(id => typeof id === 'string')).toBe(true)
  })

  it('an import is a plan bundle, and an unknown id is nothing', async () => {
    const b = await importBundle('starter/home-bw', { url: null })
    expect(b.opengym_plan).toBe(1)
    expect(b.routines.length).toBe(2)
    expect(await importBundle('nope', { url: null })).toBeNull()
  })

  it('the instance decides the address, or switches it off', () => {
    expect(indexUrl({ coach: {} })).toBe('https://opengym.ch/routines/index.json')
    expect(indexUrl({ coach: { routinesUrl: 'https://gym.example/routines.json' } })).toBe('https://gym.example/routines.json')
    expect(indexUrl({ coach: { routinesUrl: 'off' } })).toBeNull()
    expect(indexUrl({ coach: { routinesUrl: 'http://insecure.example' } })).toBe('https://opengym.ch/routines/index.json')
  })
})
