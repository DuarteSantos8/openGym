// @vitest-environment happy-dom
// Whose onboarding it is. What a half-finished one holds (a body, a goal, a plan with the AI
// coach's consent, the invite) belongs to the person who gave it: on a shared device the next
// person must not see it, send it to their own profile, or consent to the AI coach through it.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { button, flush, mount, radio, rerender, saved, unmountAll, where } from './onboarding.test-util.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ user: null, sheets: [] }))
vi.mock('../../store/useStore.js', () => {
  const snap = () => ({
    user: mocks.user, config: {}, S: {},
    setUser: vi.fn(u => { mocks.user = u }), pushState: vi.fn(), pullState: vi.fn(), adoptProfile: vi.fn(async () => {}),
  })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore, hasData: () => false }
})
vi.mock('../../store/useUI.js', () => {
  const snap = () => ({ sheets: [], toast: () => {}, openSheet: render => { mocks.sheets.push(render); return { close: () => {} } } })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
const hub = vi.hoisted(() => ({
  checkInvite: vi.fn(), loadOnboarding: vi.fn(), saveStep: vi.fn(), previewTargets: vi.fn(), completeOnboarding: vi.fn(), passkeySynced: vi.fn(),
}))
vi.mock('../../lib/onboarding/api.js', async original => ({ ...(await original()), ...hub }))
vi.mock('../../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

const STORE = 'gains_onboarding'
const MARIA = { id: 'u1', name: 'Maria' }
const BEA = { id: 'u2', name: 'Bea' }
const body = { sex: 'female', birthYear: 1990, heightCm: 168, weightKg: 64 }
const coach = { kind: 'coach', experience: null, equipment: 'gym', consentVersion: 'ai-coach-build-v1' }
// The consent text as the hub sends it; the coach is offered only with one.
const CONSENT = {
  version: 'ai-coach-build-v1',
  reads: { one: 'An AI model reads your {0} training day.', other: 'An AI model reads your {0} training days.' },
  where: 'These answers go to the AI service this Gains server uses.',
}
const click = el => act(() => { el.click() })
// The sheet the screen opened last, drawn (the shell's sheet host is mocked away).
function openedSheet() {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => root.render(mocks.sheets.at(-1)(() => {})))
  return { host, done: () => act(() => root.unmount()) }
}
const kept = () => JSON.parse(sessionStorage.getItem(STORE))
// Everything the hub was sent, as text: none of Maria's answers may be in it.
const sentToHub = () => JSON.stringify(hub.saveStep.mock.calls)
const MARIAS = /female|1990|168|"weightKg":64|lose|ai-coach-build-v1|"consent":true/

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  mocks.user = null
  mocks.sheets.length = 0
  Object.values(hub).forEach(f => f.mockReset())
  hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, step: null, coachAvailable: true, starterAvailable: true, coachConsent: null })
  hub.saveStep.mockResolvedValue({})
  hub.completeOnboarding.mockResolvedValue({ completedAt: 1 })
  hub.passkeySynced.mockResolvedValue(true)
})
afterEach(() => { unmountAll(); vi.useRealTimers() })

