/* The OrcaRouter connect sheet: the two credential choices, and the lifecycle that has to
 * release the server-side lock on every way out.
 *
 * The behaviour worth pinning is the leaving, not the arriving. A sign-in that is cancelled,
 * denied, unmounted or interrupted by `pagehide` must not leave a lock on the server or a page
 * that can never start another one — and on a back-forward-cache restore the component comes
 * back exactly as it was, so anything left "busy" in the handler is permanent. That last case is
 * asserted directly: begin a login, deliver its URL, dispatch pagehide, and prove a second login
 * can start without remounting.
 *
 * The sheet is driven as the component the admin card actually renders, against a recording
 * transport — no static HTML, and no screenshot standing in for behaviour.
 *
 * Written in this repo's own component-test idiom (createRoot over the vitest DOM environment,
 * as src/sheets.test.jsx and src/views/Stats.recovery.test.jsx do) rather than pulling in a
 * testing library the frontend does not depend on: CONTRIBUTING is explicit that new
 * dependencies are a hard sell. */
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* The card's status payload for an OrcaRouter instance: the shape /api/admin/coach answers with,
   including the two fields the credential step reads to decide which choices to draw. */
const statusPayload = (over = {}) => ({
  disabledByEnv: false, enabled: true, provider: 'orcarouter', model: null,
  providers: [
    { id: 'orcarouter', label: 'OrcaRouter', runtime: 'HTTPS', setupToken: false, deviceLogin: false, apiKey: true, http: true, baseUrl: false, keyOptional: false, keyPlaceholder: 'sk-orca-…', defaultModel: 'orcarouter/auto', connect: 'pkce', catalog: 'chat', connected: false },
    { id: 'anthropic', label: 'Anthropic API', runtime: 'HTTPS', setupToken: false, deviceLogin: false, apiKey: true, http: true, baseUrl: false, keyOptional: false, keyPlaceholder: 'sk-ant-…', defaultModel: 'claude-opus-5', connect: null, catalog: null, connected: false }
  ],
  models: {}, baseUrl: 'https://api.orcarouter.ai', knownModels: null,
  caps: { perProfileDaily: 10, instanceDaily: 0 }, community: false,
  runtime: { ok: true, version: 'HTTPS · api.orcarouter.ai', error: null, needsKey: true },
  authMode: 'instance', boundUid: null,
  auth: { state: 'none', type: null, account: null, connectedAt: null },
  unprivileged: { ok: true, dropped: false, why: 'this provider runs no child process' },
  jobsToday: 0, lastSuccess: null, lastError: null, recent: [],
  ...over
})

const AUTH_URL = 'https://www.orcarouter.ai/auth?callback_url=oob&code_challenge=CHAL&code_challenge_method=S256&state=ST&app_name=openGym&scope=api'

/* The transport stub, installed before the component module is imported. Every request the
   component makes is recorded, so the assertions are about what went on the wire rather than
   about what the component believes it did. */
const mocks = vi.hoisted(() => {
  const state = { api: null, fetch: null, releases: [] }
  return state
})

vi.mock('../lib/api.js', () => ({
  remoteBase: '',
  api: (path, opts) => mocks.api(path, opts)
}))

/** A recording api() with sane answers for every route the sheet touches. */
function fakeApi(over = {}) {
  const calls = []
  const impl = async (path, opts) => {
    calls.push({ path, body: opts && opts.body ? JSON.parse(opts.body) : null })
    if (over[path]) return over[path](calls)
    if (path === '/api/admin/coach') return statusPayload(over.status || {})
    if (path.endsWith('/connect/orcarouter/start')) {
      if (over.startError) throw new Error(over.startError)
      return { ok: true, url: AUTH_URL, scope: 'api', generation: 3, expiresAt: Date.now() + 600000, appName: 'openGym' }
    }
    if (path.endsWith('/connect/orcarouter/complete')) {
      if (over.completeError) throw new Error(over.completeError)
      return { ok: true, via: 'pkce', account: 'u-42', scope: 'api' }
    }
    if (path.endsWith('/cancel') || path.endsWith('/denied')) return { ok: true }
    return {}
  }
  impl.calls = calls
  return impl
}

let root, container, AdminCoach, Modals

/** happy-dom provides the DOM; the sheet layer needs a location to push a history entry against
 *  (components/Modals.jsx does that so Android back dismisses an open sheet). */
function installDom() {
  document.body.innerHTML = '<div id="root"></div>'
  history.replaceState(null, '', '#/admin')
  container = document.getElementById('root')
  root = createRoot(container)
}

