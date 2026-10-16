// The onboarding's wire format (ux-onboarding §3b) and how the client reads the server's answers.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answersFromHub, checkInvite, completeOnboarding, loadOnboarding, previewTargets, saveStep, stepAnswers, waitSeconds } from './api.js'

const answers = {
  goal: 'lose',
  body: { sex: 'female', birthYear: 1990, heightCm: null, weightKg: 64 },
  activity: { value: 'sitting', source: 'default' },
  units: { weight: 'kg', height: 'cm', source: 'locale' },
  trainingDays: 3,
  plan: { kind: 'starter', templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'gym', experience: 'new' },
}
const reply = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body })
afterEach(() => { vi.unstubAllGlobals() })

describe('the §3b step bodies', () => {
  it('leaves an unanswered body field out, and carries activity and units with their source', () => {
    expect(stepAnswers('body', answers)).toEqual({
      sex: 'female', birthYear: 1990, weightKg: 64,
      activity: { value: 'sitting', source: 'default' }, units: { weight: 'kg', height: 'cm', source: 'locale' },
    })
  })

  it('sends a body with nothing the person said as a skip, so the hub and the screens agree it was skipped', () => {
    const none = { ...answers, body: { sex: null, birthYear: null, heightCm: null, weightKg: null } }
    expect(stepAnswers('body', none)).toBeNull()
    // A unit or a day picked by hand is something said.
    expect(stepAnswers('body', { ...none, units: { ...none.units, source: 'user' } })).toMatchObject({ units: { source: 'user' } })
    expect(stepAnswers('body', { ...none, activity: { value: 'physical', source: 'user' } })).toMatchObject({ activity: { value: 'physical' } })
  })

  it('sends training days (null when skipped), the goal and the plan union as they are', () => {
    expect(stepAnswers('training', { ...answers, trainingDays: undefined })).toEqual({ trainingDays: null })
    expect(stepAnswers('goal', answers)).toEqual({ goal: 'lose' })
    expect(stepAnswers('plan', answers)).toBe(answers.plan)
    expect(stepAnswers('plan', { ...answers, plan: { kind: 'none' } })).toEqual({ kind: 'none' })
    expect(() => stepAnswers('about', answers)).toThrow()
  })

  it('sends the AI coach as a consent to the text shown, by its id, and never a time of its own', () => {
    const chosen = { kind: 'coach', experience: null, equipment: 'gym', consentVersion: 'ai-coach-build-v1' }
    const sent = { kind: 'coach', experience: null, equipment: 'gym', consent: true, consentVersion: 'ai-coach-build-v1' }
    expect(stepAnswers('plan', { ...answers, plan: chosen })).toEqual(sent)
    // A choice the hub stored carries the hub's stamp: sent again (a retry), the stamp stays behind.
    expect(stepAnswers('plan', { ...answers, plan: { ...chosen, consentAt: '2026-10-14T08:00:00.000Z' } })).toEqual(sent)
  })

  it('reads the stored steps back into answers', () => {
    const back = answersFromHub({ goal: { goal: 'keep' }, body: { sex: 'male', units: { weight: 'lb', height: 'ft', source: 'user' } }, training: { trainingDays: 0 }, plan: { kind: 'none' } })
    expect(back).toEqual({
      goal: 'keep', body: { sex: 'male', birthYear: null, heightCm: null, weightKg: null },
      units: { weight: 'lb', height: 'ft', source: 'user' }, trainingDays: 0, plan: { kind: 'none' },
    })
    expect(answersFromHub(null)).toEqual({})
  })
})