describe('a shared device', () => {
  it('A leaves mid-onboarding and signs out, then B arrives by invite: nothing of A\'s shows or is sent', async () => {
    mocks.user = MARIA
    saved({ code: 'AB12', name: 'Maria', answers: { goal: 'lose', body, trainingDays: 3, plan: coach }, unsaved: ['body', 'plan'], pick: 'coach' })
    const first = mount('/onboarding/goal')
    await flush()
    expect(radio(first, 'Lose weight').getAttribute('aria-checked')).toBe('true')

    // Signed out without anything wiping the tab's storage (a session that ran out in another tab).
    mocks.user = null
    rerender()
    expect(sessionStorage.getItem(STORE)).toBeNull()
    unmountAll()

    hub.checkInvite.mockResolvedValue({ status: 'valid', inviterName: 'Andrei', suggestedName: null })
    const landing = mount('/join/AB12')
    await flush()
    click(button(landing, 'Create my account'))
    expect(where(landing)).toBe('/onboarding/name')
    expect(landing.querySelector('input').value).toBe('')
    unmountAll()

    mocks.user = BEA
    const second = mount('/onboarding/goal')
    await flush()
    expect(radio(second, 'Lose weight').getAttribute('aria-checked')).toBe('false')
    click(radio(second, 'Build muscle'))
    expect(hub.saveStep).toHaveBeenCalledWith('goal', expect.objectContaining({ goal: 'build', body: { sex: null, birthYear: null, heightCm: null, weightKg: null } }), 'u2')
    expect(sentToHub()).not.toMatch(MARIAS)
    expect(kept()).toMatchObject({ uid: 'u2', code: null, name: null, unsaved: [] })
  })

  it('a copy kept for A is not B\'s even when nothing signed A out in between', async () => {
    mocks.user = BEA
    saved({ uid: 'u1', code: 'AB12', answers: { goal: 'lose', body, trainingDays: 3 } })
    const page = mount('/onboarding/goal')
    await flush()
    expect(radio(page, 'Lose weight').getAttribute('aria-checked')).toBe('false')
    expect(hub.saveStep).not.toHaveBeenCalled()
  })

  it('a profile switch under a mounted flow starts B from nothing, and A\'s answers are not sent for B', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'lose', body, trainingDays: 3 } })
    const page = mount('/onboarding/goal')
    await flush()
    expect(radio(page, 'Lose weight').getAttribute('aria-checked')).toBe('true')

    mocks.user = BEA
    rerender()
    await flush()
    expect(hub.loadOnboarding).toHaveBeenCalledTimes(2)
    expect(radio(page, 'Lose weight').getAttribute('aria-checked')).toBe('false')
    expect(sessionStorage.getItem(STORE)).toBeNull()

    click(radio(page, 'Keep my weight'))
    expect(hub.saveStep).toHaveBeenCalledWith('goal', expect.objectContaining({ goal: 'keep', body: { sex: null, birthYear: null, heightCm: null, weightKg: null } }), 'u2')
    expect(sentToHub()).not.toMatch(MARIAS)
    expect(kept()).toMatchObject({ uid: 'u2' })
  })

  it('every save and the completion name the person their answers belong to', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'keep', body, trainingDays: 0 } })
    const page = mount('/onboarding/goal')
    await flush()
    click(radio(page, 'Build muscle'))
    await flush()
    expect(hub.saveStep.mock.calls.map(([step, , uid]) => [step, uid])).toEqual([['goal', 'u1']])
    unmountAll()
    const end = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(end, 'Go to Home').click() })
    await flush()
    expect(hub.completeOnboarding).toHaveBeenCalledWith(expect.any(String), 'u1')
  })

  it('a save the hub refuses as made for someone else is dropped without a word, and not marked unsaved', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'keep', body, trainingDays: 3, plan: { kind: 'none' } } })
    hub.saveStep.mockRejectedValue(Object.assign(new Error('this request was made for another account'), { status: 409, code: 'wrong-user' }))
    const page = mount('/onboarding/goal')
    await flush()
    click(radio(page, 'Build muscle'))
    await flush()
    expect(hub.saveStep).toHaveBeenCalledTimes(1)
    expect(kept().unsaved).toEqual([])
    expect(page.querySelector('[role="alert"], [role="status"]')).toBeNull()
  })

  it('a completion the hub refuses as made for someone else ends quietly: nothing is shown or left to send', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'keep', body, trainingDays: 0 } })
    hub.completeOnboarding.mockRejectedValue(Object.assign(new Error('x'), { status: 409, code: 'wrong-user' }))
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(where(page)).toBe('/onboarding/finish')
    expect(page.querySelector('h1').textContent).toBe('That’s everything for now')
    expect(button(page, 'Go to Home').disabled).toBe(false)
  })

  it('a save still waiting for A\'s turn is dropped when B signs in', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'lose', body, trainingDays: 3 } })
    let release = () => {}
    hub.saveStep.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({}) }))
    const page = mount('/onboarding/goal')
    await flush()
    click(radio(page, 'Build muscle'))
    click(radio(page, 'Keep my weight'))
    expect(hub.saveStep).toHaveBeenCalledTimes(1)

    mocks.user = BEA
    rerender()
    release()
    await flush()
    expect(hub.saveStep).toHaveBeenCalledTimes(1)
  })
})