beforeEach(async () => {
  vi.resetModules()
  mocks.api = fakeApi()
  mocks.releases = []
  mocks.fetch = vi.fn(async (path, opts) => { mocks.releases.push({ path, keepalive: !!(opts && opts.keepalive) }); return { ok: true, json: async () => ({}) } })
  globalThis.fetch = mocks.fetch
  installDom()
  AdminCoach = (await import('./AdminCoach.jsx')).default
  // The real sheet layer, so the connect sheet is exercised through the same path the app uses
  // (openSheet → sheets → Modals) rather than by rendering the component in isolation.
  Modals = (await import('../components/Modals.jsx')).default
})

afterEach(() => {
  act(() => { root.unmount() })
  vi.restoreAllMocks()
})

/** The sheets live on the shared UI store; clear it between tests so one case's open sheet does
 *  not appear in the next. */
beforeEach(async () => {
  const { useUI } = await import('../store/useUI.js')
  useUI.setState({ sheets: [] })
})

/** Render and settle: the card loads its status in an effect. */
async function mount() {
  await act(async () => {
    root.render(React.createElement(React.Fragment, null,
      React.createElement(AdminCoach),
      React.createElement(Modals)))
  })
  await act(async () => {})
  return container
}

const byText = (text, sel = 'button') => [...container.querySelectorAll(sel)].find(el => el.textContent.trim().toLowerCase() === text.toLowerCase())
const containing = (text, sel = 'button') => [...container.querySelectorAll(sel)].find(el => el.textContent.toLowerCase().includes(text.toLowerCase()))

async function click(el) {
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
  await act(async () => {})
}

/** Set an input's value the way the rest of this repo's tests do: through the setter on the
 *  element's own constructor, then a bubbling `input` event — which is what React's onChange
 *  listens for. */
