// @vitest-environment happy-dom
// Settings → Integrations (v1.4.4): the cards by platform and server, the webhook add / test /
// retry / disconnect flow against a mocked API, and the way in from the Settings search.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  user: null, config: null, MOBILE: false, health: null, sheets: [], navs: [], toast: null, calls: [], answers: {}, confirm: null, menu: null,
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ S: {}, user: mocks.user, config: mocks.config, coachLocal: null })
  const useStore = selector => (selector ? selector(snap()) : snap())
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: mocks.toast, openSheet: render => { mocks.sheets.push(render); return { close: vi.fn() } } })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => mocks.navs.push(a) }))
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (path, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null
    mocks.calls.push([path.split('?')[0], body])
    const a = mocks.answers[path.split('?')[0]]
    if (a instanceof Error) throw a
    return typeof a === 'function' ? a(body) : a ?? {}
  }),
}))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
vi.mock('../lib/health-sync.js', () => ({
  healthStatus: () => Promise.resolve(mocks.health ? { status: mocks.health.status, platform: mocks.health.platform } : { status: 'unsupported' }),
  loadHealth: () => Promise.resolve(mocks.health || {}),
  onHealthChange: () => () => {},
  disableHealth: vi.fn(async () => ({})),
  disableRead: vi.fn(async () => ({})),
}))
vi.mock('../lib/clipboard.js', () => ({ copyText: vi.fn(async () => true) }))
vi.mock('../sheets.jsx', () => ({
  importFromApp: vi.fn(), importFromHevy: vi.fn(),
  confirmSheet: o => { mocks.confirm = o },
  menuSheet: o => { mocks.menu = o },
}))
vi.mock('../components/CsvExportSheet.jsx', () => ({ csvExportSheet: vi.fn() }))

import IntegrationsPage from './Integrations.jsx'
import { importFromHevy } from '../sheets.jsx'
import { searchSettings } from './settings-pages.js'

let host, root, sheetHost, sheetRoot
beforeEach(() => {
  Object.assign(mocks, { user: null, config: null, MOBILE: false, health: null, sheets: [], navs: [], calls: [], answers: {}, confirm: null, menu: null, toast: vi.fn() })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  sheetHost = document.createElement('div'); document.body.appendChild(sheetHost); sheetRoot = createRoot(sheetHost)
})
afterEach(() => {
  act(() => { root.unmount(); sheetRoot.unmount() })
  host.remove(); sheetHost.remove()
})

const mount = async (props = {}) => {
  await act(async () => { root.render(<IntegrationsPage {...props} />) })
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
}
const card = id => host.querySelector(`[data-card="${id}"]`)
const pill = id => card(id)?.querySelector('.intg-pill')?.textContent
const action = id => card(id)?.querySelector('.intg-act')
const closeSheet = vi.fn()
const showSheet = async () => {
  await act(async () => { sheetRoot.render(<>{mocks.sheets.at(-1)(closeSheet)}</>) })
  await act(async () => { await Promise.resolve() })
}
const sheetBtn = text => [...sheetHost.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const type = (input, v) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})

