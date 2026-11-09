// @vitest-environment happy-dom
// openNutrition → openGym (gm-hooks): linking against a stand-in openNutrition, and where its numbers show.
import { describe, it, expect, beforeEach } from 'vitest'
import {
  cleanUrl, guessUrl, cleanDay, cleanSummary, cleanFasting, link, refresh, loadLink, unlink, daysIn, nutritionSummary,
  fastingNow, setShown, NUTRITION_KEY, LinkError,
} from './sister-nutrition.js'
import { reportData } from './report.js'
import { reportPrintHTML } from './report-print.js'
import { monthStats, monthCards, monthExtras } from './month-story.js'

// A stand-in openNutrition: the summary it serves today (opennutrition.summary.v1), plus the
// additive fields of docs/dev/SISTER_APPS.md (proteinMeals, fasting) and the pairing redeem.
function mockNutrition({ code = 'GYM12345', token = 'on_' + 'a'.repeat(32), extras = true, status = 200 } = {}) {
  const asked = []
  const fetchFn = async (url, init = {}) => {
    asked.push({ url, init })
    const u = new URL(url)
    if (status !== 200) return { ok: false, status, json: async () => ({}) }
    if (u.pathname === '/api/v1/integration/pair/redeem') {
      const body = JSON.parse(init.body)
      if (body.code !== code) return { ok: false, status: 401, json: async () => ({ error: 'bad code' }) }
      return { ok: true, status: 200, json: async () => ({ token, scopes: ['summary:read'] }) }
    }
    if (u.pathname === '/api/v1/integration/summary') {
      if (init.headers?.Authorization !== `Bearer ${token}`) return { ok: false, status: 401, json: async () => ({}) }
      return {
        ok: true, status: 200,
        json: async () => ({
          schema: 'opennutrition.summary.v1', subject: { id: 'x' }, range: { from: u.searchParams.get('from'), to: u.searchParams.get('to') },
          units: { energy: 'kcal', mass: 'g', weight: 'kg' },
          days: [
            { date: '2026-11-02', energy: 2400, protein: 160, carbohydrate: 250, fat: 80, complete: true, estimatedShare: 0, targets: { energy: 2500, protein: 150 }, ...(extras ? { proteinMeals: 4 } : {}) },
            { date: '2026-11-03', energy: 2000, protein: 120, carbohydrate: 200, fat: 70, complete: false, estimatedShare: 0.2, targets: { energy: 2500, protein: 150 }, ...(extras ? { proteinMeals: 2 } : {}) },
          ],
          bodyWeights: [],
          ...(extras ? { fasting: { enabled: true, goalHours: 16, startedAt: '2026-11-03T20:00:00.000Z', last: { start: '2026-11-02T20:00:00.000Z', end: '2026-11-03T12:00:00.000Z' } } } : {}),
        }),
      }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  return { fetchFn, asked, token }
}

const NOW = Date.parse('2026-11-04T08:00:00Z')

beforeEach(async () => { localStorage.removeItem(NUTRITION_KEY); await unlink() })

describe('sister-nutrition: reading what openNutrition says', () => {
  it('cleans the address and guesses one from openGym\'s own', () => {
    expect(cleanUrl('nutrition.example.com/')).toBe('https://nutrition.example.com')
    expect(cleanUrl('ftp://x')).toBe(null)
    expect(guessUrl('https://gym.example.com')).toBe('https://nutrition.example.com')
    expect(guessUrl('http://192.168.1.10:3000')).toBe('')
  })
  it('reads summary.v1 days, and the older trainer-hook shape too', () => {
    expect(cleanDay({ date: '2026-11-02', energy: 2400.04, protein: 160, carbohydrate: 250, fat: null, complete: false, targets: { energy: 2500, protein: 150 }, proteinMeals: 3 }))
      .toEqual({ date: '2026-11-02', kcal: 2400, protein: 160, carbs: 250, fat: null, partial: true, target: { kcal: 2500, protein: 150 }, proteinMeals: 3 })
    expect(cleanDay({ date: '2026-11-02', kcal: 2000, carbs: 1 })).toMatchObject({ kcal: 2000, carbs: 1, partial: false })
    expect(cleanDay({ date: 'nope' })).toBe(null)
    expect(cleanSummary({ schema: 'something.else.v1', days: [] })).toBe(null)
  })
  it('works out the eating window from the last fast when openNutrition sends none', () => {
    const f = cleanFasting({ enabled: true, goalHours: 16, startedAt: null, last: { start: '2026-11-03T20:00:00Z', end: '2026-11-04T12:00:00Z' } })
    expect(f.window).toEqual({ opensAt: Date.parse('2026-11-04T12:00:00Z'), closesAt: Date.parse('2026-11-04T20:00:00Z') })
    expect(cleanFasting({ enabled: false, goalHours: 16 })).toBe(null)
    expect(cleanFasting({ goalHours: 3 })).toBe(null)
  })
})

describe('sister-nutrition: linking', () => {
  it('redeems a code, proves it with one read, and keeps the token out of plain storage', async () => {
    const m = mockNutrition()
    const l = await link('nutrition.example.com', 'gym1-2345', { fetchFn: m.fetchFn, now: NOW })
    expect(l.url).toBe('https://nutrition.example.com')
    expect(m.asked[0].url).toBe('https://nutrition.example.com/api/v1/integration/pair/redeem')
    expect(JSON.parse(m.asked[0].init.body)).toEqual({ code: 'GYM12345', app: 'opengym', scopes: ['summary:read'] })
    expect(m.asked[1].url).toBe('https://nutrition.example.com/api/v1/integration/summary?from=2026-10-22&to=2026-11-04')
    expect(localStorage.getItem(NUTRITION_KEY)).not.toContain(m.token)
    expect(loadLink().hint).toBe(m.token.slice(-4))
    expect(Object.keys(loadLink().days)).toEqual(['2026-11-02', '2026-11-03'])
  })
  it('takes a pasted token as it is (an openNutrition from before the code)', async () => {
    const m = mockNutrition()
    await link('https://nutrition.example.com', m.token, { fetchFn: m.fetchFn, now: NOW })
    expect(m.asked.map(a => new URL(a.url).pathname)).toEqual(['/api/v1/integration/summary'])
  })
  it('says why it did not work, and keeps nothing', async () => {
    const m = mockNutrition()
    await expect(link('https://nutrition.example.com', 'WRONG123', { fetchFn: m.fetchFn, now: NOW })).rejects.toMatchObject({ code: 'code' })
    await expect(link('not a url at all', 'GYM12345', { fetchFn: m.fetchFn })).rejects.toBeInstanceOf(LinkError)
    await expect(link('https://nutrition.example.com', 'GYM12345', { fetchFn: async () => { throw new TypeError('Failed to fetch') } })).rejects.toMatchObject({ code: 'unreachable' })
    expect(loadLink()).toBe(null)
  })
  it('a revoked token shows up as an error on the link, with the old numbers kept', async () => {
    const m = mockNutrition()
    await link('https://nutrition.example.com', 'GYM12345', { fetchFn: m.fetchFn, now: NOW })
    const r = await refresh({ force: true, now: NOW + 1000, fetchFn: mockNutrition({ status: 401 }).fetchFn })
    expect(r.error).toBe('revoked')
    expect(Object.keys(r.days)).toHaveLength(2)
    await unlink()
    expect(loadLink()).toBe(null)
  })
})

describe('sister-nutrition: where it shows', () => {
  const days = [
    { date: '2026-11-02', kcal: 2400, protein: 160, target: { kcal: 2500, protein: 150 }, proteinMeals: 4, partial: false },
    { date: '2026-11-03', kcal: 2000, protein: 120, target: { kcal: 2500, protein: 150 }, proteinMeals: 2, partial: true },
  ]
  it('sums up a stretch over the logged days only', () => {
    expect(nutritionSummary(days, { from: '2026-11-01', to: '2026-11-07' })).toEqual({
      days: 2, of: 7, kcal: 2200, protein: 140, proteinMeals: 3, kcalTarget: 2500, proteinTarget: 150, proteinHit: 1, proteinDays: 2, partial: true,
    })
    expect(nutritionSummary([], {})).toBe(null)
  })
  it('the report carries it, the PDF prints it, and both leave it out unlinked', () => {
    const S = { workouts: [{ id: 'w', d: '2026-11-02', start: Date.parse('2026-11-02T17:00:00'), end: Date.parse('2026-11-02T18:00:00'), entries: [] }], bodyweight: [], unit: 'kg',
      activities: { a: { d: '2026-11-03', sport: 'run', min: 40, km: 8 } } }
    const R = reportData(S, { range: 'custom', from: '2026-11-01', to: '2026-11-04', today: '2026-11-04', nutrition: days })
    expect(R.nutrition).toMatchObject({ days: 2, protein: 140, proteinMeals: 3 })
    expect(R.activities).toMatchObject({ n: 1, min: 40, km: 8 })
    expect(reportData(S, { range: 'custom', from: '2026-11-01', to: '2026-11-04', today: '2026-11-04' }).nutrition).toBe(null)
    const html = reportPrintHTML(S, { range: 'custom', from: '2026-11-01', to: '2026-11-04', today: '2026-11-04', nutrition: days })
    expect(html).toContain('From openNutrition')
    expect(html).toContain('Runs, rides and matches')
    expect(reportPrintHTML(S, { range: 'custom', from: '2026-11-01', to: '2026-11-04', today: '2026-11-04' })).not.toContain('From openNutrition')
  })
  it('the month story gets a sport card and a fuel card', () => {
    const S = { workouts: [{ id: 'w', d: '2026-11-02', start: Date.parse('2026-11-02T17:00:00'), end: Date.parse('2026-11-02T18:00:00'), entries: [] }], unit: 'kg',
      activities: { a: { d: '2026-11-03', sport: 'football', min: 90 } } }
    const st = monthStats(S, '2026-11', '2026-11-20')
    const ids = monthCards(st, S, monthExtras(S, '2026-11', days)).map(c => c.id)
    expect(ids).toContain('sport')
    expect(ids).toContain('food')
    expect(ids.indexOf('food')).toBeLessThan(ids.indexOf('summary'))
    expect(monthCards(st, S, monthExtras(S, '2026-11', null)).map(c => c.id)).not.toContain('food')
  })
  it('Home says until when a fast runs, or the window is open, only from a fresh answer', async () => {
    const m = mockNutrition()
    await link('https://nutrition.example.com', 'GYM12345', { fetchFn: m.fetchFn, now: Date.parse('2026-11-03T22:00:00Z') })
    const l = loadLink()
    expect(fastingNow(l, Date.parse('2026-11-03T22:30:00Z'))).toEqual({ kind: 'fasting', until: Date.parse('2026-11-04T12:00:00Z') })
    expect(fastingNow(l, Date.parse('2026-11-04T08:00:00Z'))).toBe(null)   // too old to trust
    setShown('home', false)
    expect(loadLink().show.home).toBe(false)
    const open = { at: 10, fasting: { goalHours: 16, startedAt: null, endsAt: null, window: { opensAt: 100, closesAt: 200 } } }
    expect(fastingNow(open, 150)).toEqual({ kind: 'window', until: 200 })
    expect(fastingNow(open, 50)).toEqual({ kind: 'opens', at: 100 })
  })
  it('daysIn picks the stretch, oldest first', async () => {
    const m = mockNutrition()
    const l = await link('https://nutrition.example.com', 'GYM12345', { fetchFn: m.fetchFn, now: NOW })
    expect(daysIn(l, '2026-11-03', '2026-11-30').map(d => d.date)).toEqual(['2026-11-03'])
  })
})

describe('sister-nutrition: openGym Offline', () => {
  it('never links, reads or shows anything in the build without the network', async () => {
    const { setOfflineBuild, OFFLINE_OFF_CARDS } = await import('./build-caps.js')
    expect(OFFLINE_OFF_CARDS).toContain('opennutrition')
    const m = mockNutrition()
    await link('https://nutrition.example.com', 'GYM12345', { fetchFn: m.fetchFn, now: NOW })
    setOfflineBuild(true)
    try {
      expect(loadLink()).toBe(null)
      expect(await refresh({ force: true, fetchFn: m.fetchFn })).toBe(null)
      await expect(link('https://nutrition.example.com', 'GYM12345', { fetchFn: m.fetchFn })).rejects.toMatchObject({ code: 'unreachable' })
    } finally { setOfflineBuild(false) }
  })
})
