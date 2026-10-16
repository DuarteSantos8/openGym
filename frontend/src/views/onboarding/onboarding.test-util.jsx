// What the onboarding's tests share: the flow mounted at a path in a memory router, the address
// on screen, and a way to start from saved answers. Not shipped (only *.test.jsx import it).
import { act, cloneElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigationType } from 'react-router-dom'
import { isFlowPath } from '../../lib/onboarding/flow.js'
import Onboarding from './Onboarding.jsx'

// As the shell does (App.jsx): the flow only on its own paths; Home and the sign-in screen are
// somewhere else, and only the address says the flow went there.
function Where({ children }) {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  return <>
    {isFlowPath(pathname) && children}
    <output data-testid="where" data-nav={navType}>{pathname}</output>
  </>
}

const mounted = []
export function mount(path, el = <Onboarding />) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const tree = () => <MemoryRouter initialEntries={[path]}><Where>{cloneElement(el)}</Where></MemoryRouter>
  mounted.push({ root, host, tree })
  act(() => root.render(tree()))
  return host
}
/** Renders what is mounted again, where the store's mocked user has changed under it (no reload). */
export const rerender = () => act(() => { mounted.forEach(({ root, tree }) => root.render(tree())) })
export function unmountAll() {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
}

export const where = host => host.querySelector('[data-testid="where"]').textContent
/** How the address on screen was reached: PUSH, REPLACE or POP. */
export const arrivedBy = host => host.querySelector('[data-testid="where"]').dataset.nav
export const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
export const radio = (host, text) => [...host.querySelectorAll('[role="radio"]')].find(b => b.textContent.includes(text))
export const flush = () => act(async () => { await Promise.resolve() })

/**
 * Saved answers for this tab, as a reload finds them (lib/onboarding/state.js): the signed-in u1's
 * unless `uid` says otherwise (null: before there is an account, which keeps only code, invite, name).
 */
export function saved(patch) {
  const answers = {
    goal: null, body: { sex: null, birthYear: null, heightCm: null, weightKg: null },
    activity: { value: 'sitting', source: 'default' }, units: { weight: 'kg', height: 'cm', source: 'locale' }, plan: null,
    ...patch.answers,
  }
  sessionStorage.setItem('gains_onboarding', JSON.stringify({ uid: 'u1', ...patch, answers }))
}
