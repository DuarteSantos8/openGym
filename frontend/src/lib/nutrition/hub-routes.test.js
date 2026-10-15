import { describe, expect, it, vi } from 'vitest'
import { NtApi } from './api.js'
import { createFakeNutriTrace, isOffProductQuery, isOffSearchQuery, isWellnessDataQuery } from './fake-nutritrace.js'
import { offProductUrl, offSearchUrl } from './off.js'

describe('the wearable data routes', () => {
  const q = s => new URLSearchParams(s)

  it('take exactly a from and a to, both dates, in order, within a year', () => {
    expect(isWellnessDataQuery(q('from=2026-01-01&to=2026-10-15'))).toBe(true)
    expect(isWellnessDataQuery(q('from=2026-10-15&to=2026-10-15'))).toBe(true)
    expect(isWellnessDataQuery(q('from=2025-10-15&to=2026-10-15'))).toBe(true) // 365 days apart
    expect(isWellnessDataQuery(q(''))).toBe(false) // NutriTrace would fall back to its own 30 days
    expect(isWellnessDataQuery(q('from=2026-01-01'))).toBe(false)
    expect(isWellnessDataQuery(q('date=2026-10-15'))).toBe(false)
    expect(isWellnessDataQuery(q('from=2026-01-01&to=2026-10-15&source=x'))).toBe(false)
    expect(isWellnessDataQuery(q('from=2026-01-01&from=2026-01-02&to=2026-10-15'))).toBe(false)
    expect(isWellnessDataQuery(q('from=2026-10-15&to=2026-01-01'))).toBe(false)
    expect(isWellnessDataQuery(q('from=2020-01-01&to=2026-10-15'))).toBe(false)
    expect(isWellnessDataQuery(q('from=yesterday&to=2026-10-15'))).toBe(false)
    expect(isWellnessDataQuery(q('from=2026-1-1&to=2026-10-15'))).toBe(false)
  })

  it('are sent by the client in that shape, and the diary and fasts routes it reads are open', async () => {
    const nt = createFakeNutriTrace({ wellness: { fitbit: { '2026-10-14': { resting_hr: 55 } }, garmin: {} } })
    vi.stubGlobal('fetch', nt.fetch)
    try {
      expect(await NtApi.getWellness('fitbit', '2026-10-01', '2026-10-15')).toEqual({ '2026-10-14': { resting_hr: 55 } })
      expect(await NtApi.getWellness('garmin', '2026-10-01', '2026-10-15')).toEqual({})
      expect(await NtApi.getWellness('anything else', '2026-10-01', '2026-10-15')).toEqual({ '2026-10-14': { resting_hr: 55 } }) // fitbit: never a free path segment
      expect(await NtApi.getAllDiary()).toEqual([])
      expect(await NtApi.getFasts(365)).toEqual([])
      expect(nt.requests.map(r => r.path)).toEqual(['/nt/api/wellness/fitbit/data', '/nt/api/wellness/garmin/data', '/nt/api/wellness/fitbit/data', '/nt/api/diary', '/nt/api/fasts'])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('answer 403 to a query the hub would refuse, and 404 for another source', async () => {
    const nt = createFakeNutriTrace()
    const get = async path => (await nt.fetch(path)).status
    expect(await get('/nt/api/wellness/fitbit/data')).toBe(403)
    expect(await get('/nt/api/wellness/garmin/data?date=2026-10-14')).toBe(403)
    expect(await get('/nt/api/wellness/withings/data?from=2026-10-01&to=2026-10-15')).toBe(404)
    expect(await get('/nt/api/wellness/fitbit/sync')).toBe(404)
  })
})

// The routes this feature asks the hub to allow (PR body, "Hub routes needed"), held to the shapes
// the client really sends: the fake applies the proposed rules, and these tests fail if the client
// and the rules drift apart.
const proxyQuery = url => new URLSearchParams({ url })

describe('the barcode lookup through /api/proxy', () => {
  it('accepts exactly the URL the client builds', () => {
    expect(isOffProductQuery(proxyQuery(offProductUrl('3017620422003', 'fr')))).toBe(true)
    expect(isOffProductQuery(proxyQuery(offProductUrl('96385074', 'en')))).toBe(true)
    expect(isOffProductQuery(proxyQuery(offProductUrl('3017620422003', 'ZZZ')))).toBe(true) // falls back to en
  })

  it('is a different shape from the text search, and each refuses the other', () => {
    expect(isOffSearchQuery(proxyQuery(offProductUrl('3017620422003')))).toBe(false)
    expect(isOffProductQuery(proxyQuery(offSearchUrl('nutella')))).toBe(false)
  })

  it.each([
    ['another host', 'https://evil.example/api/v3/product/3017620422003?lc=en'],
    ['http', 'http://world.openfoodfacts.org/api/v3/product/3017620422003?lc=en'],
    ['credentials in the URL', 'https://u:p@world.openfoodfacts.org/api/v3/product/3017620422003?lc=en'],
    ['a path that climbs out', 'https://world.openfoodfacts.org/api/v3/product/../../x?lc=en'],
    ['a letter in the code', 'https://world.openfoodfacts.org/api/v3/product/30176204220ab?lc=en'],
    ['too short a code', 'https://world.openfoodfacts.org/api/v3/product/1234567?lc=en'],
    ['too long a code', 'https://world.openfoodfacts.org/api/v3/product/123456789012345?lc=en'],
    ['another API version', 'https://world.openfoodfacts.org/api/v2/product/3017620422003?lc=en'],
    ['the v3.5 route', 'https://world.openfoodfacts.org/api/v3.5/product/3017620422003?fields=nutrition'],
    ['an extra parameter', 'https://world.openfoodfacts.org/api/v3/product/3017620422003?lc=en&fields=all'],
    ['live, which skips the mirror', 'https://world.openfoodfacts.org/api/v3/product/3017620422003?lc=en&live=1'],
    ['a long language', 'https://world.openfoodfacts.org/api/v3/product/3017620422003?lc=english'],
    ['a fragment', 'https://world.openfoodfacts.org/api/v3/product/3017620422003?lc=en#x'],
    ['an image host', 'https://images.openfoodfacts.org/images/products/301/762/042/2003/front_fr.200.jpg'],
  ])('refuses %s', (_name, url) => {
    expect(isOffProductQuery(proxyQuery(url))).toBe(false)
  })

  it('refuses a proxy call with any other query key, or the url twice', () => {
    const ok = offProductUrl('3017620422003')
    expect(isOffProductQuery(new URLSearchParams([['url', ok], ['live', '1']]))).toBe(false)
    expect(isOffProductQuery(new URLSearchParams([['url', ok], ['url', ok]]))).toBe(false)
    expect(isOffProductQuery(new URLSearchParams())).toBe(false)
  })
})

describe('the fake answers the new routes as the hub would', () => {
  const call = async (nt, method, path, body) => {
    const res = await nt.fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, data: await res.json() }
  }

  it('lets only the fasting settings through PUT /api/settings', async () => {
    const nt = createFakeNutriTrace()
    expect((await call(nt, 'PUT', '/nt/api/settings', { key: 'fastingEnabled', value: true })).status).toBe(200)
    expect((await call(nt, 'PUT', '/nt/api/settings', { key: 'fastingDefaultHours', value: 18 })).status).toBe(200)
    expect((await call(nt, 'PUT', '/nt/api/settings', { key: 'fastingEnabled', value: 'yes' })).status).toBe(400)
    expect((await call(nt, 'PUT', '/nt/api/settings', { key: 'oidcSecret', value: 'x' })).status).toBe(400)
    expect((await call(nt, 'PUT', '/nt/api/settings', { key: 'fastingEnabled', value: true, extra: 1 })).status).toBe(400)
  })

  it('checks the fast bodies and the list query', async () => {
    const nt = createFakeNutriTrace()
    expect((await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16, notes: 'x' })).status).toBe(400)
    expect((await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 500 })).status).toBe(400)
    const started = await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16 })
    expect(started.status).toBe(201)
    expect((await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16 })).status).toBe(409)
    expect((await call(nt, 'PATCH', `/nt/api/fasts/${started.data.id}`, { goal_hours: 4 })).status).toBe(400)
    expect((await call(nt, 'GET', '/nt/api/fasts?limit=60')).status).toBe(200)
    expect((await call(nt, 'GET', '/nt/api/fasts?limit=9999')).status).toBe(403)
    expect((await call(nt, 'GET', '/nt/api/fasts?user=2')).status).toBe(403)
    expect((await call(nt, 'POST', `/nt/api/fasts/${started.data.id}/end`, {})).status).toBe(200)
    expect((await call(nt, 'POST', `/nt/api/fasts/${started.data.id}/end`, {})).status).toBe(400)
    expect((await call(nt, 'DELETE', `/nt/api/fasts/${started.data.id}`)).status).toBe(200)
    expect((await call(nt, 'DELETE', `/nt/api/fasts/${started.data.id}`)).status).toBe(404)
  })

  it('refuses what nt-body-checks.ts refuses: future or malformed times, a goal under 1, a body on end or delete, a query on a fast', async () => {
    const nt = createFakeNutriTrace()
    const ago = ms => new Date(Date.now() - ms).toISOString()
    expect((await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 0.5 })).status).toBe(400)
    expect((await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16, start_at: ago(-3600_000) })).status).toBe(400)
    expect((await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16, start_at: 'yesterday' })).status).toBe(400)
    expect((await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16, start_at: 1760000000000 })).status).toBe(400)
    const started = await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16, start_at: ago(-60_000) }) // inside the 5 minute skew
    expect(started.status).toBe(201)
    const id = started.data.id
    expect((await call(nt, 'PATCH', `/nt/api/fasts/${id}`, { start_at: ago(8 * 24 * 3600_000) })).status).toBe(400)
    expect((await call(nt, 'PATCH', `/nt/api/fasts/${id}`, { start_at: ago(-3600_000) })).status).toBe(400)
    expect((await call(nt, 'PATCH', `/nt/api/fasts/${id}`, { start_at: ago(6 * 24 * 3600_000) })).status).toBe(200)
    expect((await call(nt, 'GET', '/nt/api/fasts/active?x=1')).status).toBe(403)
    expect((await call(nt, 'POST', `/nt/api/fasts/${id}/end`, { now: 1 })).status).toBe(400)
    expect((await call(nt, 'POST', `/nt/api/fasts/${id}/end`)).status).toBe(400)
    expect((await call(nt, 'POST', `/nt/api/fasts/${id}/end`, {})).status).toBe(200)
    expect((await call(nt, 'DELETE', `/nt/api/fasts/${id}`, {})).status).toBe(400)
    expect((await call(nt, 'DELETE', `/nt/api/fasts/0${id}`)).status).toBe(404)
  })

  it('back-dates a start by at most 24 hours', async () => {
    const nt = createFakeNutriTrace()
    const twoHours = new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    const ok = await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16, start_at: twoHours })
    expect(ok.data.start_at).toBe(twoHours)
    await call(nt, 'POST', `/nt/api/fasts/${ok.data.id}/end`, {})
    const old = await call(nt, 'POST', '/nt/api/fasts/start', { goal_hours: 16, start_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString() })
    expect(Date.now() - Date.parse(old.data.start_at)).toBeLessThan(5000)
  })
})