describe('the AI coach\'s consent', () => {
  it('is not carried to B in A\'s unsaved plan', async () => {
    mocks.user = BEA
    saved({ uid: 'u1', answers: { goal: 'keep', body, trainingDays: 3, plan: coach }, unsaved: ['plan'], pick: 'coach' })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(hub.saveStep).not.toHaveBeenCalled()
    expect(sentToHub()).not.toMatch(/consent/)
  })

  it('is not carried across a reload, and Finish does not complete without the plan: it asks for it again', async () => {
    mocks.user = MARIA
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, step: null, coachAvailable: true, starterAvailable: true, coachConsent: CONSENT })
    saved({ answers: { goal: 'keep', body, trainingDays: 3, plan: coach }, unsaved: ['plan'], pick: 'coach' })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(where(page)).toBe('/onboarding/plan')
    expect(hub.saveStep).not.toHaveBeenCalled()
    expect(hub.completeOnboarding).not.toHaveBeenCalled()
    expect(radio(page, 'Have the AI coach build one').getAttribute('aria-checked')).toBe('false')
  })

  it('tap consent, reload before the hub has it: Finish lands on Plan and the coach sheet asks again', async () => {
    mocks.user = MARIA
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, step: null, coachAvailable: true, starterAvailable: true, coachConsent: CONSENT })
    // The hub never receives the choice (no connection when the sheet's Build was tapped).
    hub.saveStep.mockRejectedValue(Object.assign(new Error('x'), { status: 0, code: 'offline' }))
    saved({ answers: { goal: 'keep', body, trainingDays: 3 } })
    const first = mount('/onboarding/plan')
    await flush()
    click(radio(first, 'Have the AI coach build one'))
    act(() => { vi.advanceTimersByTime(640) })
    const sheet = openedSheet()
    expect(sheet.host.textContent).toContain('An AI model reads your 3 training days.')
    click(button(sheet.host, 'Build my plan'))
    await flush()
    sheet.done()
    expect(where(first)).toBe('/onboarding/finish')
    expect(kept().answers.plan).toBeNull()

    // The reload: the tab's storage stays, the page starts over.
    unmountAll()
    mocks.sheets.length = 0
    const reloaded = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(reloaded, 'Go to Home').click() })
    await flush()
    expect(where(reloaded)).toBe('/onboarding/plan')
    expect(hub.completeOnboarding).not.toHaveBeenCalled()
    click(radio(reloaded, 'Have the AI coach build one'))
    act(() => { vi.advanceTimersByTime(640) })
    expect(mocks.sheets).toHaveLength(1)
    const again = openedSheet()
    expect(button(again.host, 'Build my plan')).toBeTruthy()
    again.done()
  })

  it('a coach plan the hub stored before the reload counts as chosen: Finish completes', async () => {
    mocks.user = MARIA
    const stored = { ...coach, consentAt: '2026-10-15T08:00:00.000Z' }
    hub.loadOnboarding.mockResolvedValue({ answers: { plan: stored }, completedAt: null, step: null, coachAvailable: true, starterAvailable: true, coachConsent: CONSENT })
    saved({ answers: { goal: 'keep', body, trainingDays: 3 } })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(hub.completeOnboarding).toHaveBeenCalled()
    expect(where(page)).toBe('/home')
  })

  it('no plan owed: no training days, or a plan of none, finish as before', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'keep', body, trainingDays: 3, plan: { kind: 'none' } } })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(hub.completeOnboarding).toHaveBeenCalled()
    expect(where(page)).toBe('/home')
  })
})

describe('leaving the flow', () => {
  it('forgets everything and starts over when the hub says it is complete', async () => {
    mocks.user = MARIA
    saved({ code: 'AB12', answers: { goal: 'lose', body, trainingDays: 3 }, unsaved: ['body'] })
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: '2026-10-15T08:00:00.000Z', step: null })
    const page = mount('/onboarding/sex')
    await flush()
    expect(where(page)).toBe('/home')
    expect(sessionStorage.getItem(STORE)).toBeNull()
  })

  it('forgets everything when the flow steps aside because there is no hub here', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'lose', body, trainingDays: 3 } })
    hub.loadOnboarding.mockRejectedValue(Object.assign(new Error('x'), { status: 404, code: 'http' }))
    const page = mount('/onboarding/sex')
    await flush()
    expect(where(page)).toBe('/home')
    expect(sessionStorage.getItem(STORE)).toBeNull()
  })

  it('forgets everything once the onboarding is finished', async () => {
    mocks.user = MARIA
    saved({ answers: { goal: 'keep', body, trainingDays: 0 } })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(where(page)).toBe('/home')
    expect(sessionStorage.getItem(STORE)).toBeNull()
  })
})
