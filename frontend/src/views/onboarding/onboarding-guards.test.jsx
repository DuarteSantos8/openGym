// @vitest-environment happy-dom
// The onboarding's layout guards (motion-onboarding-thread.md §4, and the shell's rule that no page
// chooses its own header, width or spacing): every onboarding route registers exactly one thread
// anchor; the thread's layer mounts in the onboarding layout and nowhere else; the screens fill the
// layout's frame and build none of their own.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ThreadLayer from '../../components/onboarding/ThreadLayer.jsx'
import ThreadFloor from '../../components/onboarding/ThreadFloor.jsx'
import { SCREENS, pathOf } from '../../lib/onboarding/flow.js'
import { flush, mount, saved, unmountAll, where } from './onboarding.test-util.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ user: null }))
vi.mock('../../store/useStore.js', () => {
  const snap = () => ({ user: mocks.user, config: {}, S: {}, setUser: vi.fn(), pushState: vi.fn(), pullState: vi.fn(), adoptProfile: vi.fn() })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore, hasData: () => false }
})
vi.mock('../../store/useUI.js', () => {
  const snap = () => ({ sheets: [], toast: () => {}, openSheet: () => ({ close: () => {} }) })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('../../lib/onboarding/api.js', async original => ({
  ...(await original()),
  checkInvite: vi.fn(async () => ({ status: 'valid', inviterName: 'Andrei', suggestedName: null })),
  loadOnboarding: vi.fn(async () => ({ answers: {}, completedAt: null, coachAvailable: true })),
  saveStep: vi.fn(async () => ({})),
  previewTargets: vi.fn(async () => ({ ready: false })),
  completeOnboarding: vi.fn(),
  passkeySynced: vi.fn(async () => null),
}))
vi.mock('../../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

const SRC = resolve(process.cwd(), 'src')
const files = dir => readdirSync(dir).flatMap(n => {
  const p = join(dir, n)
  return statSync(p).isDirectory() ? (n === 'locales' ? [] : files(p)) : /\.jsx?$/.test(n) && !/\.test(-util)?\./.test(n) ? [p] : []
})
const code = p => readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
const rel = p => relative(SRC, p).split('\\').join('/')

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear()
  mocks.user = null
})
afterEach(() => { unmountAll(); vi.useRealTimers() })

describe('every onboarding route registers exactly one thread anchor', () => {
  const full = { sex: 'female', birthYear: 1990, heightCm: 168, weightKg: 64 }
  it.each(SCREENS)('%s', async screen => {
    const preAuth = screen === 'invite' || screen === 'name'
    if (!preAuth) mocks.user = { id: 'u1', name: 'Maria' }
    // Before an account there is only the invite kept for this tab (the name step needs it).
    saved({ uid: preAuth ? null : 'u1', code: 'AB12', answers: { goal: 'keep', body: full, trainingDays: 3 } })
    const page = mount(pathOf(screen, 'AB12'))
    await flush()
    expect(where(page)).toBe(pathOf(screen, 'AB12'))
    expect(page.querySelectorAll('[data-thread]')).toHaveLength(1)
    expect(page.querySelector('.ob-thread').getAttribute('data-anchors')).toBe('1')
  })
})

describe('the thread layer lives in the onboarding layout only', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {})
  const render = el => {
    const root = createRoot(document.createElement('div'))
    try { act(() => root.render(el)) } finally { act(() => root.unmount()) }
  }

  it('throws outside it, the layer and an anchor alike', () => {
    const spy = quiet()
    expect(() => render(<ThreadLayer />)).toThrow(/only in the onboarding layout/)
    expect(() => render(<svg><ThreadFloor y={128} /></svg>)).toThrow(/inside the onboarding layout/)
    spy.mockRestore()
  })

  it('is mounted, with its provider, by OnboardingLayout and no other file', () => {
    const users = files(SRC).filter(p => /<Thread(Layer|Provider)\b/.test(code(p))).map(rel)
    expect(users).toEqual(['components/onboarding/OnboardingLayout.jsx'])
  })
})

describe('a screen fills the layout\'s frame and builds none of its own', () => {
  const screens = files(join(SRC, 'views', 'onboarding')).filter(p => !p.endsWith('Onboarding.jsx'))
  const FRAME = ['ob-nav', 'ob-screen', 'ob-body', 'ob-hd', 'ob-foot', 'ob-stage', 'ob-controls', 'ob-thread']

  it('has a screen file for every step', () => {
    expect(screens.length).toBe(SCREENS.length)
  })

  it.each(screens.map(rel))('%s: no heading, header, frame class, layout or width of its own', file => {
    const text = code(join(SRC, file))
    expect(text).not.toMatch(/<(h1|header|nav)\b/)
    expect(text).toMatch(/<StepScreen\b/)
    for (const cls of FRAME) expect(text, cls).not.toMatch(new RegExp(`['"\\s]${cls}['"\\s]`))
    // style is for computed custom properties only (a pill's day), never a box of its own
    for (const m of text.matchAll(/style=\{\{([^}]*)\}\}/g)) expect(m[1].trim(), file).toMatch(/^'--/)
  })
})
