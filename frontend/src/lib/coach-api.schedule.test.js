// @vitest-environment happy-dom
// The phone's automatic reviews, at the door every Coach job goes through (Discord, 10-19). The
// data-sharing question was asked when they were switched on; nobody is there to ask it when one
// comes due, so a scheduled run never opens the sheet, and a yes withdrawn since means no run.
// And they speak only when there is something to suggest.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  coachLocal: { mode: 'byok' },
  disclosure: { provider: 'openai', providerLabel: 'OpenAI API', host: 'api.openai.com', categories: [], version: 1 },
  notifier: null,
  toast: null,
  status: {},
}))
vi.mock('./demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'gym_demo_seeded_v1', REPO: '' }))
vi.mock('./mobile.js', () => ({ MOBILE: true, readJsonFile: async () => null, writeJsonFile: async () => {} }))
vi.mock('./api.js', () => ({ api: vi.fn(async () => mocks.status) }))
vi.mock('../store/useStore.js', () => ({ useStore: { getState: () => ({ S: { coach: { cadence: { everyWorkouts: 3 } } }, coachLocal: mocks.coachLocal }) } }))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: mocks.toast }) } }))
vi.mock('../components/CoachConsentSheet.jsx', () => ({ askAiConsent: vi.fn(async () => true) }))
vi.mock('./coach-local.js', () => ({
  setNotifier: vi.fn(fn => { mocks.notifier = fn }),
  localDisclosure: vi.fn(async () => mocks.disclosure),
  localScheduled: vi.fn(async () => ({ job: { id: 'local-1', trigger: 'scheduled' } })),
}))

const { askAiConsent } = await import('../components/CoachConsentSheet.jsx')
const local = await import('./coach-local.js')
const { api } = await import('./api.js')
const { scheduledReview, scheduledNotice } = await import('./coach-api.js')
const { allowAi, consentTarget, _resetAiConsent } = await import('./coach-consent.js')
const { checkScheduledReview, mayBeDue, mayHaveNews } = await import('./coach-schedule.js')

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  _resetAiConsent()
  mocks.coachLocal = { mode: 'byok' }
  mocks.toast = vi.fn()
  mocks.status = {}
})

describe('automatic reviews on a phone with its own key', () => {
  it('run with the yes given when they were switched on, and never ask again', async () => {
    await allowAi(consentTarget(mocks.disclosure, 'device'))
    expect(await scheduledReview()).toMatchObject({ job: { trigger: 'scheduled' } })
    expect(local.localScheduled).toHaveBeenCalledTimes(1)
    expect(askAiConsent).not.toHaveBeenCalled()
  })

  it('a yes withdrawn since means no run, and no dialog out of nowhere', async () => {
    expect(await scheduledReview()).toBeNull()
    expect(local.localScheduled).not.toHaveBeenCalled()
    expect(askAiConsent).not.toHaveBeenCalled()
  })

  it('a phone on its server leaves them to the server', async () => {
    mocks.coachLocal = { mode: 'server' }
    expect(await scheduledReview()).toBeNull()
    expect(local.localScheduled).not.toHaveBeenCalled()
  })

  it('speak only when there is something to suggest', async () => {
    await allowAi(consentTarget(mocks.disclosure, 'device'))
    await scheduledReview()   // loads the phone's Coach, which hands over its notifier
    mocks.notifier({ kind: 'failed', errorClass: 'provider', detail: '503', scheduled: true })
    mocks.notifier({ kind: 'nochange', reading: 'All good.', scheduled: true })
    expect(mocks.toast).not.toHaveBeenCalled()
    mocks.notifier({ kind: 'ready', pending: { changes: [{ id: 'c1' }, { id: 'c2' }] }, scheduled: true })
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast.mock.calls[0][0]).toMatch(/2 suggestions/)
    // A run somebody asked for still reports its failure, as before.
    mocks.notifier({ kind: 'failed', errorClass: 'provider', detail: '503' })
    expect(mocks.toast).toHaveBeenCalledTimes(2)
  })

  it('the minute check says no before loading anything when nothing could be due', async () => {
    expect(mayBeDue({ coachLocal: { mode: 'byok' }, S: { coach: { cadence: 'off' } } })).toBe(false)
    expect(mayBeDue({ coachLocal: { mode: 'server' }, S: { coach: { cadence: { everyWorkouts: 3 } } } })).toBe(false)
    expect(mayBeDue({ coachLocal: null, S: { coach: { cadence: { weekly: { day: 0 } } } } })).toBe(false)
    expect(await checkScheduledReview(() => ({ coachLocal: { mode: 'byok' }, S: { coach: { cadence: 'off' } } }))).toBeNull()
    expect(local.localScheduled).not.toHaveBeenCalled()

    await allowAi(consentTarget(mocks.disclosure, 'device'))
    expect(await checkScheduledReview(() => ({ coachLocal: { mode: 'byok' }, S: { coach: { cadence: { everyWorkouts: 3 } } } }))).toBeTruthy()
    expect(local.localScheduled).toHaveBeenCalledTimes(1)
  })
})

describe('a phone paired with a server', () => {
  const paired = { coachLocal: { mode: 'off' }, config: { coach: { enabled: true } }, user: { id: 'u1' }, S: { coach: { cadence: { weekly: { day: 0 } } } } }
  const proposal = id => ({ id, kind: 'review', trigger: 'scheduled', changes: [{ id: 'c1' }] })

  it('hears about a proposal the server\'s automatic review left, once', async () => {
    mocks.coachLocal = { mode: 'off' }
    mocks.status = { job: null, pending: proposal('p1') }
    expect(await scheduledNotice()).toMatchObject({ id: 'p1' })
    expect(api).toHaveBeenCalledWith('/api/coach/status')
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    expect(mocks.toast.mock.calls[0][0]).toMatch(/1 suggestion/)
    expect(await scheduledNotice()).toBeNull()
    expect(mocks.toast).toHaveBeenCalledTimes(1)
    mocks.status = { job: null, pending: proposal('p2') }
    await scheduledNotice()
    expect(mocks.toast).toHaveBeenCalledTimes(2)
  })

  it('says nothing about a proposal somebody asked for', async () => {
    mocks.coachLocal = { mode: 'server' }
    mocks.status = { job: null, pending: { ...proposal('p3'), trigger: undefined } }
    expect(await scheduledNotice()).toBeNull()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it('asks only on the way back to the foreground, and only with automatic reviews on', async () => {
    expect(mayHaveNews(paired)).toBe(true)
    expect(mayHaveNews({ ...paired, coachLocal: { mode: 'byok' } })).toBe(false)
    expect(mayHaveNews({ ...paired, config: {} })).toBe(false)
    expect(mayHaveNews({ ...paired, S: { coach: { cadence: 'off' } } })).toBe(false)
    mocks.coachLocal = { mode: 'off' }
    mocks.status = { job: null, pending: proposal('p4') }
    expect(await checkScheduledReview(() => paired)).toBeNull()
    expect(api).not.toHaveBeenCalled()
    expect(await checkScheduledReview(() => paired, true)).toMatchObject({ id: 'p4' })
  })
})
