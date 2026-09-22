// @vitest-environment happy-dom
// The intake questionnaire: the eight-screen state machine the Coach opens with, and the same
// eight screens again as the profile editor behind `?edit=1`.
//
// What is worth pinning here is not that the screens render — it is the order they run in, the
// two answers that gate Continue, what reaches the store when the last button is pressed, and
// the two paths that are awkward to reach by hand: a plan request that fails after the answers
// are already saved, and the editor's rule about not opening a second conversation.
//
// coach.js is deliberately NOT mocked: `hasConsent`, `emptyCoach`, `appendChat` and
// `coachAvailable` are the contract this screen is written against, so the tests run the real
// ones. MOBILE and DEMO are both false in a test build, which is the web gate.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachIntake from './CoachIntake.jsx'
import { requestPlan, disclosure } from '../lib/coach-api.js'
import { CONSENT_VERSION } from '../lib/coach.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, user: null, config: null, search: '', nav: vi.fn(), toast: vi.fn() }
  state.snapshot = () => ({
    S: state.S,
    user: state.user,
    config: state.config,
    coachLocal: null,
    update: mut => mut(state.S),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({
  useNavigate: () => mocks.nav,
  useSearchParams: () => [new URLSearchParams(mocks.search), vi.fn()],
}))
vi.mock('../lib/coach-api.js', () => ({
  requestPlan: vi.fn(() => Promise.resolve({})),
  disclosure: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../coach.css', () => ({}))

let host, root
const fresh = () => ({
  unit: 'kg', lang: 'en', customEx: [], workouts: [], bodyweight: [], exWeights: {},
  dayPlan: {}, routines: [], week: {},
})

beforeEach(() => {
  mocks.S = fresh()
  mocks.user = { uid: 'u1', name: 'Ana' }
  mocks.config = { coach: { enabled: true } }
  mocks.search = ''
  mocks.nav.mockReset(); mocks.toast.mockReset()
  vi.mocked(requestPlan).mockReset().mockResolvedValue({})
  vi.mocked(disclosure).mockReset().mockResolvedValue(null)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<CoachIntake />))
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }

const eyebrow = () => host.querySelector('.ob-eyebrow')?.textContent
const all = sel => [...host.querySelectorAll(sel)]
const find = (sel, text) => all(sel).find(el => el.textContent.trim().startsWith(text))
const tap = (sel, text) => {
  const el = find(sel, text)
  expect(el, `no ${sel} starting with "${text}"`).toBeTruthy()
  act(() => el.click())
}
const footBtn = () => host.querySelector('.ob-foot .btn')
const cont = () => act(() => footBtn().click())
// A <select> is driven the same way an <input> is: React tracks the value through the
// prototype setter, so a bare el.value never reaches onChange.
const pick = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, String(value))
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
const typeIn = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})

// Walk the flow to a named screen, answering only what Continue is actually waiting for — so
// a test that already made its own choice keeps it.
const walkTo = target => {
  for (let i = 0; i < 12 && eyebrow() !== target; i++) {
    if (eyebrow() === 'Before we start') { tap('button', 'I understand'); continue }
    if (footBtn().disabled) {
      if (eyebrow() === 'Your goal') tap('.ob-choice', 'Build muscle')
      else if (eyebrow() === 'Experience') tap('.ob-choice', 'Training regularly')
    }
    cont()
  }
  expect(eyebrow()).toBe(target)
}

describe('CoachIntake — who gets in', () => {
  it('sends you home and renders nothing when the Coach is not available', () => {
    mocks.config = { coach: { enabled: false } }
    mount()
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
    expect(host.textContent).toBe('')
  })

  it('needs a signed-in user as well as a server with the Coach on', () => {
    mocks.user = null
    mount()
    expect(mocks.nav).toHaveBeenCalledWith('/home', { replace: true })
  })
})