describe('the cards', () => {
  it('a guest in a browser: the health stores live in the phone app, webhooks need a server, nothing fake to connect', async () => {
    await mount()
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['Health & devices', 'Works with', 'Training apps', 'Automation', 'AI & API'])
    expect(pill('apple-health')).toBe('Not available on this device')
    expect(pill('health-connect')).toBe('Not available on this device')
    expect(action('apple-health')).toBeNull()
    expect(pill('webhook')).toBe('Needs your server')
    expect(action('webhook')).toBeNull()
    expect(card('coach')).toBeNull()
    // Works with: names only, each a way to the explanation, none a Connect button.
    const chips = [...host.querySelectorAll('.intg-chip')].map(b => b.textContent)
    expect(chips).toEqual(['Garmin', 'COROS', 'Polar', 'Fitbit', 'Samsung Health', 'Oura', 'Withings', 'Renpho'])
    act(() => host.querySelector('.intg-chip').click())
    await showSheet()
    expect(sheetHost.textContent).toContain('Garmin saves to Apple Health on iPhone or Health Connect on Android.')
    expect(sheetHost.textContent).toContain('Install the openGym app on your phone to use this.')
    // Screen readers hear the name and the state in one go.
    expect(card('webhook').querySelector('.intg-open').getAttribute('aria-label')).toBe('Webhooks, Needs your server')
  })

  it('on Android: Health Connect only, off until set up on its page; imports open their sheets', async () => {
    mocks.MOBILE = true
    mocks.health = { status: 'available', platform: 'android', on: false }
    await mount({ android: true })
    expect(card('apple-health')).toBeNull()
    expect(pill('health-connect')).toBe('Off')
    act(() => action('health-connect').click())
    expect(mocks.navs).toEqual([['/settings/health-connect']])
    act(() => action('hevy').click())
    expect(importFromHevy).toHaveBeenCalled()
    // The detail sheet says what it does.
    act(() => card('health-connect').querySelector('.intg-open').click())
    await showSheet()
    expect(sheetHost.textContent).toContain('Finished workouts and weigh-ins go to Health Connect.')
    expect(sheetHost.textContent).toContain('Last sync')
  })

  it('on iPhone, connected Apple Health offers Disconnect, which asks what happens to what it wrote', async () => {
    mocks.MOBILE = true
    mocks.health = { status: 'available', platform: 'ios', on: true, at: Date.now() - 60000 }
    await mount({ ios: true })
    expect(card('health-connect')).toBeNull()
    expect(pill('apple-health')).toBe('Connected')
    act(() => card('apple-health').querySelector('.intg-open').click())
    await showSheet()
    act(() => sheetBtn('Disconnect').click())
    expect(mocks.menu.title).toBe('Disconnect Apple Health?')
    expect(mocks.menu.items.map(i => i.label)).toEqual(['Stop, keep what it wrote', 'Stop and remove what it wrote'])
  })

  it('signed in on a server without webhooks: no card, unless you run the place', async () => {
    mocks.user = { id: 'u1' }
    await mount()
    expect(card('webhook')).toBeNull()
    mocks.user = { id: 'u1', admin: true }
    await mount()
    expect(pill('webhook')).toBe('Off')
    act(() => action('webhook').click())
    await showSheet()
    expect(sheetHost.textContent).toContain('INTEGRATIONS=webhook')
  })
})