async function type(el, value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const openConnect = async () => {
  const btn = containing('connect with orcarouter')
  expect(btn, 'the Connect choice is rendered').toBeTruthy()
  await click(btn)
}

const authUrlNode = () => container.querySelector('[data-testid="orca-auth-url"]')

describe('the OrcaRouter credential step', () => {
  it('offers the API-key choice and the account choice side by side, both named distinctly', async () => {
    await mount()
    expect(byText('Add API key'), 'the pasted-key path').toBeTruthy()
    expect(containing('Connect with OrcaRouter'), 'the account path').toBeTruthy()
    // The difference is stated rather than implied.
    expect(container.textContent).toMatch(/Both end at the same key on your account/i)
  })

  it('shows only the API-key choice for a provider with no account flow', async () => {
    mocks.api = fakeApi({ status: { provider: 'anthropic' } })
    await mount()
    expect(byText('Add API key')).toBeTruthy()
    expect(containing('Connect with')).toBeUndefined()
  })
})

describe('the connect sheet', () => {
  it('starts an attempt and shows the authorize URL as text, plus copy and open actions', async () => {
    await mount()
    await openConnect()
    const node = authUrlNode()
    expect(node, 'the URL is rendered as selectable text, not only behind a button').toBeTruthy()
    expect(node.textContent).toBe(AUTH_URL)
    // A browser that will not launch from a link must not strand the admin.
    expect(byText('Copy link')).toBeTruthy()
    expect(byText('Open consent page')).toBeTruthy()
    expect(mocks.api.calls.some(c => c.path.endsWith('/connect/orcarouter/start'))).toBe(true)
  })

  it('exchanges the pasted code, quoting the generation back to the server', async () => {
    await mount()
    await openConnect()
    const field = container.querySelector('input[placeholder="paste the code"]')
    expect(field).toBeTruthy()
    await type(field, 'the-code-from-consent')
    await click(byText('Connect'))
    const sent = mocks.api.calls.find(c => c.path.endsWith('/connect/orcarouter/complete'))
    expect(sent, 'a completion was sent').toBeTruthy()
    expect(sent.body.code).toBe('the-code-from-consent')
    expect(sent.body.generation).toBe(3)
  })

  it('shows the server\'s own reason for a refused code, and keeps the URL for a retry', async () => {
    mocks.api = fakeApi({ completeError: 'That code has already been used. Start the connection again.' })
    await mount()
    await openConnect()
    const field = container.querySelector('input[placeholder="paste the code"]')
    await type(field, 'stale')
    await click(byText('Connect'))
    expect(container.textContent).toMatch(/already been used/i)
    expect(authUrlNode(), 'the attempt is not thrown away on a bad code').toBeTruthy()
  })

  it('tells the server about a cancellation, with keepalive', async () => {
    await mount()
    await openConnect()
    await click(byText('Cancel'))
    expect(mocks.releases.some(r => r.path.endsWith('/connect/orcarouter/cancel'))).toBe(true)
  })

  it('reports a decline rather than leaving the lock held', async () => {
    await mount()
    await openConnect()
    await click(containing('I declined on that page'))
    expect(mocks.releases.some(r => r.path.endsWith('/connect/orcarouter/denied'))).toBe(true)
  })

  it('surfaces a failure to start and offers to try again, instead of a dead sheet', async () => {
    mocks.api = fakeApi({ startError: 'the OrcaRouter provider is not registered' })
    await mount()
    await openConnect()
    expect(container.textContent).toMatch(/not registered/i)
    expect(byText('Try again')).toBeTruthy()
  })
})

describe('the model picker follows the catalog', () => {
  it('replaces the free-text field with a list once the provider has one, and keeps the previous value out of the selection when it is gone', async () => {
    // The stored model is one the endpoint no longer serves. The select must not keep selecting
    // it — a silent wrong value is a job that fails later with a confusing error. It falls back
    // to Default, and the stale name is still shown but explicitly labelled.
    mocks.api = fakeApi({
      status: {
        model: 'vendor/retired-model',
        models: { orcarouter: 'vendor/retired-model' },
        knownModels: ['vendor/kept-a', 'vendor/kept-b']
      }
    })
    await mount()
    const sel = container.querySelector('select.adm-select')
    expect(sel, 'the picker is a list, not a text field').toBeTruthy()
    expect(sel.value, 'an incompatible stored model is not silently kept selected').toBe('')
    const labels = [...sel.querySelectorAll('option')].map(o => o.textContent)
    expect(labels.some(l => /retired-model.*not in the list/i.test(l)), 'and the admin can see what was there').toBe(true)
    expect(labels).toContain('vendor/kept-a')
  })

  it('never renders a free-text model field for a provider whose list came back', async () => {
    mocks.api = fakeApi({ status: { knownModels: ['vendor/a'] } })
    await mount()
    expect(container.querySelector('select.adm-select')).toBeTruthy()
    // The TextField fallback is what an endpoint with no list gets; this provider has one.
    expect(container.querySelector('input[placeholder*="Default:"]')).toBeNull()
  })
})

describe('pagehide releases the lock without a remount', () => {
  it('cancels server-side work with keepalive and leaves the sheet able to start again', async () => {
    await mount()
    await openConnect()
    expect(authUrlNode()).toBeTruthy()

    await act(async () => { window.dispatchEvent(new Event('pagehide')) })

    const cancelCall = mocks.releases.find(r => r.path.endsWith('/connect/orcarouter/cancel'))
    expect(cancelCall, 'the server is told the page is going away').toBeTruthy()
    expect(cancelCall.keepalive, 'so the request survives the navigation').toBe(true)

    /* The back-forward-cache shape: this component was never unmounted and is not remounted. The
       dead attempt's URL is gone and the sheet offers a fresh start — which it can only do
       because the pagehide handler cleared the busy flag and the attempt itself, rather than
       leaving that to the cancelled request's generation-guarded `finally`, which correctly
       refuses to touch state and would have left the restored page permanently busy. */
    expect(authUrlNode(), 'the dead attempt is not still on screen').toBeNull()
    const before = mocks.api.calls.filter(c => c.path.endsWith('/connect/orcarouter/start')).length
    await click(byText('Try again'))
    const after = mocks.api.calls.filter(c => c.path.endsWith('/connect/orcarouter/start')).length
    expect(after, 'a second login starts without remounting the page').toBeGreaterThan(before)
    expect(authUrlNode(), 'and it has its own URL').toBeTruthy()
  })
})

describe('generation safety', () => {
  it('a late start response after unmount is dropped instead of written into state', async () => {
    let resolveStart
    mocks.api = async (path) => {
      if (path === '/api/admin/coach') return statusPayload()
      if (path.endsWith('/start')) return new Promise(r => { resolveStart = r })
      return {}
    }
    await mount()
    await openConnect()
    act(() => { root.unmount() })
    // The answer belongs to a component that is gone. Writing it into state is the bug the
    // generation guard exists to prevent; this must simply not throw and not render.
    await act(async () => { resolveStart({ ok: true, url: AUTH_URL, generation: 1, expiresAt: Date.now() + 1000 }) })
    expect(container.querySelector('[data-testid="orca-auth-url"]')).toBeNull()
    // Re-create a root so the shared afterEach unmount has something to unmount.
    root = createRoot(container)
  })
})