describe('CoachIntake — the consent screen', () => {
  it('is the first screen on a fresh profile, and is not one of the progress dots', () => {
    mount()
    expect(eyebrow()).toBe('Before we start')
    expect(all('.ob-dot')).toHaveLength(0)
    expect(host.querySelector('.ob-foot .btn').textContent).toContain('I understand')
  })

  it('agreeing records the version the app checks for, and opens the first question', () => {
    mount()
    tap('button', 'I understand')
    expect(mocks.S.coach.consent.version).toBe(CONSENT_VERSION)
    expect(Date.parse(mocks.S.coach.consent.agreedAt)).not.toBeNaN()
    expect(mocks.S.coach.profile).toBe(null)          // nothing else written yet
    expect(eyebrow()).toBe('Your goal')
    expect(all('.ob-dot')).toHaveLength(7)
  })

  it('"Not now" writes nothing at all and goes back to the plan', () => {
    mount()
    tap('button', 'Not now')
    expect(mocks.S.coach).toBeUndefined()
    expect(mocks.nav).toHaveBeenCalledWith('/plan')
  })

  it('lists the built-in categories first, then whatever the server says actually goes', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan', 'prefs'], providerLabel: 'Anthropic', payer: 'you', host: 'api.anthropic.com' })
    mount()
    expect(all('.ob-consent-row')).toHaveLength(5)                       // CATEGORY_TEXT, before the call lands
    await settle()
    expect(all('.ob-consent-row')).toHaveLength(2)
    expect(host.textContent).toContain('Sent straight to api.anthropic.com with your own API key')
  })

  it('names the instance owner as the payer when the server is the one calling', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan'], providerLabel: 'Anthropic', payer: 'instance' })
    mount(); await settle()
    expect(host.textContent).toContain('Sent to Anthropic, running on this server under the instance owner')
  })

  it('names the provider when the phone pays but there is no host to name', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan'], providerLabel: 'Anthropic API', payer: 'you' })
    mount(); await settle()
    expect(host.textContent).toContain('Sent straight to Anthropic API with your own API key')
  })

  it('falls back to the server’s own label, then to a generic one, when the call fails', async () => {
    vi.mocked(disclosure).mockRejectedValue(new Error('offline'))
    mocks.config = { coach: { enabled: true, providerLabel: 'Claude Agent SDK' } }
    mount(); await settle()
    expect(host.textContent).toContain('Sent to Claude Agent SDK, running on this server')
    expect(all('.ob-consent-row')).toHaveLength(5)      // and the built-in list stands in

    act(() => root.unmount())
    mocks.config = { coach: { enabled: true } }
    root = createRoot(host)
    mount(); await settle()
    expect(host.textContent).toContain('Sent to the configured AI provider, running on this server')
  })

  it('shows a category the app has no copy for under its own key', async () => {
    vi.mocked(disclosure).mockResolvedValue({ categories: ['plan', 'sleep'], providerLabel: 'x', payer: 'instance' })
    mount(); await settle()
    expect(all('.ob-consent-row').map(r => r.querySelector('b').textContent)).toEqual(['Your plan', 'sleep'])
  })

  it('is skipped entirely once consent is on file', () => {
    mocks.S.coach = { consent: { agreedAt: '2026-09-01T00:00:00Z', version: CONSENT_VERSION }, profile: null, chat: [] }
    mount()
    expect(eyebrow()).toBe('Your goal')
  })
})