describe('webhooks', () => {
  const conn = over => ({ id: 'c_1', provider: 'webhook', label: 'Home Assistant', events: ['workout.finished'], paused: false, status: 'connected', info: { url: 'https://ha.example.com/api/webhook/…7f3a' }, lastOk: Date.now() - 3600_000, lastError: null, failed: 0, ...over })
  beforeEach(() => {
    mocks.user = { id: 'u1', name: 'Dana' }
    mocks.config = { integrations: { providers: ['webhook'] } }
  })

  it('connect: the URL is checked here first, then the server answers with the secret, shown once', async () => {
    mocks.answers['/api/integrations'] = { providers: [{ id: 'webhook', max: 10 }], connections: [] }
    mocks.answers['/api/integrations/connect'] = { connection: conn(), reveal: { secret: 'ogwh_abc123' } }
    await mount()
    expect(pill('webhook')).toBe('Off')
    expect(action('webhook').textContent).toBe('Connect')
    act(() => action('webhook').click())
    await showSheet()
    const [url, name] = sheetHost.querySelectorAll('input')
    await type(url, 'http://192.168.1.5:8123/api/webhook/x')
    await act(async () => { sheetBtn('Add webhook').click() })
    expect(sheetHost.querySelector('[role="alert"]').textContent).toBe('It has to start with https://.')
    expect(mocks.calls.some(c => c[0] === '/api/integrations/connect')).toBe(false)
    // The problem sits under the URL it is about and is tied to it (Integrations pass, I8).
    expect(url.getAttribute('aria-invalid')).toBe('true')
    expect(url.getAttribute('aria-describedby')).toBe(sheetHost.querySelector('[role="alert"]').id)
    expect(url.nextElementSibling.getAttribute('role')).toBe('alert')
    expect(sheetHost.querySelector('label[for="intg-url"]').textContent).toBe('Webhook URL')
    await type(url, 'https://ha.example.com/api/webhook/opengym-7f3a')
    await type(name, 'Home Assistant')
    // Records too, on top of the default.
    act(() => [...sheetHost.querySelectorAll('.lrow')].find(r => r.textContent.includes('New personal record')).querySelector('[role="switch"]').click())
    await act(async () => { sheetBtn('Add webhook').click() })
    const sent = mocks.calls.find(c => c[0] === '/api/integrations/connect')[1]
    expect(sent).toEqual({ provider: 'webhook', url: 'https://ha.example.com/api/webhook/opengym-7f3a', label: 'Home Assistant', events: ['workout.finished', 'workout.pr'] })
    expect(sheetHost.querySelector('.intg-secret').textContent).toBe('ogwh_abc123')
    expect(sheetHost.textContent).toContain('You will see it only now')
  })

  it('the server refusing a URL is said in plain words', async () => {
    mocks.answers['/api/integrations'] = { providers: [{ id: 'webhook', max: 10 }], connections: [] }
    mocks.answers['/api/integrations/connect'] = Object.assign(new Error('url points at a private address (your admin can allow the home network)'), { status: 400, code: 'url' })
    await mount()
    act(() => action('webhook').click())
    await showSheet()
    await type(sheetHost.querySelector('input'), 'https://10.0.0.5/hook')
    await act(async () => { sheetBtn('Add webhook').click() })
    expect(sheetHost.querySelector('[role="alert"]').textContent).toBe('Your server said no to that URL: url points at a private address (your admin can allow the home network)')
  })

  it('a webhook that needs attention: test, retry and disconnect from its sheet', async () => {
    const broken = conn({ status: 'attention', failed: 2, lastError: { at: Date.now() - 60000, msg: 'The receiver answered 503.' } })
    mocks.answers['/api/integrations'] = { providers: [{ id: 'webhook', max: 10 }], connections: [broken] }
    mocks.answers['/api/integrations/retry'] = { requeued: 2, connection: conn() }
    mocks.answers['/api/integrations/test'] = { ok: true, status: 204, connection: conn() }
    mocks.answers['/api/integrations/disconnect'] = { ok: true }
    await mount()
    expect(pill('webhook')).toBe('Needs attention')
    expect(action('webhook').textContent).toBe('Manage')
    act(() => action('webhook').click())
    await showSheet()
    expect(sheetHost.textContent).toContain('ha.example.com/api/webhook/…7f3a')
    act(() => [...sheetHost.querySelectorAll('.lrow')].find(r => r.textContent.includes('Home Assistant')).click())
    await showSheet()
    expect(sheetHost.textContent).toContain('The receiver answered 503.')
    await act(async () => { sheetBtn('Retry').click() })
    expect(mocks.calls.find(c => c[0] === '/api/integrations/retry')[1]).toEqual({ id: 'c_1' })
    expect(mocks.toast).toHaveBeenCalledWith('Sending again')
    expect(sheetHost.textContent).not.toContain('The receiver answered 503.')
    await act(async () => { sheetBtn('Send test event').click() })
    expect(mocks.toast).toHaveBeenCalledWith('Test event delivered')
    // Disconnect is the last thing in the sheet, a red row in a group of its own (P4, P6).
    const btns = [...sheetHost.querySelectorAll('button')]
    expect(btns[btns.length - 1]).toBe(sheetBtn('Disconnect'))
    expect(sheetBtn('Disconnect').closest('.intg-end')).toBeTruthy()
    expect(sheetBtn('Disconnect').classList.contains('danger')).toBe(true)
    act(() => sheetBtn('Disconnect').click())
    expect(mocks.confirm.title).toBe('Disconnect this webhook?')
    await act(async () => { await mocks.confirm.onConfirm() })
    expect(mocks.calls.find(c => c[0] === '/api/integrations/disconnect')[1]).toEqual({ id: 'c_1' })
    expect(mocks.toast).toHaveBeenCalledWith('Webhook removed')
  })

  it('switching the last event off is refused here, before it reaches the server', async () => {
    mocks.answers['/api/integrations'] = { providers: [{ id: 'webhook', max: 10 }], connections: [conn()] }
    await mount()
    act(() => action('webhook').click())
    await showSheet()
    act(() => [...sheetHost.querySelectorAll('.lrow')].find(r => r.textContent.includes('Home Assistant')).click())
    await showSheet()
    act(() => [...sheetHost.querySelectorAll('.lrow')].find(r => r.textContent.includes('Workout finished')).querySelector('[role="switch"]').click())
    expect(mocks.toast).toHaveBeenCalledWith('Pick at least one thing to send.')
    expect(mocks.calls.some(c => c[0] === '/api/integrations/update')).toBe(false)
  })
})

