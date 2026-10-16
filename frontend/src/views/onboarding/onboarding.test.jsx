// @vitest-environment happy-dom
// The onboarding's screens, as a person goes through them (ux-onboarding §3b): the skip paths, the
// detour, a cancelled passkey, the keyboard, the pickers' slider semantics and reduced motion.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { arrivedBy, button, flush, mount, radio, saved, unmountAll, where } from './onboarding.test-util.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { user: null, sheets: [], toasts: [], pullState: vi.fn(async () => {}) }
  state.store = () => ({
    user: state.user, config: {}, S: {},
    setUser: vi.fn(u => { state.user = u }), pushState: vi.fn(), pullState: state.pullState, adoptProfile: vi.fn(async () => {}),
  })
  return state
})
vi.mock('../../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.store()) : mocks.store())
  useStore.getState = mocks.store
  return { useStore, hasData: () => false }
})
vi.mock('../../store/useUI.js', () => {
  const snap = () => ({
    sheets: [],
    toast: msg => mocks.toasts.push(msg),
    openSheet: render => { mocks.sheets.push(render); return { close: () => {} } },
  })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
const hub = vi.hoisted(() => ({
  checkInvite: vi.fn(), loadOnboarding: vi.fn(), saveStep: vi.fn(), previewTargets: vi.fn(), completeOnboarding: vi.fn(), passkeySynced: vi.fn(),
}))
vi.mock('../../lib/onboarding/api.js', async original => ({ ...(await original()), ...hub }))
const passkeys = vi.hoisted(() => ({ passkeyRegister: vi.fn(), passkeyLogin: vi.fn() }))
vi.mock('../../lib/api.js', async original => ({ ...(await original()), ...passkeys, webauthnOK: () => true }))
vi.mock('../../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))
const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }))
vi.mock('../../lib/clipboard.js', () => clipboard)

const signedIn = () => { mocks.user = { id: 'u1', name: 'Maria' } }
const press = (el, key) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
const click = el => act(() => { el.click() })
const later = ms => act(() => { vi.advanceTimersByTime(ms) })
const full = { sex: 'female', birthYear: 1990, heightCm: 168, weightKg: 64 }
// The AI coach consent as the hub sends it (fitness-hub src/onboarding/consent.ts), the one copy.
const CONSENT = {
  version: 'ai-coach-build-v1',
  reads: {
    one: 'An AI model reads your goal, your body details and your {0} training day, then drafts a plan. You review it before anything goes on your week.',
    other: 'An AI model reads your goal, your body details and your {0} training days, then drafts a plan. You review it before anything goes on your week.',
  },
  where: 'These answers go to the AI service this Gains server uses. Your food log and your friends are not sent. Tapping Build my plan sends them once.',
}
// A coach plan the hub holds: the tap on the sheet was in an earlier session, and the hub kept the
// choice with the time it stamped. The app does not keep a coach plan across a reload, but the hub's
// counts as chosen.
const COACH_STORED = { kind: 'coach', experience: null, equipment: 'gym', consentVersion: 'ai-coach-build-v1', consentAt: '2026-10-15T08:00:00.000Z' }
const hubHoldsCoach = () => hub.loadOnboarding.mockResolvedValueOnce({
  answers: { plan: COACH_STORED }, completedAt: null, step: null, coachAvailable: true, starterAvailable: true, coachConsent: CONSENT,
})
// Renders the sheet the screen opened (the shell's sheet host is mocked away).
function openedSheet(close = vi.fn()) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(mocks.sheets.at(-1)(close)))
  return { host, close, done: () => { act(() => root.unmount()); host.remove() } }
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  mocks.user = null
  mocks.sheets.length = 0
  mocks.toasts.length = 0
  mocks.pullState.mockClear()
  Object.values(hub).forEach(f => f.mockReset())
  Object.values(passkeys).forEach(f => f.mockReset())
  hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, step: null, coachAvailable: true, starterAvailable: true, coachConsent: CONSENT })
  hub.saveStep.mockResolvedValue({})
  hub.previewTargets.mockResolvedValue({ ready: true, targets: { calories: 1620 } })
  hub.passkeySynced.mockResolvedValue(true)
  delete document.documentElement.dataset.motion
})
afterEach(() => { unmountAll(); vi.useRealTimers() })

describe('0 Invite', () => {
  it('checks the code on arrival and names the inviter; Create my account goes to the name step', async () => {
    hub.checkInvite.mockResolvedValue({ status: 'valid', inviterName: 'Andrei', suggestedName: 'Maria' })
    const page = mount('/join/AB12')
    await flush()
    expect(hub.checkInvite).toHaveBeenCalledWith('AB12')
    expect(page.querySelector('h1').textContent).toBe('Andrei invited you to Gains')
    click(button(page, 'Create my account'))
    expect(where(page)).toBe('/onboarding/name')
  })

  it('says an invite is used, with Sign in as the way on', async () => {
    hub.checkInvite.mockResolvedValue({ status: 'used', inviterName: null, suggestedName: null })
    const page = mount('/join/AB12')
    await flush()
    expect(page.querySelector('h1').textContent).toBe('This invite has already been used.')
    expect(button(page, 'Sign in')).toBeTruthy()
    expect(button(page, 'Create my account')).toBeUndefined()
  })

  it('offers to try again when the check gets no answer', async () => {
    hub.checkInvite.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unavailable' }))
    hub.checkInvite.mockResolvedValueOnce({ status: 'valid', inviterName: null, suggestedName: null })
    const page = mount('/join/AB12')
    await flush()
    expect(page.querySelector('h1').textContent).toBe('We couldn’t check this invite')
    click(button(page, 'Try again'))
    await flush()
    expect(page.querySelector('h1').textContent).toBe('You’re invited to Gains')
  })

  it('leaves the invite unused for someone already signed in here', async () => {
    signedIn()
    const page = mount('/join/AB12')
    await flush()
    expect(hub.checkInvite).not.toHaveBeenCalled()
    expect(page.querySelector('h1').textContent).toBe('You’re already in as Maria')
    click(button(page, 'Open Gains'))
    expect(where(page)).toBe('/home')
  })
})