describe('CoachIntake — the two answers that gate the flow', () => {
  it('will not leave the goal screen until one is picked', () => {
    mount(); tap('button', 'I understand')
    expect(footBtn().disabled).toBe(true)
    expect(host.querySelector('.ob-hint').textContent).toBe('Pick one to continue.')
    cont()
    expect(eyebrow()).toBe('Your goal')

    tap('.ob-choice', 'Lose fat')
    expect(footBtn().disabled).toBe(false)
    expect(host.querySelector('.ob-hint')).toBe(null)
    cont()
    expect(eyebrow()).toBe('Experience')
  })

  it('will not leave the experience screen until one is picked', () => {
    mount(); walkTo('Experience')
    expect(footBtn().disabled).toBe(true)
    cont()
    expect(eyebrow()).toBe('Experience')
    tap('.ob-choice', 'New to lifting')
    cont()
    expect(eyebrow()).toBe('Schedule')
  })

  it('refuses a session shorter than ten minutes', () => {
    mount(); walkTo('Session length')
    const [hours, minutes] = all('.ob-wheel')
    expect(footBtn().disabled).toBe(false)

    // 00:00 is not a session, so the screen snaps it to five minutes — and five is still refused.
    pick(hours, 0)
    expect(footBtn().disabled).toBe(true)
    expect(minutes.value).toBe('5')

    pick(minutes, 0)                      // both wheels at nought snaps back to five, not zero
    expect(minutes.value).toBe('5')
    expect(footBtn().disabled).toBe(true)

    pick(minutes, 15)
    expect(footBtn().disabled).toBe(false)
    cont()
    expect(eyebrow()).toBe('Equipment')
  })
})

