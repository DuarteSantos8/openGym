/* Reading from a source: what the source would not grant is not asked for again, every batch goes
   into the profile as it is read, and a failure keeps the source's own words for Settings. The
   source and the device file are stand-ins: the real ones need an iPhone. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const files = {}
vi.mock('../mobile.js', () => ({
  MOBILE: false,
  readJsonFile: async name => files[name] ?? null,
  writeJsonFile: async (name, v) => { files[name] = JSON.parse(JSON.stringify(v)) },
}))
const fake = {
  id: 'apple-health', label: 'Apple Health',
  isAvailable: async () => true,
  getAvailableDataTypes: () => ['weight', 'steps', 'spo2'],
  requestPermissions: vi.fn(async () => ({ asked: true, skipped: ['spo2'] })),
  fetchMeasurements: vi.fn(),
}
vi.mock('./providers.js', () => ({ providerById: id => (id === 'apple-health' ? fake : null), PROVIDERS: [] }))

const { connectSource, syncSource, loadSources } = await import('./sync.js')

const reading = (type, d, v) => ({ type, v, t: Date.parse(d + 'T12:00:00Z'), d, sid: `${type}:${d}`, src: 'apple-health' })

describe('reading from a source', () => {
  let S
  const getState = () => S
  const update = fn => fn(S)
  beforeEach(() => { S = { unit: 'kg', health: [], bodyweight: [] }; fake.fetchMeasurements.mockReset() })

  it('keeps what the system left out off the list, and folds each batch in as it comes', async () => {
    const seen = []
    fake.fetchMeasurements.mockImplementation(async ({ types, onBatch }) => {
      seen.push(types)
      const a = [reading('steps', '2026-10-12', 9000)], b = [reading('weight', '2026-10-12', 80)]
      onBatch(a)
      expect(S.health).toHaveLength(1)   // the first batch is in before the second is read
      onBatch(b)
      return [...a, ...b]
    })
    const r = await connectSource('apple-health', getState, update)
    expect(r).toMatchObject({ ok: true, added: 2 })
    expect(seen[0]).toEqual(['weight', 'steps'])
    expect((await loadSources()).providers['apple-health']).toMatchObject({ on: true, types: ['weight', 'steps'], skipped: ['spo2'] })
    expect(S.health).toHaveLength(2)
    expect(S.bodyweight).toHaveLength(1)
  })

  it('a failed read keeps the reason, and the next good one clears it', async () => {
    fake.fetchMeasurements.mockRejectedValueOnce(new Error('Missing com.apple.developer.healthkit entitlement.'))
    const r = await syncSource('apple-health', getState, update)
    expect(r).toMatchObject({ ok: false, error: 'failed', detail: 'Missing com.apple.developer.healthkit entitlement.' })
    expect((await loadSources()).providers['apple-health'].detail).toMatch(/entitlement/)
    fake.fetchMeasurements.mockResolvedValueOnce([reading('steps', '2026-10-13', 100)])
    expect(await syncSource('apple-health', getState, update)).toMatchObject({ ok: true, added: 1 })
    expect((await loadSources()).providers['apple-health'].detail).toBeNull()
  })

  it("a refused permission is reported with the system's words", async () => {
    fake.requestPermissions.mockRejectedValueOnce(new Error('Not authorised: Missing entitlement'))
    expect(await connectSource('apple-health', getState, update)).toEqual({ ok: false, error: 'denied', detail: 'Not authorised: Missing entitlement' })
  })
})
