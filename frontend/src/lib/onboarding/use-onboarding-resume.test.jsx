// @vitest-environment happy-dom
// The boot's "pick up where you left off" (use-onboarding-resume.js): an answer about one person is
// not acted on once another is signed in.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOnboardingResume } from './use-onboarding-resume.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ user: null, read: null }))
vi.mock('../../store/useStore.js', () => ({
  useStore: { getState: () => ({ user: mocks.user, S: {} }) },
  hasData: () => false,
}))
vi.mock('../nutrition/api.js', () => ({ nutritionAvailable: () => true }))
vi.mock('./api.js', () => ({ loadOnboarding: () => mocks.read.promise }))

const MARIA = { id: 'u1', name: 'Maria' }
const BEA = { id: 'u2', name: 'Bea' }
const started = { completedAt: null, step: 'goal', answers: { goal: { goal: 'lose' } } }
const navigate = vi.fn()

function Probe({ user }) {
  useOnboardingResume({ user, ready: true, pathname: '/home', navigate })
  return null
}

const deferred = () => {
  const d = {}
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject })
  return d
}
let root
beforeEach(() => {
  navigate.mockReset()
  mocks.user = MARIA
  mocks.read = deferred()
  root = createRoot(document.createElement('div'))
  act(() => root.render(<Probe user={MARIA} />))
})
afterEach(() => { act(() => root.unmount()) })

describe('boot resume', () => {
  it('sends a person who had started back into the flow', async () => {
    mocks.read.resolve(started)
    await act(async () => { await mocks.read.promise })
    expect(navigate).toHaveBeenCalledWith('/onboarding', { replace: true })
  })

  it('ignores the answer when another person signed in while it was on its way', async () => {
    mocks.user = BEA
    mocks.read.resolve(started)
    await act(async () => { await mocks.read.promise })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('ignores the answer when the person signed out while it was on its way', async () => {
    mocks.user = null
    mocks.read.resolve(started)
    await act(async () => { await mocks.read.promise })
    expect(navigate).not.toHaveBeenCalled()
  })
})