describe('the requests', () => {
  it('PUTs one step, previews and completes on the person\'s date', async () => {
    const fetch = vi.fn(() => reply(200, { ok: true }))
    vi.stubGlobal('fetch', fetch)
    await saveStep('goal', answers)
    await previewTargets(answers)
    await completeOnboarding('2026-10-15')
    const [put, preview, complete] = fetch.mock.calls
    expect(put[0]).toMatch(/\/hub\/api\/onboarding$/)
    expect(JSON.parse(put[1].body)).toEqual({ step: 'goal', answers: { goal: 'lose' } })
    expect(put[1].method).toBe('PUT')
    expect(Object.keys(JSON.parse(preview[1].body))).toEqual(['goal', 'body', 'training'])
    expect(JSON.parse(complete[1].body)).toEqual({ today: '2026-10-15' })
  })

  it('says why a request failed: the server refused, it was already complete, or no answer', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(400, { error: 'bad' })))
    await expect(saveStep('goal', answers)).rejects.toMatchObject({ status: 400, code: 'http' })
    vi.stubGlobal('fetch', vi.fn(() => reply(409, { error: 'done', code: 'complete' })))
    await expect(completeOnboarding('2026-10-15')).rejects.toMatchObject({ code: 'complete' })
    vi.stubGlobal('fetch', vi.fn(() => reply(409, { error: 'the AI coach is not available on this server', code: 'plan-unavailable' })))
    await expect(completeOnboarding('2026-10-15')).rejects.toMatchObject({ code: 'plan-unavailable' })
    vi.stubGlobal('fetch', vi.fn(() => reply(400, { error: 'x', code: 'whatever' })))
    await expect(completeOnboarding('2026-10-15')).rejects.toMatchObject({ code: 'http' })
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    await expect(saveStep('goal', answers)).rejects.toMatchObject({ status: 0, code: 'offline' })
  })

  it('names the person every write was composed for, and a read names no one', async () => {
    const fetch = vi.fn(() => reply(200, { ok: true }))
    vi.stubGlobal('fetch', fetch)
    await saveStep('goal', answers, 'u-ada')
    await previewTargets(answers, 'u-ada')
    await completeOnboarding('2026-10-15', 'u-ada')
    await loadOnboarding()
    const [put, preview, complete, read] = fetch.mock.calls
    for (const [, init] of [put, preview, complete]) expect(init.headers['X-Expected-User'], init.method).toBe('u-ada')
    expect(read[1].headers).not.toHaveProperty('X-Expected-User')
    // The body keeps the hub's strict shape: the person is in the header, never the body.
    expect(JSON.parse(put[1].body)).toEqual({ step: 'goal', answers: { goal: 'lose' } })
    expect(JSON.parse(complete[1].body)).toEqual({ today: '2026-10-15' })
  })

  it('knows the hub refused a write made for another account', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(409, { error: 'this request was made for another account', code: 'wrong-user' })))
    await expect(saveStep('goal', answers, 'u-ada')).rejects.toMatchObject({ status: 409, code: 'wrong-user' })
  })

  it('says a 429 is busy, with the wait the hub asked for in seconds, in an HTTP date, or none', async () => {
    const busy = headers => vi.fn(() => Promise.resolve({ ok: false, status: 429, headers: new Headers(headers), json: async () => ({ error: 'too many requests' }) }))
    vi.stubGlobal('fetch', busy({ 'retry-after': '7' }))
    await expect(saveStep('goal', answers, 'u')).rejects.toMatchObject({ status: 429, code: 'busy', retryAfter: 7 })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'))
    vi.stubGlobal('fetch', busy({ 'retry-after': 'Thu, 15 Oct 2026 08:00:12 GMT' }))
    await expect(loadOnboarding()).rejects.toMatchObject({ code: 'busy', retryAfter: 12 })
    vi.useRealTimers()
    vi.stubGlobal('fetch', busy({}))
    await expect(loadOnboarding()).rejects.toMatchObject({ code: 'busy', retryAfter: null })
    // A wait is never longer than a minute, whatever is asked, and one that names none is short.
    vi.stubGlobal('fetch', busy({ 'retry-after': '86400' }))
    const long = await loadOnboarding().catch(e => e)
    expect(long.retryAfter).toBe(60)
    expect(waitSeconds(long)).toBe(60)
    expect(waitSeconds({ retryAfter: null })).toBe(5)
  })

  it('checks an invite: an unknown code is invalid, no answer is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => reply(200, { status: 'valid', inviterName: 'Andrei', suggestedName: 'Maria' })))
    await expect(checkInvite('AB12')).resolves.toEqual({ status: 'valid', inviterName: 'Andrei', suggestedName: 'Maria' })
    // The hub answers a code that is not one with 404 and the same shape.
    vi.stubGlobal('fetch', vi.fn(() => reply(404, { status: 'invalid', inviterName: null, suggestedName: null })))
    await expect(checkInvite('ZZ99')).resolves.toEqual({ status: 'invalid', inviterName: null, suggestedName: null })
    // Any other 404 (no hub on this server, a path something else answered) says nothing about the code.
    vi.stubGlobal('fetch', vi.fn(() => reply(404, { error: 'not found' })))
    await expect(checkInvite('AB12')).rejects.toMatchObject({ code: 'unavailable' })
    vi.stubGlobal('fetch', vi.fn(() => reply(429, { error: 'too many requests' })))
    await expect(checkInvite('AB12')).rejects.toMatchObject({ code: 'unavailable' })
    vi.stubGlobal('fetch', vi.fn(() => reply(503, { error: 'the invite cannot be checked right now' })))
    await expect(checkInvite('AB12')).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('asks the hub\'s hardened invite route, not openGym\'s, and sends no referrer', async () => {
    const fetchMock = vi.fn(() => reply(200, { status: 'valid', inviterName: null, suggestedName: null }))
    vi.stubGlobal('fetch', fetchMock)
    await checkInvite('AB12')
    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url, 'http://app.test').pathname).toBe('/hub/api/invite/AB12')
    expect(init.method).toBe('GET')
    expect(init.referrerPolicy).toBe('no-referrer')
  })
})