describe('1 Name + passkey', () => {
  it('prefills the suggested name, and a cancelled prompt says so inline with help to hand', async () => {
    saved({ uid: null, code: 'AB12', invite: { status: 'valid', inviterName: 'Andrei', suggestedName: 'Maria' }, answers: {} })
    passkeys.passkeyRegister.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    const page = mount('/onboarding/name')
    expect(page.querySelector('input').value).toBe('Maria')
    await act(async () => { button(page, 'Create passkey').click() })
    expect(passkeys.passkeyRegister).toHaveBeenCalledWith('Maria', 'AB12')
    expect(page.querySelector('[role="alert"]').textContent).toContain('No passkey created. Try again.')
    expect(where(page)).toBe('/onboarding/name')
    click(button(page, 'Having trouble?'))
    expect(mocks.sheets).toHaveLength(1)
  })

  it.each([
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', 'Copy link to open in Chrome'],
    ['iOS', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 'Copy link to open in Safari'],
  ])('names the phone\'s own browser for the link on %s', async (_, ua, label) => {
    const agent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
    saved({ uid: null, code: 'AB12', invite: { status: 'valid', inviterName: null, suggestedName: 'Maria' }, answers: {} })
    passkeys.passkeyRegister.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    const page = mount('/onboarding/name')
    await act(async () => { button(page, 'Create passkey').click() })
    click(button(page, 'Having trouble?'))
    const sheet = openedSheet()
    expect(button(sheet.host, label)).toBeTruthy()
    sheet.done()
    agent.mockRestore()
  })

  it('copies the invite link, with its code, not the address of the name step', async () => {
    saved({ uid: null, code: 'AB12', invite: { status: 'valid', inviterName: null, suggestedName: 'Maria' }, answers: {} })
    passkeys.passkeyRegister.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    clipboard.copyText.mockResolvedValue(undefined)
    const page = mount('/onboarding/name')
    await act(async () => { button(page, 'Create passkey').click() })
    click(button(page, 'Having trouble?'))
    const sheet = openedSheet()
    await act(async () => { button(sheet.host, 'Copy link to open in your browser').click() })
    expect(clipboard.copyText).toHaveBeenCalledWith(`${window.location.origin}/join/AB12`)
    expect(sheet.close).toHaveBeenCalled()
    sheet.done()
  })

  it('leaves the landing\'s address out of the history: Create my account replaces it', async () => {
    hub.checkInvite.mockResolvedValue({ status: 'valid', inviterName: 'Andrei', suggestedName: null })
    const page = mount('/join/AB12')
    await flush()
    click(button(page, 'Create my account'))
    expect(where(page)).toBe('/onboarding/name')
    expect(arrivedBy(page)).toBe('REPLACE')
  })

  it('makes the account and moves to the passkey result, which moves on to the goal by itself', async () => {
    saved({ uid: null, code: 'AB12', answers: {} })
    passkeys.passkeyRegister.mockResolvedValue({ id: 'u1', name: 'Maria' })
    const page = mount('/onboarding/name')
    act(() => {
      const input = page.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Maria')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button(page, 'Create passkey').click() })
    await flush()
    expect(where(page)).toBe('/onboarding/passkey')
    expect(page.querySelector('h1').textContent).toBe('Passkey saved')
    expect(page.textContent).toContain('It works on all your devices.')
    later(1500)
    expect(where(page)).toBe('/onboarding/goal')
  })

  it('cannot be sent without a name', () => {
    saved({ uid: null, code: 'AB12', answers: {} })
    const page = mount('/onboarding/name')
    expect(button(page, 'Create passkey').disabled).toBe(true)
  })

  it('sends the person to the invite landing when no invite was checked in this tab, and makes no account', () => {
    const page = mount('/onboarding/name')
    expect(where(page)).toBe('/join')
    expect(button(page, 'Create passkey')).toBeUndefined()
    expect(passkeys.passkeyRegister).not.toHaveBeenCalled()
  })

  it('lets an invite left behind go when the landing has no code in its address', async () => {
    saved({ uid: null, code: 'OLD1', name: 'Bob', invite: { status: 'valid', inviterName: 'Andrei', suggestedName: null }, answers: {} })
    const page = mount('/join')
    await flush()
    expect(page.querySelector('h1').textContent).toBe('This invite link doesn’t work')
    expect(sessionStorage.getItem('gains_onboarding')).toBeNull()
    // The name step is no longer reachable with the old code.
    unmountAll()
    expect(where(mount('/onboarding/name'))).toBe('/join')
  })

  it('starts the name over, and registers with the new code, when another invite is opened in the same tab', async () => {
    saved({ uid: null, code: 'OLD1', name: 'Bob', invite: { status: 'valid', inviterName: 'Andrei', suggestedName: null }, answers: {} })
    hub.checkInvite.mockResolvedValue({ status: 'valid', inviterName: 'Ana', suggestedName: null })
    passkeys.passkeyRegister.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    const page = mount('/join/NEW2')
    await flush()
    click(button(page, 'Create my account'))
    const input = page.querySelector('input')
    expect(input.value).toBe('')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Maria')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button(page, 'Create passkey').click() })
    expect(passkeys.passkeyRegister).toHaveBeenCalledWith('Maria', 'NEW2')
  })
})

describe('2 Goal', () => {
  beforeEach(signedIn)

  it('moves on 650ms after a tap, and saves the goal', async () => {
    const page = mount('/onboarding/goal')
    await flush()
    click(radio(page, 'Build muscle'))
    expect(radio(page, 'Build muscle').getAttribute('aria-checked')).toBe('true')
    expect(hub.saveStep).toHaveBeenCalledWith('goal', expect.objectContaining({ goal: 'build' }), 'u1')
    expect(where(page)).toBe('/onboarding/goal')
    later(650)
    expect(where(page)).toBe('/onboarding/sex')
  })

  it('arrow keys choose without moving on, with one radio in the tab order', async () => {
    const page = mount('/onboarding/goal')
    await flush()
    const first = radio(page, 'Lose weight')
    expect([...page.querySelectorAll('[role="radio"]')].map(r => r.tabIndex)).toEqual([0, -1, -1, -1])
    act(() => first.focus())
    press(first, 'ArrowDown')
    expect(radio(page, 'Keep my weight').getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radio(page, 'Keep my weight'))
    later(1000)
    expect(where(page)).toBe('/onboarding/goal')
  })

  it('saves rapid arrow keys one at a time, the last answer last, and an older answer never after it', async () => {
    const page = mount('/onboarding/goal')
    await flush()
    // Each save answers only when told to, so they would cross if sent together.
    const answers = []
    let inFlight = 0
    let most = 0
    hub.saveStep.mockImplementation((step, a) => {
      most = Math.max(most, ++inFlight)
      return new Promise(resolve => answers.push(() => { inFlight--; resolve({ step, goal: a.goal }) }))
    })
    const first = radio(page, 'Lose weight')
    act(() => first.focus())
    press(first, 'ArrowDown')
    press(document.activeElement, 'ArrowDown')
    press(document.activeElement, 'ArrowDown')
    press(document.activeElement, 'ArrowUp')
    expect(radio(page, 'Build muscle').getAttribute('aria-checked')).toBe('true')
    // One on its way, one more waiting for it: the three presses after the first are one save.
    expect(hub.saveStep).toHaveBeenCalledTimes(1)
    while (answers.length) await act(async () => { answers.shift()() ; await Promise.resolve() })
    await flush()
    expect(most, 'never two at once').toBe(1)
    const sent = hub.saveStep.mock.calls.map(([, a]) => a.goal)
    expect(sent).toEqual(['keep', 'build'])
    expect(sent.at(-1)).toBe('build')
  })

  it('has no Skip and no way back to making the account', async () => {
    const page = mount('/onboarding/goal')
    await flush()
    expect(button(page, 'Skip')).toBeUndefined()
    expect(page.querySelector('[aria-label="Back"]').disabled).toBe(true)
  })
})

describe('3 About you', () => {
  beforeEach(() => { signedIn(); saved({ answers: { goal: 'keep' } }) })

  it('skips the four steps to Training from any of them', async () => {
    const page = mount('/onboarding/born')
    await flush()
    click(button(page, 'Skip'))
    expect(where(page)).toBe('/onboarding/training')
  })

  it('3a: a tap moves on after 600ms and the live target narrows', async () => {
    const page = mount('/onboarding/sex')
    await flush()
    const before = page.querySelector('.ob-tgt-n').textContent
    click(radio(page, 'Female'))
    expect(page.querySelector('.ob-cap').textContent).toMatch(/^Your target is now about/)
    later(600)
    expect(page.querySelector('.ob-tgt-n').textContent).not.toBe(before)
    expect(where(page)).toBe('/onboarding/born')
  })

  it('3b: the wheel is a vertical slider, untouched until moved, typed with Enter', async () => {
    const page = mount('/onboarding/born')
    await flush()
    const wheel = page.querySelector('[role="slider"]')
    expect(wheel.getAttribute('aria-orientation')).toBe('vertical')
    expect(wheel.getAttribute('aria-valuenow')).toBe('1990')
    expect(wheel.getAttribute('aria-valuetext')).toBe('Born 1990, not set')
    expect(button(page, 'Next').disabled).toBe(true)
    press(wheel, 'ArrowDown')
    expect(wheel.getAttribute('aria-valuetext')).toBe('Born 1991')
    expect(button(page, 'Next').disabled).toBe(false)
    press(wheel, 'PageUp')
    expect(wheel.getAttribute('aria-valuenow')).toBe('1981')
    press(wheel, 'Enter')
    const field = page.querySelector('input[aria-label="Year you were born"]')
    expect(document.activeElement).toBe(field)
    // Not inside the slider, whose children are presentational: the field is reachable.
    expect(field.closest('[role="slider"]')).toBeNull()
    act(() => { field.value = '1850' })
    press(field, 'Enter')
    expect(mocks.toasts).toContain('Kept within 1926–2011')
    expect(wheel.getAttribute('aria-valuenow')).toBe('1926')
  })

  it('3b: Escape leaves the typed year as it was', async () => {
    const page = mount('/onboarding/born')
    await flush()
    const wheel = page.querySelector('[role="slider"]')
    press(wheel, 'Enter')
    const field = page.querySelector('.ob-pk-in')
    act(() => { field.value = '1970' })
    press(field, 'Escape')
    expect(page.querySelector('.ob-pk-in')).toBeNull()
    expect(wheel.getAttribute('aria-valuenow')).toBe('1990')
  })

  it('3b: the live caption speaks once the wheel settles, not at every step on the way', async () => {
    saved({ answers: { goal: 'keep', body: { ...full, birthYear: 1990 } } })
    const page = mount('/onboarding/born')
    await flush()
    const cap = () => page.querySelector('.ob-cap').textContent
    expect(cap()).toMatch(/^Born 1990\. /)
    const wheel = page.querySelector('[role="slider"]')
    const spin = () => act(() => { wheel.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, bubbles: true, cancelable: true })) })
    spin()
    expect(wheel.getAttribute('aria-valuenow')).toBe('1991')
    spin()
    expect(wheel.getAttribute('aria-valuenow')).toBe('1992')
    expect(cap()).toMatch(/^Born 1990\. /)
    later(240)
    expect(cap()).toMatch(/^Born 1992\. /)
  })

  it('3d: the hub\'s target still on its way when Back is tapped shows on the screen before, asked once', async () => {
    // Answers of their own: the target's cache outlives a test.
    saved({ answers: { goal: 'keep', body: { sex: 'male', birthYear: 1985, heightCm: 181, weightKg: null } } })
    let reply
    hub.previewTargets.mockImplementation(() => new Promise(resolve => { reply = resolve }))
    const page = mount('/onboarding/weight')
    await flush()
    press(page.querySelector('[role="slider"]'), 'ArrowLeft')
    later(300)
    expect(hub.previewTargets).toHaveBeenCalledTimes(1)
    click(page.querySelector('[aria-label="Back"]'))
    expect(where(page)).toBe('/onboarding/height')
    later(300)
    await act(async () => { reply({ ready: true, targets: { calories: 2480 } }) })
    await flush()
    expect(page.querySelector('.ob-cap').textContent).toContain('Your starting target:')
    expect(hub.previewTargets).toHaveBeenCalledTimes(1)
  })

  it('3c: the ruler steps with the arrows and switches to feet and inches', async () => {
    const page = mount('/onboarding/height')
    await flush()
    const ruler = page.querySelector('[role="slider"]')
    expect(ruler.getAttribute('aria-valuemax')).toBe('230')
    press(ruler, 'ArrowRight')
    expect(ruler.getAttribute('aria-valuetext')).toBe('171 centimetres')
    click(page.querySelector('.ob-uchip'))
    expect(ruler.getAttribute('aria-valuemax')).toBe('90')
    expect(ruler.getAttribute('aria-valuetext')).toBe('5 feet 7 inches')
    expect(page.querySelector('.ob-uchip').getAttribute('aria-label')).toBe('Units: feet and inches. Switch to centimetres')
  })

  it('3d: with all four in, the ring firms up to the hub\'s target, and Next goes to Training', async () => {
    saved({ answers: { goal: 'keep', body: { ...full, weightKg: null } } })
    const page = mount('/onboarding/weight')
    await flush()
    const ruler = page.querySelector('[role="slider"]')
    press(ruler, 'ArrowLeft')
    await act(async () => { vi.advanceTimersByTime(300) })
    await flush()
    expect(hub.previewTargets).toHaveBeenCalled()
    expect(page.querySelector('.ob-cap').textContent).toContain('Your starting target: 1,620 kcal a day.')
    click(button(page, 'Next'))
    expect(hub.saveStep).toHaveBeenCalledWith('body', expect.anything(), 'u1')
    expect(where(page)).toBe('/onboarding/training')
  })
})