describe('Strava', () => {
  const conn = over => ({ id: 'c_s', provider: 'strava', label: 'Dana H', events: ['workout.finished'], paused: false, status: 'connected', info: { athlete: 'Dana H' }, lastOk: Date.now() - 3600_000, lastError: null, failed: 0, ...over })
  const offer = connections => { mocks.answers['/api/integrations'] = { providers: [{ id: 'strava', kind: 'oauth', max: 1 }], connections } }
  let assign
  beforeEach(() => {
    mocks.user = { id: 'u1', name: 'Dana' }
    mocks.config = { integrations: { providers: ['strava'] } }
    assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {})
  })
  afterEach(() => { assign.mockRestore(); window.location.hash = '' })

  it('connect sends the browser to the server, which sends it on to Strava', async () => {
    offer([])
    await mount()
    expect(pill('strava')).toBe('Off')
    expect(action('strava').textContent).toBe('Connect')
    // The card itself says what will happen first.
    act(() => card('strava').querySelector('.intg-open').click())
    await showSheet()
    expect(sheetHost.textContent).toContain('Upload only: nothing is read from Strava.')
    act(() => action('strava').click())
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign.mock.calls[0][0]).toMatch(/\/api\/integrations\/oauth\/authorize\?provider=strava$/)
  })

  it('the phone app cannot do the sign-in, and says where to', async () => {
    mocks.MOBILE = true
    offer([])
    await mount({ ios: true })
    act(() => action('strava').click())
    await showSheet()
    expect(assign).not.toHaveBeenCalled()
    expect(sheetHost.textContent).toContain('Open openGym on your server in a browser and connect Strava there.')
  })

  it('back from Strava: says how it went and tidies the address', async () => {
    window.location.hash = '#/settings/integrations?oauth=strava&result=connected'
    offer([conn()])
    await mount()
    expect(mocks.toast).toHaveBeenCalledWith('Strava connected. New workouts upload on their own.')
    expect(mocks.navs).toEqual([['/settings/integrations', { replace: true }]])
    expect(pill('strava')).toBe('Connected')
  })

  it('connected: pause, check, and disconnect from its sheet', async () => {
    offer([conn()])
    mocks.answers['/api/integrations/update'] = b => ({ connection: conn({ paused: b.paused, status: b.paused ? 'paused' : 'connected' }) })
    mocks.answers['/api/integrations/test'] = { ok: true, status: 200, connection: conn() }
    mocks.answers['/api/integrations/log'] = { log: [{ at: Date.now() - 5000, ev: 'workout.finished', ok: true, status: 201 }] }
    await mount()
    act(() => action('strava').click())
    await showSheet()
    expect(sheetHost.textContent).toContain('Dana H')
    expect(sheetHost.textContent).toContain('Strava account')
    await act(async () => { sheetHost.querySelector('[role="switch"]').click() })
    expect(mocks.calls.find(c => c[0] === '/api/integrations/update')[1]).toEqual({ id: 'c_s', paused: true })
    expect(sheetHost.textContent).toContain('Paused. Nothing is sent until you switch it back on.')
    await act(async () => { sheetBtn('Check connection').click() })
    expect(mocks.toast).toHaveBeenCalledWith('Strava connection works')
    await act(async () => { sheetBtn('Show activity').click() })
    expect(sheetHost.textContent).toContain('Workout finished · 201')
    act(() => sheetBtn('Disconnect').click())
    expect(mocks.confirm.title).toBe('Disconnect Strava?')
    await act(async () => { mocks.confirm.onConfirm() })
    expect(mocks.calls.find(c => c[0] === '/api/integrations/disconnect')[1]).toEqual({ id: 'c_s' })
    expect(mocks.toast).toHaveBeenCalledWith('Strava disconnected')
  })

  it('a connection Strava turned down offers Reconnect, not a switch', async () => {
    offer([conn({ status: 'attention', paused: true, failed: 1, lastError: { at: Date.now() - 60000, code: 'reconnect', msg: 'Strava no longer accepts this connection. Connect it again.' } })])
    await mount()
    expect(pill('strava')).toBe('Needs attention')
    act(() => action('strava').click())
    await showSheet()
    expect(sheetHost.querySelector('[role="switch"]')).toBeNull()
    expect(sheetBtn('Retry')).toBeUndefined()
    expect(sheetHost.textContent).toContain('Strava stopped accepting this connection. Reconnect to resume uploads.')
    act(() => [...sheetHost.querySelectorAll('.lrow')].find(r => r.textContent.includes('Reconnect Strava')).click())
    expect(assign).toHaveBeenCalledTimes(1)
  })

  it('in the phone app a revoked connection says where to sign in again', async () => {
    mocks.MOBILE = true
    offer([conn({ status: 'attention', paused: true, lastError: { at: Date.now(), code: 'reconnect', msg: 'Strava no longer accepts this connection. Connect it again.' } })])
    await mount({ ios: true })
    act(() => action('strava').click())
    await showSheet()
    expect(sheetHost.textContent).not.toContain('Reconnect Strava')
    expect(sheetHost.textContent).toContain('Open openGym on your server in a browser and connect Strava there.')
  })

  it('a server without Strava: no card, and its admin is told how to switch it on', async () => {
    mocks.config = { integrations: { providers: ['webhook'] } }
    mocks.answers['/api/integrations'] = { providers: [{ id: 'webhook', max: 10 }], connections: [] }
    await mount()
    expect(card('strava')).toBeNull()
    mocks.user = { id: 'u1', admin: true }
    await mount()
    expect(pill('strava')).toBe('Off')
    act(() => action('strava').click())
    await showSheet()
    expect(sheetHost.textContent).toContain('STRAVA_CLIENT_ID')
  })
})

