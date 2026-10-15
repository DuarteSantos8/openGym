// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The Plan tab's Coach card hangs off /api/config, which the app reads once per boot. An admin
   who switched the Coach on and connected it used to find no Coach anywhere until a reload
   (Discord #install-help, 2026-09-19). Every change on the admin card now re-reads it. */
const mocks = vi.hoisted(() => ({
  refreshConfig: vi.fn(async () => ({})),
  calls: [],
  // The shape GET /api/admin/coach answers with (api/coach/routes.js), trimmed to one provider.
  status: {
    disabledByEnv: false, enabled: false, provider: 'anthropic',
    providers: [{ id: 'anthropic', label: 'Anthropic API', runtime: 'HTTPS', apiKey: true, http: true, connected: false }],
    model: null, models: {}, baseUrl: null, knownModels: null,
    caps: { perProfileDaily: 5, instanceDaily: 0 }, community: false,
    runtime: { ok: false, version: null, error: null, needsKey: true }, authMode: 'shared', boundUid: null,
    auth: { state: 'none' }, unprivileged: { ok: true, dropped: false, why: 'this provider runs no child process' },
    jobsToday: 0, lastSuccess: null, lastError: null, recent: [],
  },
}))
vi.mock('../lib/api.js', () => ({
  api: async (path, opts) => {
    mocks.calls.push([path, opts?.method || 'GET'])
    if (path === '/api/admin/coach') return structuredClone(mocks.status)
    if (path === '/api/admin/coach/config') { mocks.status.enabled = JSON.parse(opts.body).enabled; return { ok: true } }
    return {}
  },
}))
vi.mock('../store/useStore.js', () => {
  const snap = () => ({ refreshConfig: mocks.refreshConfig })
  const useStore = selector => selector ? selector(snap()) : snap()
  useStore.getState = snap
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: vi.fn() })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})

const { default: AdminCoach } = await import('./AdminCoach.jsx')

const mounted = []
afterEach(() => { act(() => { mounted.splice(0).forEach(({ root, host }) => { root.unmount(); host.remove() }) }) })
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

describe('AdminCoach keeps the app\'s own config current', () => {
  it('re-reads /api/config after loading and after switching the Coach on', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted.push({ root, host })
    act(() => root.render(<AdminCoach />))
    await flush()
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(1)

    const setUp = [...host.querySelectorAll('button')].find(b => b.textContent.includes('Set up the Coach'))
    expect(setUp).toBeTruthy()
    await act(async () => { setUp.click() })
    await flush()
    expect(mocks.calls).toContainEqual(['/api/admin/coach/config', 'POST'])
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(2)
  })
})

/* Extra-headers textarea helpers (issue #385): parse client-side, empty clears. */
describe('AdminCoach extra headers', async () => {
  const { parseHeadersText, headersToText } = await import('./AdminCoach.jsx')

  it('round-trips a map through the textarea format', () => {
    expect(headersToText({ 'x-opencode-session': 'sess-1' })).toBe('x-opencode-session: sess-1')
    expect(headersToText(null)).toBe('')
    expect(parseHeadersText('x-opencode-session: sess-1\nX-Title: demo')).toEqual({ headers: { 'x-opencode-session': 'sess-1', 'X-Title': 'demo' } })
  })

  it('treats empty as clear and junk as an error, not a request', () => {
    expect(parseHeadersText('')).toEqual({ headers: null })
    expect(parseHeadersText('   \n  ')).toEqual({ headers: null })
    expect(parseHeadersText('no-colon-here').error).toBeTruthy()
    expect(parseHeadersText('name-only:').error).toBeTruthy()
  })
})