describe('4 Training', () => {
  beforeEach(() => { signedIn(); saved({ answers: { goal: 'keep', body: full } }) })

  it('0 days goes to the end, any other number to Plan', async () => {
    let page = mount('/onboarding/training')
    await flush()
    click(page.querySelector('[aria-label="0, just tracking food"]'))
    expect(page.querySelector('.ob-cap').textContent).toBe('Just tracking food. You can add training any time.')
    later(600)
    expect(where(page)).toBe('/onboarding/finish')
    unmountAll()
    page = mount('/onboarding/training')
    await flush()
    click(radio(page, '3'))
    expect(page.querySelector('.ob-cap').textContent).toBe('Suggested: Monday, Wednesday, Friday')
    later(600)
    expect(where(page)).toBe('/onboarding/plan')
  })

  it('Skip saves no days and goes to the end', async () => {
    const page = mount('/onboarding/training')
    await flush()
    click(button(page, 'Skip'))
    expect(hub.saveStep).toHaveBeenCalledWith('training', expect.objectContaining({ trainingDays: null }), 'u1')
    expect(where(page)).toBe('/onboarding/finish')
  })
})

describe('5 Plan', () => {
  beforeEach(() => { signedIn(); saved({ answers: { goal: 'keep', body: full, trainingDays: 3 } }) })

  it('offers the AI coach only where the server has one', async () => {
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, coachAvailable: false, starterAvailable: true })
    const page = mount('/onboarding/plan')
    await flush()
    expect(radio(page, 'Have the AI coach build one')).toBeUndefined()
    expect([...page.querySelectorAll('[role="radio"]')].every(r => r.getAttribute('aria-checked') === 'false')).toBe(true)
  })

  it('offers a plan only where the hub says openGym takes it, never from this app\'s own config', async () => {
    // An openGym from before the ready-made plans: the hub offers neither plan.
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, coachAvailable: false, starterAvailable: false })
    let page = mount('/onboarding/plan')
    await flush()
    expect([...page.querySelectorAll('[role="radio"]')].map(r => r.textContent)).toEqual([expect.stringContaining('No plan for now')])
    unmountAll()
    // The hub not reached: nothing is known, and nothing is offered on a guess.
    hub.loadOnboarding.mockRejectedValue(Object.assign(new Error('x'), { status: 0, code: 'offline' }))
    page = mount('/onboarding/plan')
    await flush()
    expect(radio(page, 'Use a ready-made plan')).toBeUndefined()
    expect(radio(page, 'Have the AI coach build one')).toBeUndefined()
  })

  it('No plan saves the choice and goes to the end; Skip does the same', async () => {
    const page = mount('/onboarding/plan')
    await flush()
    click(radio(page, 'No plan for now'))
    expect(hub.saveStep).toHaveBeenCalledWith('plan', expect.objectContaining({ plan: { kind: 'none' } }), 'u1')
    later(620)
    expect(where(page)).toBe('/onboarding/finish')
  })

  it('the AI coach opens its consent sheet; Build saves the plan and goes to the end', async () => {
    const page = mount('/onboarding/plan')
    await flush()
    click(radio(page, 'Have the AI coach build one'))
    later(640)
    expect(mocks.sheets).toHaveLength(1)
    const sheetHost = document.createElement('div')
    document.body.appendChild(sheetHost)
    const sheetRoot = createRoot(sheetHost)
    const close = vi.fn()
    act(() => sheetRoot.render(mocks.sheets[0](close)))
    expect(sheetHost.textContent).toContain('These answers go to the AI service')
    click([...sheetHost.querySelectorAll('[role="radio"]')].find(r => r.textContent === 'Dumbbells only'))
    click(button(sheetHost, 'Build my plan'))
    // The consent is to the text shown, by its id; the time is the hub's to stamp, never the phone's.
    const sent = hub.saveStep.mock.calls.findLast(([step]) => step === 'plan')[1].plan
    expect(sent).toEqual({ kind: 'coach', experience: null, equipment: 'dumbbells', consentVersion: 'ai-coach-build-v1' })
    expect(sent).not.toHaveProperty('consentAt')
    expect(close).toHaveBeenCalled()
    expect(where(page)).toBe('/onboarding/finish')
    act(() => sheetRoot.unmount())
    sheetHost.remove()
  })

  it('shows the consent text the hub sends, and agrees to that text by the id it came with', async () => {
    // A text the app has never seen: it shows what the hub sent, never a copy of its own.
    const v2 = {
      version: 'ai-coach-build-v2',
      reads: { one: 'A model reads your {0} day.', other: 'A model reads your {0} days and your goal.' },
      where: 'They go to this server’s AI service, once.',
    }
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, coachAvailable: true, starterAvailable: true, coachConsent: v2 })
    const page = mount('/onboarding/plan')
    await flush()
    click(radio(page, 'Have the AI coach build one'))
    later(640)
    const sheet = openedSheet()
    expect(sheet.host.textContent).toContain('A model reads your 3 days and your goal.')
    expect(sheet.host.textContent).toContain('They go to this server’s AI service, once.')
    expect(sheet.host.textContent).not.toContain('These answers go to the AI service')
    click(button(sheet.host, 'Build my plan'))
    const sent = hub.saveStep.mock.calls.findLast(([step]) => step === 'plan')[1].plan
    expect(sent.consentVersion).toBe('ai-coach-build-v2')
    sheet.done()
    expect(where(page)).toBe('/onboarding/finish')
  })

  it('offers no AI coach while the hub has sent no consent text to show', async () => {
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, coachAvailable: true, starterAvailable: true })
    const page = mount('/onboarding/plan')
    await flush()
    expect(radio(page, 'Have the AI coach build one')).toBeUndefined()
  })

  it('Not now on the coach sheet puts the choice back to nothing picked', async () => {
    const page = mount('/onboarding/plan')
    await flush()
    click(radio(page, 'Have the AI coach build one'))
    later(640)
    const sheetHost = document.createElement('div')
    const sheetRoot = createRoot(sheetHost)
    act(() => sheetRoot.render(mocks.sheets[0](() => {})))
    act(() => sheetRoot.unmount())
    expect(radio(page, 'Have the AI coach build one').getAttribute('aria-checked')).toBe('false')
    expect(where(page)).toBe('/onboarding/plan')
  })

  it('a ready-made plan opens its preview, where a session moves to a free day and the plan is used', async () => {
    const page = mount('/onboarding/plan')
    await flush()
    click(radio(page, 'Use a ready-made plan'))
    later(560)
    expect(where(page)).toBe('/onboarding/starter')
    const day = name => [...page.querySelectorAll('.ob-pday')].find(b => b.getAttribute('aria-label').startsWith(name))
    expect(day('Monday').getAttribute('aria-pressed')).toBe('true')
    click(day('Tuesday'))
    expect(day('Tuesday').getAttribute('aria-pressed')).toBe('true')
    click(button(page, 'Use this plan'))
    expect(hub.saveStep).toHaveBeenLastCalledWith('plan', expect.objectContaining({
      plan: { kind: 'starter', templateId: 'full-body', weekdays: [2, 3, 5], equipment: 'gym', experience: 'new' },
    }), 'u1')
    expect(where(page)).toBe('/onboarding/finish')
  })
})