describe('the Settings search', () => {
  it('finds Strava where the server offers it', () => {
    const tr = s => s
    expect(searchSettings('strava', { user: { id: 'u' }, mobile: false, integrations: ['strava'] }, tr).map(h => h.title)).toContain('Strava')
    expect(searchSettings('strava', { user: { id: 'u' }, mobile: false, integrations: [] }, tr).map(h => h.title)).not.toContain('Strava')
  })

  it('finds the page and its cards by what people type', () => {
    const ctx = { user: null, mobile: false, demo: false }
    const tr = s => s
    expect(searchSettings('integrations', ctx, tr)[0]).toMatchObject({ page: 'integrations', isPage: true })
    expect(searchSettings('home assistant', ctx, tr).map(h => h.title)).toContain('Webhooks')
    expect(searchSettings('garmin', ctx, tr).map(h => h.title)).toContain('Garmin')
    expect(searchSettings('webhook', { user: { id: 'u' }, mobile: false, integrations: [] }, tr).map(h => h.title)).not.toContain('Webhooks')
    // On a phone the health store is its own page, found under Integrations.
    const phone = searchSettings('healthkit', { mobile: true, ios: true }, tr)
    expect(phone[0]).toMatchObject({ page: 'apple-health', trail: 'Settings' })
  })
})
