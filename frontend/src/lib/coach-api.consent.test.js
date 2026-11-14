// @vitest-environment happy-dom
// The door every Coach job goes through asks first (Apple 5.1.2(i)): once per provider and host,
// before the first request that would send training data there. Pinned here with the real
// coach-api.js and coach-consent.js; the sheet itself is a stand-in that answers as told, and
// no request ever leaves (api.js, the phone's pipeline and the demo are all fakes).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  DEMO: false, MOBILE: false, coachLocal: null,
  disclosure: { provider: 'openai', providerLabel: 'OpenAI API', host: 'api.openai.com', categories: [], version: 1 },
  answer: true,
}))
vi.mock('./demo.js', () => ({ get DEMO() { return mocks.DEMO }, DEMO_SEEDED: 'gym_demo_seeded_v1', REPO: '' }))
vi.mock('./mobile.js', () => ({ get MOBILE() { return mocks.MOBILE }, readJsonFile: async () => null, writeJsonFile: async () => {} }))
vi.mock('./api.js', () => ({
  api: vi.fn(async path => (path === '/api/coach/disclosure' ? mocks.disclosure : { job: { id: 'j1' } })),
}))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: { coach: {} }, coachLocal: mocks.coachLocal }) } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('../components/CoachConsentSheet.jsx', () => ({ askAiConsent: vi.fn(async () => mocks.answer) }))
vi.mock('./coach-local.js', () => ({
  setNotifier: vi.fn(),
  localDisclosure: vi.fn(async () => mocks.disclosure),
  localReview: vi.fn(async () => ({ job: { id: 'local-1' } })),
}))
vi.mock('./coach-demo.js', () => ({
  demoDisclosure: vi.fn(() => ({ provider: 'demo' })),
  demoReview: vi.fn(async () => ({ job: { id: 'demo-1' } })),
}))

const { api } = await import('./api.js')
const { askAiConsent } = await import('../components/CoachConsentSheet.jsx')
const local = await import('./coach-local.js')
const demo = await import('./coach-demo.js')
const { requestReview, requestPlan, refinePlan, requestDebrief, isDeclined } = await import('./coach-api.js')
const { aiConsents, withdrawAi, _resetAiConsent } = await import('./coach-consent.js')

const jobCalls = () => vi.mocked(api).mock.calls.filter(([p]) => p !== '/api/coach/disclosure')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  _resetAiConsent()
  Object.assign(mocks, {
    DEMO: false, MOBILE: false, coachLocal: null, answer: true,
    disclosure: { provider: 'openai', providerLabel: 'OpenAI API', host: 'api.openai.com', categories: [], version: 1 },
  })
})

describe('the server Coach', () => {
  it('asks once, right before the first request, and remembers the yes', async () => {
    await requestReview('')
    expect(askAiConsent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(askAiConsent).mock.calls[0][0]).toMatchObject({ via: 'server', provider: 'openai', name: 'OpenAI', host: 'api.openai.com' })
    expect(jobCalls()).toHaveLength(1)

    await requestPlan({ goal: 'muscle' })
    await refinePlan('fewer squats')
    await requestDebrief('w1')
    expect(askAiConsent).toHaveBeenCalledTimes(1)
    expect(jobCalls()).toHaveLength(4)
    expect((await aiConsents()).map(c => c.name)).toEqual(['OpenAI'])
  })

  it('asks again when the admin points it at another provider or another endpoint', async () => {
    await requestReview('')
    mocks.disclosure = { provider: 'anthropic', providerLabel: 'Anthropic API', host: 'api.anthropic.com' }
    await requestReview('')
    expect(askAiConsent).toHaveBeenCalledTimes(2)
    expect(vi.mocked(askAiConsent).mock.calls[1][0].name).toBe('Anthropic')

    mocks.disclosure = { provider: 'compatible', providerLabel: 'OpenAI-compatible endpoint', host: 'openrouter.ai' }
    await requestReview('')
    mocks.disclosure = { provider: 'compatible', providerLabel: 'OpenAI-compatible endpoint', host: 'llm.example.org' }
    await requestReview('')
    expect(askAiConsent).toHaveBeenCalledTimes(4)
    expect(vi.mocked(askAiConsent).mock.calls[3][0].name).toBe('llm.example.org')
  })

  it('"Not now" sends nothing, and rejects quietly with a class the screens let pass', async () => {
    mocks.answer = false
    const e = await requestReview('').catch(x => x)
    expect(isDeclined(e)).toBe(true)
    expect(e.quiet).toBe(true)
    expect(jobCalls()).toHaveLength(0)
    expect(await aiConsents()).toEqual([])
    // …and the next request asks again rather than remembering the no.
    mocks.answer = true
    await requestReview('')
    expect(askAiConsent).toHaveBeenCalledTimes(2)
    expect(jobCalls()).toHaveLength(1)
  })

  it('withdrawn, the next request asks again', async () => {
    await requestReview('')
    const [c] = await aiConsents()
    await withdrawAi(c.key)
    await requestReview('')
    expect(askAiConsent).toHaveBeenCalledTimes(2)
  })

  it('does not ask about a model on the server\'s own network', async () => {
    mocks.disclosure = { provider: 'compatible', providerLabel: 'OpenAI-compatible endpoint', host: '192.168.1.20:11434' }
    await requestReview('')
    expect(askAiConsent).not.toHaveBeenCalled()
    expect(jobCalls()).toHaveLength(1)
  })

  it('sends nothing when the disclosure itself cannot be read', async () => {
    vi.mocked(api).mockRejectedValueOnce(Object.assign(new Error('offline'), { status: 0 }))
    await expect(requestReview('')).rejects.toThrow('offline')
    expect(jobCalls()).toHaveLength(0)
  })
})

describe('the phone with its own key', () => {
  beforeEach(() => { mocks.MOBILE = true; mocks.coachLocal = { mode: 'byok', provider: 'openai' } })

  it('asks with the device wording, and a yes for the server is not a yes for the phone', async () => {
    mocks.coachLocal = null
    await requestReview('')                       // the server's OpenAI
    mocks.coachLocal = { mode: 'byok', provider: 'openai' }
    await requestReview('')                       // the phone's own OpenAI key
    expect(askAiConsent).toHaveBeenCalledTimes(2)
    expect(vi.mocked(askAiConsent).mock.calls[1][0]).toMatchObject({ via: 'device', name: 'OpenAI' })
    expect(local.localReview).toHaveBeenCalledTimes(1)
  })

  it('"Not now" never reaches the pipeline', async () => {
    mocks.answer = false
    await expect(requestReview('')).rejects.toMatchObject({ code: 'declined' })
    expect(local.localReview).not.toHaveBeenCalled()
  })
})

describe('the demo', () => {
  it('never asks: its Coach is canned and nothing leaves the device', async () => {
    mocks.DEMO = true
    await requestReview('')
    expect(askAiConsent).not.toHaveBeenCalled()
    expect(demo.demoReview).toHaveBeenCalledTimes(1)
    expect(api).not.toHaveBeenCalled()
  })
})