describe('the end (placeholder for the Summary)', () => {
  beforeEach(signedIn)

  it('completes on the hub and goes Home', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 0 } })
    hub.completeOnboarding.mockResolvedValue({ completedAt: 1 })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(hub.completeOnboarding).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 'u1')
    expect(where(page)).toBe('/home')
  })

  it('never completes with an answer the hub has not taken: it says so, and can finish later', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 0 }, unsaved: ['body'] })
    hub.saveStep.mockRejectedValue(Object.assign(new Error('bad'), { status: 400, code: 'http' }))
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(hub.completeOnboarding).not.toHaveBeenCalled()
    expect(page.querySelector('h1').textContent).toBe('Your answers could not be saved yet')
    click(button(page, 'Finish later'))
    expect(where(page)).toBe('/home')
  })

  it('sends failed saves again one at a time, in step order, before completing', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 3, plan: { kind: 'none' } }, unsaved: ['plan', 'goal', 'training'] })
    let inFlight = 0
    let most = 0
    hub.saveStep.mockImplementation(async () => {
      most = Math.max(most, ++inFlight)
      await Promise.resolve()
      inFlight--
      return {}
    })
    hub.completeOnboarding.mockResolvedValue({ completedAt: 1, delivery: { opengym: 'done', nutritrace: 'done' } })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(hub.saveStep.mock.calls.map(([step]) => step)).toEqual(['goal', 'training', 'plan'])
    expect(most, 'never two at once').toBe(1)
    expect(hub.completeOnboarding).toHaveBeenCalled()
  })

  it('asks the Plan step again when the hub says the plan chosen can no longer be taken here', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 3 } })
    hubHoldsCoach()
    hub.completeOnboarding.mockRejectedValue(Object.assign(new Error('the AI coach is not available on this server'), { status: 409, code: 'plan-unavailable' }))
    const page = mount('/onboarding/finish')
    await flush()
    // The server's AI coach was turned off since: the hub cleared the plan and offers no coach.
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, coachAvailable: false, starterAvailable: true, next: 'plan', remaining: ['plan'] })
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(where(page)).toBe('/onboarding/plan')
    expect(mocks.toasts).toEqual(['That plan can’t be set up on this server right now. Pick another.'])
    expect(radio(page, 'Have the AI coach build one')).toBeUndefined()
    expect(JSON.parse(sessionStorage.getItem('gains_onboarding')).answers.plan).toBeNull()
  })

  it('stays on the last step, with Try again, when the hub cannot be read after refusing the plan', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 3 } })
    hubHoldsCoach()
    hub.completeOnboarding.mockRejectedValueOnce(Object.assign(new Error('the AI coach is not available on this server'), { status: 409, code: 'plan-unavailable' }))
    const page = mount('/onboarding/finish')
    await flush()
    hub.loadOnboarding.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 502, code: 'http' }))
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(where(page)).toBe('/onboarding/finish')
    expect(page.querySelector('h1').textContent).toBe('Your answers could not be saved yet')
    expect(button(page, 'Try again')).toBeTruthy()
    expect(hub.completeOnboarding).toHaveBeenCalledTimes(1)
  })

  it('plans on the days the data holds now, after the hub refused a plan made for the old ones', async () => {
    // The days came from openGym's data, and changed there mid-onboarding (3 to 2).
    const starter = { kind: 'starter', templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'gym', experience: 'new' }
    saved({ answers: { goal: 'keep', body: full, trainingDays: 3, plan: starter }, pick: 'starter' })
    hub.completeOnboarding.mockRejectedValueOnce(Object.assign(new Error('weekdays: the plan\'s sessions must match the training days'), { status: 409, code: 'plan-unavailable' }))
    const page = mount('/onboarding/finish')
    await flush()
    hub.loadOnboarding.mockResolvedValue({
      answers: {}, completedAt: null, coachAvailable: false, starterAvailable: true, next: 'plan', remaining: ['plan'],
      prefill: { answered: ['training'], training: { trainingDays: 2 }, sources: { opengym: 'ok', nutritrace: 'ok' } },
    })
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(where(page)).toBe('/onboarding/plan')
    expect(page.textContent).toContain('A starter plan for 2 days a week')
    expect(JSON.parse(sessionStorage.getItem('gains_onboarding')).answers.trainingDays).toBe(2)
  })

  it('says so when Training has not taken its part yet, and goes Home', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 0 } })
    hub.completeOnboarding.mockResolvedValue({ completedAt: 1, delivery: { opengym: 'retrying', nutritrace: 'done' } })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(mocks.toasts).toEqual(['Saved. Some of it is still on its way to Training and will show up there soon.'])
    expect(where(page)).toBe('/home')
  })

  it('reads openGym again once it took its write, so Home shows the plan and the weigh-in', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 0 } })
    hub.completeOnboarding.mockResolvedValue({ completedAt: 1, delivery: { opengym: 'done', nutritrace: 'done' }, plan: null })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(mocks.pullState).toHaveBeenCalledTimes(1)
    expect(mocks.toasts).toEqual([])
    expect(where(page)).toBe('/home')
  })

  it('never says a write Training refused for good is on its way: it says what to do, and where', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 0 } })
    hub.completeOnboarding.mockResolvedValue({ completedAt: 1, delivery: { opengym: 'failed', nutritrace: 'done' }, plan: null })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(mocks.toasts).toEqual([])
    expect(mocks.pullState).not.toHaveBeenCalled()
    expect(where(page)).toBe('/onboarding/finish')
    expect(page.querySelector('h1').textContent).toBe('Not everything could be set up')
    expect(page.querySelector('.ob-sub').textContent).toBe('Training didn’t take your answers. Add your weight and a plan there.')
    click(button(page, 'Open Training'))
    expect(where(page)).toBe('/train')
  })

  it('says a refused plan plainly, with Training to pick one, and Home as the other way on', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 3, plan: { kind: 'starter', templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'gym', experience: 'new' } } })
    hub.completeOnboarding.mockResolvedValue({
      completedAt: 1, delivery: { opengym: 'done', nutritrace: 'failed' }, plan: { status: 'refused', kind: 'starter', code: 'bad-plan' },
    })
    const page = mount('/onboarding/finish')
    await flush()
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    expect(page.querySelector('.ob-sub').textContent).toBe(
      'Your plan couldn’t be set up. Pick one in Training. Food didn’t take your targets. Set them in Food goals.',
    )
    expect(button(page, 'Open Training')).toBeTruthy()
    expect(button(page, 'Open Food goals')).toBeTruthy()
    // The rest of the write went in: it is read into the app.
    expect(mocks.pullState).toHaveBeenCalledTimes(1)
    click(button(page, 'Go to Home'))
    expect(where(page)).toBe('/home')
  })

  it('finishes with no plan, and no Plan screen of one card, when the hub refuses the plan and offers no other', async () => {
    saved({ answers: { goal: 'keep', body: full, trainingDays: 3 } })
    hubHoldsCoach()
    hub.completeOnboarding
      .mockRejectedValueOnce(Object.assign(new Error('the AI coach is not available on this server'), { status: 409, code: 'plan-unavailable' }))
      .mockResolvedValueOnce({ completedAt: 1, delivery: { opengym: 'done', nutritrace: 'done' }, plan: null })
    const page = mount('/onboarding/finish')
    await flush()
    hub.loadOnboarding.mockResolvedValue({ answers: {}, completedAt: null, coachAvailable: false, starterAvailable: false, next: 'plan', remaining: ['plan'] })
    await act(async () => { button(page, 'Go to Home').click() })
    await flush()
    await flush()
    expect(hub.saveStep).toHaveBeenCalledWith('plan', expect.objectContaining({ plan: { kind: 'none' } }), 'u1')
    expect(hub.completeOnboarding).toHaveBeenCalledTimes(2)
    expect(mocks.toasts).toEqual([])
    expect(where(page)).toBe('/home')
  })

  it('detours through only the missing details and comes back', async () => {
    saved({ answers: { goal: 'keep', body: { ...full, birthYear: null }, trainingDays: 0 }, skippedYou: true })
    const page = mount('/onboarding/finish')
    await flush()
    click(button(page, 'Add my details'))
    expect(where(page)).toBe('/onboarding/born')
    press(page.querySelector('[role="slider"]'), 'ArrowDown')
    expect(button(page, 'Done')).toBeTruthy()
    click(button(page, 'Done'))
    expect(where(page)).toBe('/onboarding/finish')
    expect(button(page, 'Add my details')).toBeUndefined()
  })
})

