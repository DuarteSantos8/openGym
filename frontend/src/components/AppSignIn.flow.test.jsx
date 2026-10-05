// @vitest-environment happy-dom

/* The phone's connect screen offers a provider button once its server's config says one is
 * configured, the departure carries an S256 challenge this phone generated itself, and the return
 * (the OS handing this app an opengym:// intent) redeems that challenge's own verifier for a
 * token - against the real store, remote and api modules, exactly as a real connect would run.
 * Only the native bridge (Capacitor) and the unrelated action-sheet module are replaced. */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { challengeFor } from '../lib/oidc-app.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => {
  vi.stubEnv('VITE_MOBILE', '1')   // lib/mobile.js: MOBILE = import.meta.env.VITE_MOBILE === '1'
  return { files: new Map(), server: null, calls: [], appUrlOpen: null }
})

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS', Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path, directory }) => {
      const k = directory + '/' + path
      if (!h.files.has(k)) throw new Error('File does not exist')
      return { data: h.files.get(k) }
    },
    writeFile: async ({ path, directory, data }) => { h.files.set(directory + '/' + path, data); return { uri: 'file://' + path } },
  },
}))
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { cancel: async () => {}, checkPermissions: async () => ({ display: 'granted' }), requestPermissions: async () => ({ display: 'granted' }), schedule: async () => {} },
}))
// getLaunchUrl resolves undefined - this phone was already running, not cold-started by the return.
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (event, cb) => { if (event === 'appUrlOpen') h.appUrlOpen = cb; return { remove() {} } },
    getLaunchUrl: async () => undefined,
  },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true }, registerPlugin: () => ({}) }))
// A heavy, unrelated module (every action-sheet in the app) that adoptProfile only reaches when
// the server's copy actually holds something to ask about - never in these cases.
vi.mock('../sheets.jsx', () => ({ askAddDeviceData: vi.fn() }))

const BASE = 'https://gym.example.com'
const USER = { id: 'u1', name: 'Ana', admin: false }
const res = (status, body, type = 'application/json') => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (k.toLowerCase() === 'content-type' ? type : null) },
  json: async () => JSON.parse(body),
  text: async () => body,
})
const json = (status, body) => res(status, JSON.stringify(body))

function installFetch(oidc) {
  h.calls = []
  globalThis.fetch = window.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase()
    const call = { url: String(url), method, auth: init.headers?.Authorization || null, body: init.body ? JSON.parse(init.body) : null }
    h.calls.push(call)
    if (String(url).startsWith(BASE)) return h.server(String(url).slice(BASE.length), method, init, call)
    const last = String(url).split('?')[0].split('/').pop()
    return last.includes('.') ? res(404, '') : res(200, '<!doctype html><div id="root"></div>', 'text/html')
  })
  h.server = (path, method) => {
    if (path.startsWith('/api/config')) return json(200, { invite_only: false, allow_guest: true, ...(oidc ? { oidc } : {}) })
    if (path === '/api/oidc/app/redeem' && method === 'POST') return json(200, { token: 'TOKEN-NEW', user: USER })
    if (path === '/api/data') return json(200, {})
    return json(404, { error: 'not found' })
  }
}

const mounted = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push({ root, host })
  act(() => root.render(el))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const readFile = name => { const v = h.files.get('DATA/' + name); return v == null ? null : JSON.parse(v) }
const redeemCalls = () => h.calls.filter(c => c.url.includes('/api/oidc/app/redeem'))

function type(input, value) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}

beforeEach(() => {
  h.files.clear()
  h.calls = []
  h.appUrlOpen = null
  localStorage.clear()
  history.replaceState(null, '', '/')
})
afterEach(async () => {
  act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) })
  vi.resetModules()
})

describe('the connect screen\'s provider button, per the typed server\'s own config', () => {
  it('shows "Sign in with Google" once a server whose config carries oidc answers', async () => {
    installFetch({ name: 'Google' })
    const { ConnectSheet } = await import('../views/MobileOnboarding.jsx')
    const page = mount(<ConnectSheet close={() => {}} />)
    type(page.querySelector('input[placeholder^="Server address"]'), BASE)
    await act(() => sleep(450))
    expect(button(page, 'Sign in with Google')).toBeTruthy()
  })

  it('shows no such button for a server with no provider configured', async () => {
    installFetch(null)
    const { ConnectSheet } = await import('../views/MobileOnboarding.jsx')
    const page = mount(<ConnectSheet close={() => {}} />)
    type(page.querySelector('input[placeholder^="Server address"]'), BASE)
    await act(() => sleep(450))
    expect(button(page, 'Sign in with Google')).toBeFalsy()
    expect([...page.querySelectorAll('button')].some(b => /^Sign in with /.test(b.textContent))).toBe(false)
  })
})

describe('the full app sign-in round trip', () => {
  it('departs with a challenge, redeems exactly once on return, and connects the store', async () => {
    installFetch({ name: 'Google' })
    const { ConnectSheet } = await import('../views/MobileOnboarding.jsx')
    const { listenForProviderReturn } = await import('./AppSignIn.jsx')
    listenForProviderReturn()

    const page = mount(<ConnectSheet close={() => {}} />)
    type(page.querySelector('input[placeholder^="Server address"]'), BASE)
    await act(() => sleep(450))
    const providerButton = button(page, 'Sign in with Google')
    expect(providerButton).toBeTruthy()

    await act(async () => { providerButton.click(); await sleep(20) })
    expect(window.location.href).toContain(BASE + '/api/oidc/app/start?challenge=')
    const departureChallenge = new URL(window.location.href).searchParams.get('challenge')
    expect(departureChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/)

    expect(typeof h.appUrlOpen).toBe('function')
    const code = 'c'.repeat(20)
    // The real appUrlOpen event carries { url }, exactly as Capacitor's own App plugin delivers it.
    await act(async () => {
      h.appUrlOpen({ url: `opengym://oidc?code=${code}` })
      for (let i = 0; i < 30 && redeemCalls().length === 0; i++) await sleep(20)
      await sleep(50)   // the rest of connectViaProvider's tail (config, adoptProfile, the mirror file)
    })

    expect(redeemCalls().length).toBe(1)
    expect(redeemCalls()[0].body.code).toBe(code)
    expect(redeemCalls()[0].auth).toBe(null)
    expect(await challengeFor(redeemCalls()[0].body.verifier)).toBe(departureChallenge)

    const { useStore } = await import('../store/useStore.js')
    expect(useStore.getState().user).toEqual(USER)
    expect(readFile('opengym-remote.json')).toEqual({ mode: 'remote', base: BASE, token: 'TOKEN-NEW', user: USER })

    // A second return with another code: the attempt was already spent by the first one, so
    // finishAppReturn finds nothing to redeem and makes no request at all.
    await act(async () => {
      h.appUrlOpen({ url: `opengym://oidc?code=${'d'.repeat(20)}` })
      await sleep(50)
    })
    expect(redeemCalls().length).toBe(1)
  })
})