describe('CoachIntake — moving around', () => {
  it('Back walks the steps and then leaves for the plan', () => {
    mount(); walkTo('Schedule')
    act(() => host.querySelector('.iconbtn').click())
    expect(eyebrow()).toBe('Experience')
    act(() => host.querySelector('.iconbtn').click())
    expect(eyebrow()).toBe('Your goal')
    act(() => host.querySelector('.iconbtn').click())
    expect(eyebrow()).toBe('Before we start')
    act(() => host.querySelector('.iconbtn').click())
    expect(mocks.nav).toHaveBeenCalledWith('/plan')
  })

  it('Back from the first screen of the editor goes to the conversation, not the plan', () => {
    mocks.search = 'edit=1'
    mount()
    expect(eyebrow()).toBe('Your goal')
    act(() => host.querySelector('.iconbtn').click())
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  it('Skip is offered only on the three optional screens, and never on the last one', () => {
    mount(); walkTo('Your goal')
    expect(host.querySelector('.ob-skip')).toBe(null)
    walkTo('Equipment')
    expect(host.querySelector('.ob-skip')).toBeTruthy()
    act(() => host.querySelector('.ob-skip').click())
    expect(eyebrow()).toBe('Limits')
    expect(host.querySelector('.ob-skip')).toBeTruthy()
    act(() => host.querySelector('.ob-skip').click())
    expect(eyebrow()).toBe('Almost there')
    expect(host.querySelector('.ob-skip')).toBe(null)
    expect(footBtn().textContent).toContain('Build my plan')
  })

  it('the dots count the seven questions and follow the one on screen', () => {
    mount(); walkTo('Your goal')
    const at = () => all('.ob-dot').findIndex(d => d.classList.contains('on'))
    expect(all('.ob-dot')).toHaveLength(7)
    expect(at()).toBe(0)
    walkTo('Schedule')
    expect(at()).toBe(2)
    expect(all('.ob-dot').filter(d => d.classList.contains('done'))).toHaveLength(2)
  })
})

describe('CoachIntake — the answers themselves', () => {
  it('preferred days toggle off and back on, and stay in weekday order', () => {
    mount(); walkTo('Schedule')
    const wd = () => all('.ob-wd').filter(b => b.classList.contains('on')).map(b => b.textContent)
    expect(wd()).toEqual(['Mo', 'We', 'Fr'])
    tap('.ob-wd', 'We')
    expect(wd()).toEqual(['Mo', 'Fr'])
    tap('.ob-wd', 'Su')                                   // Sunday is 0 and is rendered last
    expect(wd()).toEqual(['Mo', 'Fr', 'Su'])
    tap('.ob-day', '5')
    walkTo('Almost there')
    cont()
    expect(mocks.S.coach.profile).toMatchObject({ daysPerWeek: 5, preferredDays: [0, 1, 5] })
  })

  it('equipment chips toggle and reach the profile', () => {
    mount(); walkTo('Equipment')
    const chips = all('.ob-chips .chip')
    expect(chips.length).toBeGreaterThan(2)
    act(() => chips[0].click()); act(() => chips[2].click()); act(() => chips[0].click())
    walkTo('Almost there'); cont()
    expect(mocks.S.coach.profile.equipment).toEqual([chips[2].textContent])
  })

  it('the quick length chips and the two wheels write the same field', () => {
    mount(); walkTo('Session length')
    tap('.ob-quick .chip', '90')
    const [hours, minutes] = all('.ob-wheel')
    expect(hours.value).toBe('1')
    expect(minutes.value).toBe('30')
    pick(hours, 2)
    expect(host.querySelector('.ob-quick .chip.on')).toBe(null)
    walkTo('Almost there'); cont()
    expect(mocks.S.coach.profile.sessionMin).toBe(150)
  })

  it('the free-text screens land in the profile as typed', () => {
    mount(); walkTo('Limits')
    typeIn(host.querySelector('.ob-field textarea'), 'dodgy left shoulder')
    cont()
    const [likes, dislikes, notes] = all('.ob-field textarea')
    typeIn(likes, 'deadlifts'); typeIn(dislikes, 'lunges'); typeIn(notes, 'arms by spring')
    cont()
    expect(mocks.S.coach.profile).toMatchObject({
      limitations: 'dodgy left shoulder', likes: 'deadlifts', dislikes: 'lunges', notes: 'arms by spring'
    })
  })
})

describe('CoachIntake — building the plan', () => {
  it('saves the answers, opens the thread with one intake line, and asks for a plan', async () => {
    mount(); walkTo('Almost there')
    let resolve
    vi.mocked(requestPlan).mockReturnValue(new Promise(r => { resolve = r }))
    cont()

    expect(requestPlan).toHaveBeenCalledTimes(1)
    const sent = vi.mocked(requestPlan).mock.calls[0][0]
    expect(sent).toMatchObject({ goal: 'muscle', experience: 'regular', daysPerWeek: 3, sessionMin: 60 })
    expect(mocks.S.coach.profile).toEqual(sent)
    expect(mocks.S.coach.chat).toHaveLength(1)
    expect(mocks.S.coach.chat[0]).toMatchObject({ role: 'user', kind: 'intake' })
    expect(footBtn().disabled).toBe(true)                 // no second request while one is in flight
    expect(mocks.nav).not.toHaveBeenCalled()

    await act(async () => { resolve({}); await Promise.resolve() })
    expect(mocks.nav).toHaveBeenCalledWith('/coach', { replace: true })
  })

  it('a failed request keeps the answers, says why, and lets you press it again without a second intake line', async () => {
    vi.mocked(requestPlan).mockRejectedValueOnce(new Error('The Coach is already thinking about your training.'))
    mount(); walkTo('Almost there')
    cont(); await settle()

    expect(mocks.toast).toHaveBeenCalledWith('The Coach is already thinking about your training.')
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(mocks.S.coach.profile.goal).toBe('muscle')     // the answers are already saved
    expect(footBtn().disabled).toBe(false)

    cont(); await settle()
    expect(requestPlan).toHaveBeenCalledTimes(2)
    // One intake line however many times the button is pressed. The rule in finish() used to
    // be guarded by `editing`, so a first-time retry opened the thread with the questionnaire twice.
    expect(mocks.S.coach.chat).toHaveLength(1)
    expect(mocks.S.coach.chat[0]).toMatchObject({ role: 'user', kind: 'intake' })
  })

  it('falls back to a generic message when the failure carries none', async () => {
    vi.mocked(requestPlan).mockRejectedValueOnce(new Error())
    mount(); walkTo('Almost there')
    cont(); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Could not ask the Coach')
  })

  // The screen itself only offers 1–7, but a profile carried in from an import, an older
  // build or another device can hold anything, and the editor saves it straight back.
  const savingDayCount = n => {
    mocks.search = 'edit=1'
    mocks.S.coach = { consent: null, chat: [{ id: 'c1', role: 'user', kind: 'intake' }],
      profile: { goal: 'strength', experience: 'new', daysPerWeek: n, preferredDays: [1], sessionMin: 60, equipment: [] } }
    mount(); walkTo('Almost there'); cont()
    return mocks.S.coach.profile.daysPerWeek
  }
  it('clamps a prefilled day count down to the seven a week can hold', () => expect(savingDayCount(99)).toBe(7))
  it('clamps a negative day count up to one', () => expect(savingDayCount(-2)).toBe(1))
  // Nought is an answer, not a missing one: it goes through the clamp like -2 does. It used to
  // fall through `|| 3` and save as three while -1 saved as one.
  it('clamps a zero day count up to one, like any other count below the floor', () => expect(savingDayCount(0)).toBe(1))
  it('reads a missing day count as "not answered" and saves the default three', () => expect(savingDayCount(null)).toBe(3))
})

describe('CoachIntake — the editor behind ?edit=1', () => {
  const editing = (profile, chat = [{ id: 'c1', role: 'user', kind: 'intake', at: 1 }]) => {
    mocks.search = 'edit=1'
    mocks.S.coach = { consent: { agreedAt: '2026-09-01T00:00:00Z', version: CONSENT_VERSION }, profile, chat }
  }
  const PROFILE = {
    goal: 'strength', experience: 'returning', daysPerWeek: 4, preferredDays: [2, 4],
    sessionMin: 45, equipment: ['barbell'], limitations: 'bad knee', likes: 'x', dislikes: 'y', notes: 'z'
  }

  it('skips consent, prefills every answer, and ends on Save', () => {
    editing(PROFILE)
    mount()
    expect(eyebrow()).toBe('Your goal')
    expect(host.querySelector('.ob-choice.on').textContent).toContain('Get stronger')
    walkTo('Experience')
    expect(host.querySelector('.ob-choice.on').textContent).toContain('Coming back after a break')
    walkTo('Schedule')
    expect(all('.ob-day').find(b => b.classList.contains('on')).textContent).toBe('4')
    expect(all('.ob-wd').filter(b => b.classList.contains('on')).map(b => b.textContent)).toEqual(['Tu', 'Th'])
    walkTo('Limits')
    expect(host.querySelector('.ob-field textarea').value).toBe('bad knee')
    walkTo('Almost there')
    expect(footBtn().textContent).toContain('Save')
  })

  it('skips consent even when none was ever given — the editor is not a second opt-in', () => {
    editing(PROFILE, [])
    mocks.S.coach.consent = null
    mount()
    expect(eyebrow()).toBe('Your goal')
  })

  it('saves without asking for a plan, and never opens a second conversation', () => {
    editing(PROFILE)
    mount(); walkTo('Your goal')
    tap('.ob-choice', 'Endurance')
    walkTo('Almost there'); cont()

    expect(requestPlan).not.toHaveBeenCalled()
    expect(mocks.toast).toHaveBeenCalledWith('Saved')
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
    expect(mocks.nav).not.toHaveBeenCalledWith('/coach', { replace: true })
    expect(mocks.S.coach.profile.goal).toBe('endurance')
    expect(mocks.S.coach.chat).toHaveLength(1)
  })

  it('still opens the thread when an edit is the first thing that ever happened', () => {
    editing(PROFILE, [{ id: 'c9', role: 'coach', kind: 'text', text: 'hi', at: 1 }])
    mount(); walkTo('Almost there'); cont()
    expect(mocks.S.coach.chat.map(m => m.kind)).toEqual(['text', 'intake'])
  })
})