describe('who sees what', () => {
  it('sends someone without an account from a later step to the sign-in screen', () => {
    const page = mount('/onboarding/goal')
    expect(where(page)).toBe('/')
  })

  it('steps aside to Home where there is no hub to save to', async () => {
    signedIn()
    hub.loadOnboarding.mockRejectedValue(Object.assign(new Error('x'), { status: 404, code: 'http' }))
    const page = mount('/onboarding/goal')
    await flush()
    expect(where(page)).toBe('/home')
  })

  it.each([
    ['a server error', { status: 503, code: 'http' }],
    ['no answer at all', { status: 0, code: 'offline' }],
    ['an answer that is not the hub\'s JSON', { status: 200, code: 'bad-response' }],
  ])('keeps the person in the flow on %s, with a way to try again', async (_, failure) => {
    signedIn()
    hub.loadOnboarding.mockRejectedValueOnce(Object.assign(new Error('x'), failure))
    const page = mount('/onboarding/goal')
    await flush()
    expect(where(page)).toBe('/onboarding/goal')
    const notice = page.querySelector('.ob [role="status"]')
    expect(notice.textContent).toContain('Check your connection and try again. Nothing you answered is lost.')
    await act(async () => { button(page, 'Try again').click() })
    await flush()
    expect(hub.loadOnboarding).toHaveBeenCalledTimes(2)
    expect(where(page)).toBe('/onboarding/goal')
    expect(button(page, 'Try again')).toBeUndefined()
  })

  it.each([401, 403, 410])('steps aside and forgets the answers on a %i: no onboarding to be had, or not theirs', async status => {
    signedIn()
    saved({ answers: { goal: 'lose', body: full } })
    hub.loadOnboarding.mockRejectedValue(Object.assign(new Error('x'), { status, code: 'http' }))
    const page = mount('/onboarding/goal')
    await flush()
    expect(where(page)).toBe('/home')
    expect(sessionStorage.getItem('gains_onboarding')).toBeNull()
  })

  it.each([400, 408, 413, 422])('keeps the answers on a %i: only not here, not theirs or gone ends the flow', async status => {
    signedIn()
    saved({ answers: { goal: 'lose', body: full } })
    hub.loadOnboarding.mockRejectedValueOnce(Object.assign(new Error('x'), { status, code: 'http' }))
    const page = mount('/onboarding/goal')
    await flush()
    expect(where(page)).toBe('/onboarding/goal')
    expect(radio(page, 'Lose weight').getAttribute('aria-checked')).toBe('true')
    expect(JSON.parse(sessionStorage.getItem('gains_onboarding')).answers.goal).toBe('lose')
    expect(page.querySelector('.ob [role="status"]')).not.toBeNull()
  })

  describe('a rate limit (429) is busy, not gone', () => {
    const tooMany = retryAfter => Object.assign(new Error('busy'), { status: 429, code: 'busy', retryAfter })
    const waitFor = ms => act(async () => { vi.advanceTimersByTime(ms) })
    beforeEach(signedIn)

    it('keeps the unsaved answers, says the hub is busy, and asks again only once its Retry-After has passed', async () => {
      saved({ answers: { goal: 'lose', body: full }, unsaved: ['goal'] })
      hub.loadOnboarding.mockRejectedValueOnce(tooMany(7))
      const page = mount('/onboarding/goal')
      await flush()
      expect(where(page)).toBe('/onboarding/goal')
      expect(page.querySelector('.ob [role="status"]').textContent).toContain('Gains is busy right now. Try again in a moment. Nothing you answered is lost.')
      expect(radio(page, 'Lose weight').getAttribute('aria-checked')).toBe('true')
      expect(JSON.parse(sessionStorage.getItem('gains_onboarding'))).toMatchObject({ answers: { goal: 'lose' }, unsaved: ['goal'] })

      await act(async () => { button(page, 'Try again').click() })
      await waitFor(6000)
      expect(hub.loadOnboarding).toHaveBeenCalledTimes(1)
      await waitFor(1000)
      await flush()
      expect(hub.loadOnboarding).toHaveBeenCalledTimes(2)
      expect(button(page, 'Try again')).toBeUndefined()
    })

    it('waits a short while when the hub names no Retry-After', async () => {
      saved({ answers: { goal: 'lose', body: full } })
      hub.loadOnboarding.mockRejectedValueOnce(tooMany(null))
      const page = mount('/onboarding/goal')
      await flush()
      await act(async () => { button(page, 'Try again').click() })
      await waitFor(4000)
      expect(hub.loadOnboarding).toHaveBeenCalledTimes(1)
      await waitFor(1000)
      await flush()
      expect(hub.loadOnboarding).toHaveBeenCalledTimes(2)
    })

    it('marks a save the hub rate limited as unsaved, and sends it again at the end after the wait, then completes', async () => {
      saved({ answers: { goal: 'keep', body: full, trainingDays: 0 }, unsaved: ['goal'] })
      hub.saveStep.mockRejectedValueOnce(tooMany(4))
      hub.completeOnboarding.mockResolvedValue({ completedAt: 1 })
      const page = mount('/onboarding/finish')
      await flush()
      await act(async () => { button(page, 'Go to Home').click() })
      await flush()
      expect(page.querySelector('h1').textContent).toBe('Your answers could not be saved yet')
      expect(page.querySelector('.ob-sub').textContent).toBe('Gains is busy right now. Try again in a moment. Nothing you answered is lost.')
      expect(hub.completeOnboarding).not.toHaveBeenCalled()
      expect(JSON.parse(sessionStorage.getItem('gains_onboarding')).unsaved).toEqual(['goal'])

      await act(async () => { button(page, 'Try again').click() })
      await waitFor(3000)
      expect(hub.saveStep).toHaveBeenCalledTimes(1)
      await waitFor(1000)
      await flush()
      expect(hub.saveStep).toHaveBeenCalledTimes(2)
      expect(hub.completeOnboarding).toHaveBeenCalled()
      expect(where(page)).toBe('/home')
    })

    it('says busy, and keeps the answers, when completing is rate limited', async () => {
      saved({ answers: { goal: 'keep', body: full, trainingDays: 0 } })
      hub.completeOnboarding.mockRejectedValueOnce(tooMany(2)).mockResolvedValueOnce({ completedAt: 1 })
      const page = mount('/onboarding/finish')
      await flush()
      await act(async () => { button(page, 'Go to Home').click() })
      await flush()
      expect(page.querySelector('.ob-sub').textContent).toBe('Gains is busy right now. Try again in a moment. Nothing you answered is lost.')
      expect(JSON.parse(sessionStorage.getItem('gains_onboarding')).answers.goal).toBe('keep')
      await act(async () => { button(page, 'Try again').click() })
      expect(hub.completeOnboarding).toHaveBeenCalledTimes(1)
      await waitFor(2000)
      await flush()
      expect(hub.completeOnboarding).toHaveBeenCalledTimes(2)
      expect(where(page)).toBe('/home')
    })

    it('keeps the answers when the read after a refused plan is rate limited', async () => {
      const starter = { kind: 'starter', templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'gym', experience: 'new' }
      saved({ answers: { goal: 'keep', body: full, trainingDays: 3, plan: starter } })
      hub.completeOnboarding.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409, code: 'plan-unavailable' }))
      const page = mount('/onboarding/finish')
      await flush()
      hub.loadOnboarding.mockRejectedValueOnce(tooMany(3))
      await act(async () => { button(page, 'Go to Home').click() })
      await flush()
      expect(where(page)).toBe('/onboarding/finish')
      expect(page.querySelector('h1').textContent).toBe('Your answers could not be saved yet')
      expect(page.querySelector('.ob-sub').textContent).toBe('Gains is busy right now. Try again in a moment. Nothing you answered is lost.')
      expect(JSON.parse(sessionStorage.getItem('gains_onboarding'))).toMatchObject({ answers: { goal: 'keep', trainingDays: 3 } })
    })
  })

  it('resumes at the first unanswered step', async () => {
    signedIn()
    saved({ answers: { goal: 'lose', body: { ...full, heightCm: null } } })
    const page = mount('/onboarding')
    await flush()
    expect(where(page)).toBe('/onboarding/height')
  })
})

