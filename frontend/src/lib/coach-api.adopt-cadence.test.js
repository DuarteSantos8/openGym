// @vitest-environment happy-dom
// Automatic reviews switched on before 1.4.6 kept no target (S.coach.cadenceFor), and the server
// holds those back until the Coach is opened (api/coach/cadence.js), which someone who set them
// up to run by themselves has no reason to do (Discord, "Scheduled coach review doesn't
// trigger"). The app fills it in on start, without asking, when this device already said yes to
// the server's provider; without that yes it leaves it to the Coach screen to ask.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: null,
  disclosure: { provider: 'openai', providerLabel: 'OpenAI API', host: 'api.openai.com', categories: [], version: 1 },
}))
vi.mock('./demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'gym_demo_seeded_v1', REPO: '' }))
vi.mock('./mobile.js', () => ({ MOBILE: true, readJsonFile: async () => null, writeJsonFile: async () => {} }))
vi.mock('./api.js', () => ({ api: vi.fn(async () => mocks.disclosure) }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => mocks.state } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: () => {} }) } }))
vi.mock('../components/CoachConsentSheet.jsx', () => ({ askAiConsent: vi.fn(async () => true) }))

const { askAiConsent } = await import('../components/CoachConsentSheet.jsx')
const { adoptCadence } = await import('./coach-api.js')
const { allowAi, consentTarget, _resetAiConsent } = await import('./coach-consent.js')
const { mayAdopt } = await import('./coach-schedule.js')

function storeWith(coach) {
  const st = {
    S: { coach }, coachLocal: { mode: 'server' }, user: { id: 'u1' }, config: { coach: { enabled: true } },
    update: fn => fn(st.S),
  }
  return st
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  _resetAiConsent()
})

describe('automatic reviews from before 1.4.6', () => {
  it('take the server provider this device already said yes to, without asking', async () => {
    mocks.state = storeWith({ cadence: { weekly: { day: 0, time: '18:00' } } })
    expect(mayAdopt(mocks.state)).toBe(true)
    await allowAi(consentTarget(mocks.disclosure, 'server'))
    expect(await adoptCadence()).toBe(true)
    expect(mocks.state.S.coach.cadenceFor).toBe('openai|api.openai.com')
    expect(askAiConsent).not.toHaveBeenCalled()
    expect(mayAdopt(mocks.state)).toBe(false)
  })

  it('without that yes, nothing is filled in and nothing pops up', async () => {
    mocks.state = storeWith({ cadence: { everyWorkouts: 4 } })
    expect(await adoptCadence()).toBe(false)
    expect(mocks.state.S.coach.cadenceFor).toBeUndefined()
    expect(askAiConsent).not.toHaveBeenCalled()
  })

  it('a target already kept is left alone, even for another provider', async () => {
    mocks.state = storeWith({ cadence: { everyWorkouts: 4 }, cadenceFor: 'anthropic|api.anthropic.com' })
    await allowAi(consentTarget(mocks.disclosure, 'server'))
    expect(mayAdopt(mocks.state)).toBe(false)
    expect(await adoptCadence()).toBe(false)
    expect(mocks.state.S.coach.cadenceFor).toBe('anthropic|api.anthropic.com')
  })

  it('reviews off, a phone with its own key, or no server Coach: nothing to do', () => {
    expect(mayAdopt(storeWith({ cadence: 'off' }))).toBe(false)
    expect(mayAdopt({ ...storeWith({ cadence: { everyWorkouts: 4 } }), coachLocal: { mode: 'byok' } })).toBe(false)
    expect(mayAdopt({ ...storeWith({ cadence: { everyWorkouts: 4 } }), config: { coach: { enabled: false } } })).toBe(false)
  })
})