describe('what the hub says is answered or not needed (§6)', () => {
  beforeEach(signedIn)
  // The hub's state for someone whose openGym data answers some steps.
  const fromHub = ({ answered, answers = {}, training, next, remaining }) => ({
    answers, completedAt: null, step: null, coachAvailable: true, starterAvailable: true, next, remaining,
    prefill: { answered, sources: { opengym: 'ok', nutritrace: 'ok' }, ...(training === undefined ? {} : { training: { trainingDays: training } }) },
  })

  it('skips the Plan step when the profile already has routines, so no plan is chosen that openGym would skip', async () => {
    saved({ answers: { goal: 'keep', body: full } })
    hub.loadOnboarding.mockResolvedValue(fromHub({ answered: ['plan'], next: 'training', remaining: ['training'] }))
    const page = mount('/onboarding/training')
    await flush()
    click(radio(page, '3'))
    later(600)
    expect(where(page)).toBe('/onboarding/finish')
    expect(hub.saveStep.mock.calls.map(([step]) => step)).not.toContain('plan')
  })

  it('skips Training when the data holds the days, and plans on those days', async () => {
    saved({ answers: { goal: 'keep', body: { ...full, weightKg: null } } })
    hub.loadOnboarding.mockResolvedValue(fromHub({ answered: ['training'], training: 3, next: 'body', remaining: ['body', 'plan'] }))
    const page = mount('/onboarding/weight')
    await flush()
    press(page.querySelector('[role="slider"]'), 'ArrowLeft')
    click(button(page, 'Next'))
    expect(where(page)).toBe('/onboarding/plan')
    expect(page.textContent).toContain('A starter plan for 3 days a week')
  })

  it('never goes round Plan and Training when the data says 0 days: the end, whatever step the hub names', async () => {
    // An older hub still names the Plan step beside 0 days from the data.
    hub.loadOnboarding.mockResolvedValue(fromHub({ answers: { goal: { goal: 'keep' }, body: null }, answered: ['goal', 'training'], training: 0, next: 'plan', remaining: ['plan'] }))
    const page = mount('/onboarding')
    await flush()
    expect(where(page)).toBe('/onboarding/finish')
    later(2000)
    expect(where(page)).toBe('/onboarding/finish')
  })

  it('says how many steps are left from the hub\'s remaining, as the progress bar counts them, politely', async () => {
    saved({ answers: { goal: 'keep' } })
    hub.loadOnboarding.mockResolvedValue(fromHub({ answered: [], answers: { goal: { goal: 'keep' } }, next: 'body', remaining: ['body', 'training', 'plan'] }))
    const page = mount('/onboarding/sex')
    await flush()
    const left = page.querySelector('.ob-nav [aria-live="polite"]')
    expect(left.textContent).toBe('2 steps left')
    expect(page.querySelector('[role="progressbar"]').getAttribute('aria-valuetext')).toBe('Step 2 of 3: You, 1 of 4')
    click(button(page, 'Skip'))
    expect(where(page)).toBe('/onboarding/training')
    expect(page.querySelector('.ob-nav [aria-live="polite"]').textContent).toBe('1 step left')
  })

  it('resumes where the hub says, straight to the end when the data answers everything', async () => {
    hub.loadOnboarding.mockResolvedValue(fromHub({ answered: ['goal', 'body', 'training', 'plan'], training: 4, next: 'summary', remaining: [] }))
    const page = mount('/onboarding')
    await flush()
    expect(where(page)).toBe('/onboarding/finish')
  })

  it('keeps an AI coach plan when the days change, takes it back from the hub after a reload, and never writes it to the tab', async () => {
    const coach = { kind: 'coach', experience: null, equipment: 'gym', consentVersion: 'ai-coach-build-v1', consentAt: '2026-10-14T08:00:00.000Z' }
    saved({ answers: { goal: 'keep', body: full, trainingDays: 3, plan: coach }, pick: 'coach' })
    let page = mount('/onboarding/training')
    await flush()
    click(radio(page, '4'))
    later(600)
    unmountAll()
    // The reload: the tab's answers, and the hub's, which kept the coach plan beside 4 days.
    const answers = { goal: { goal: 'keep' }, body: full, training: { trainingDays: 4 }, plan: coach }
    hub.loadOnboarding.mockResolvedValue(fromHub({ answered: [], answers, next: 'summary', remaining: [] }))
    page = mount('/onboarding')
    await flush()
    expect(where(page)).toBe('/onboarding/finish')
    // The consent in it is the hub's to hold (it stamped it); this tab keeps none.
    expect(JSON.parse(sessionStorage.getItem('gains_onboarding')).answers.plan).toBeNull()
  })
})

describe('reduced motion', () => {
  it('runs no thread and keeps the passkey result up for 2s', async () => {
    document.documentElement.dataset.motion = 'reduce'
    signedIn()
    const page = mount('/onboarding/passkey')
    await flush()
    expect(page.querySelector('.ob-thread').style.visibility).not.toBe('visible')
    later(1500)
    expect(where(page)).toBe('/onboarding/passkey')
    later(500)
    expect(where(page)).toBe('/onboarding/goal')
    expect(page.querySelector('.ob-thread').style.visibility).not.toBe('visible')
  })
})
