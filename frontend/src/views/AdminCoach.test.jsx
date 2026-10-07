// @vitest-environment happy-dom
//
// The operator's side of the Coach. This screen is the only place the feature can be switched
// off for everyone, the only place a stored provider credential can be destroyed, and the only
// place the daily spend caps on somebody's API key are set — so the tests here are about what
// it WRITES, not what it draws.
//
// Every test drives the real component against a fake /api/admin/coach* and asserts the request
// that left (path, method, body) and what the screen does with the answer. The three paths that
// cannot be undone come first: the master switch, "Remove" (disconnect) and the caps.
//
// Traps this file is written around, all of them already paid for elsewhere in this repo:
//   · globalThis.IS_REACT_ACT_ENVIRONMENT = true is required or every act() warns and state
//     updates are not flushed.
//   · el.value = x does NOT reach React. Every value goes through the native prototype setter
//     (the repo's `type()` pattern) before the event is dispatched.
//   · React's onBlur is the native `focusout` event, not `blur` (which does not bubble).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminCoach from './AdminCoach.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  calls: [],
  routes: {},
  sheets: [],
  toast: vi.fn(),
  confirmSheet: vi.fn(),
}))

// The confirm dialog is captured, not rendered: a test reads what it was asked and presses
// its onConfirm itself, the same shape CheckIn.test.jsx uses.
vi.mock('../sheets.jsx', () => ({ confirmSheet: (...a) => mocks.confirmSheet(...a) }))

// One fake API. `routes` maps a path to a value, a function of the parsed body, or an Error to
// reject with — so a test can say "the server refuses this" without touching the component.
vi.mock('../lib/api.js', () => ({
  api: (path, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined
    mocks.calls.push({ path, method: opts.method || 'GET', body })
    const route = mocks.routes[path]
    if (route === undefined) return Promise.reject(new Error('no route for ' + path))
    const answer = typeof route === 'function' ? route(body) : route
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  }
}))

vi.mock('../store/useUI.js', () => {
  const snap = () => ({
    toast: (...a) => mocks.toast(...a),
    openSheet: render => { mocks.sheets.push(render); return { id: 's', close: () => {}, lock: () => {} } },
  })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})

/* ------------------------------ fixtures ------------------------------ */

// Shaped exactly like GET /api/admin/coach in api/coach/routes.js.
const PROVIDERS = [
  { id: 'anthropic', label: 'Claude', runtime: false, setupToken: true, deviceLogin: false, apiKey: true, http: true, baseUrl: false, keyOptional: false, keyPlaceholder: 'sk-ant-…', defaultModel: 'claude-sonnet-4', connected: true },
  { id: 'openai', label: 'OpenAI', runtime: false, setupToken: false, deviceLogin: false, apiKey: true, http: true, baseUrl: false, keyOptional: false, keyPlaceholder: 'sk-…', defaultModel: 'gpt-4o', connected: false },
  { id: 'compatible', label: 'OpenAI-compatible', runtime: false, setupToken: false, deviceLogin: false, apiKey: true, http: true, baseUrl: true, keyOptional: true, keyPlaceholder: null, defaultModel: null, connected: false },
  { id: 'claude', label: 'Claude Code', runtime: true, setupToken: true, deviceLogin: false, apiKey: false, http: false, baseUrl: false, keyOptional: false, keyPlaceholder: null, defaultModel: null, connected: false },
  { id: 'fixture', label: 'Built-in fixture', runtime: false, setupToken: false, deviceLogin: false, apiKey: false, http: false, baseUrl: false, keyOptional: false, keyPlaceholder: null, defaultModel: null, connected: false },
]

const status = (over = {}) => ({
  disabledByEnv: false,
  enabled: true,
  provider: 'anthropic',
  providers: PROVIDERS,
  model: 'claude-sonnet-4',
  models: {},
  baseUrl: null,
  knownModels: null,
  caps: { perProfileDaily: 5, instanceDaily: 50 },
  community: false,
  runtime: { ok: true, version: 'HTTPS · api.anthropic.com · 8 models', error: null, needsKey: false },
  authMode: 'instance',
  boundUid: null,
  auth: { state: 'connected', type: 'apikey', account: 'ops@example.com', connectedAt: '2026-09-21T10:00:00Z' },
  unprivileged: { ok: true, dropped: false, why: 'this provider runs no child process' },
  jobsToday: 3,
  lastSuccess: { at: '2026-09-21T10:00:00Z' },
  lastError: null,
  recent: [],
  ...over,
})

/* ------------------------------- harness ------------------------------- */

let host, root, sheetHost, sheetRoot

beforeEach(() => {
  mocks.calls.length = 0
  mocks.sheets.length = 0
  mocks.confirmSheet.mockClear()
  mocks.toast.mockClear()
  mocks.routes = {
    '/api/admin/coach': status(),
    '/api/admin/coach/config': { ok: true },
    '/api/admin/coach/disconnect': { ok: true },
    '/api/admin/coach/connect': { ok: true },
    '/api/admin/coach/models': { ok: true, models: ['a', 'b'] },
    '/api/admin/coach/test': { ok: true },
  }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  sheetHost = document.createElement('div'); document.body.appendChild(sheetHost); sheetRoot = createRoot(sheetHost)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  act(() => sheetRoot.unmount()); sheetHost.remove()
})

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const mount = async () => { act(() => { root.render(<AdminCoach />) }); await settle() }
const tap = async el => { await act(async () => { el.click(); await new Promise(r => setTimeout(r, 0)) }) }

const btn = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
// Remove asks first (2026-09-22). Tap it, then press the dialog's own confirm.
const removeConfirmed = async () => {
  await tap(btn('Remove'))
  const ask = mocks.confirmSheet.mock.calls.at(-1)?.[0]
  expect(ask, 'Remove should have opened a confirm').toBeTruthy()
  await act(async () => { await ask.onConfirm() })
}
const chip = label => [...host.querySelectorAll('button.chip')].find(b => b.textContent.startsWith(label))
const master = () => host.querySelector('[role="switch"]')
const sent = path => mocks.calls.filter(c => c.path === path)

// React's onBlur is `focusout`. The value goes in through the native prototype setter so React's
// value tracker sees it, exactly as the repo's other input tests do.
const blurWith = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('focusout', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
  })
}
const pick = async (el, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('change', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
  })
}

// Opens the last sheet the screen asked for into its own root and returns it.
const openLastSheet = async () => {
  expect(mocks.sheets.length).toBeGreaterThan(0)
  const close = vi.fn()
  act(() => { sheetRoot.render(mocks.sheets.at(-1)(close)) })
  await settle()
  return { close }
}
const sheetBtn = label => [...sheetHost.querySelectorAll('button')].find(b => b.textContent === label)
const sheetFields = () => [...sheetHost.querySelectorAll('input')]

/* ================================ tests ================================ */

describe('AdminCoach — loading and the env kill switch', () => {
  it('a failed status call toasts the reason and draws no card at all (no half-built admin surface)', async () => {
    mocks.routes['/api/admin/coach'] = new Error('admin session expired')
    await mount()
    expect(mocks.toast).toHaveBeenCalledWith('admin session expired')
    expect(host.textContent).toContain('Loading Coach status…')
    expect(master()).toBeFalsy()
    expect([...host.querySelectorAll('button')]).toHaveLength(0)
  })

  it('COACH_DISABLED in the environment leaves no control on the screen — the switch is absent, not merely off', async () => {
    mocks.routes['/api/admin/coach'] = status({ disabledByEnv: true })
    await mount()
    expect(host.textContent).toContain('COACH_DISABLED')
    expect(master()).toBeFalsy()
    expect([...host.querySelectorAll('button')]).toHaveLength(0)
    expect(sent('/api/admin/coach/config')).toHaveLength(0)
  })
})

describe('AdminCoach — the master switch (the only way the Coach is off for everyone)', () => {
  it('"Set up the Coach" turns it on and re-reads the status, and is the only button on the off screen', async () => {
    mocks.routes['/api/admin/coach'] = status({ enabled: false })
    await mount()
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Set up the Coach'])

    mocks.routes['/api/admin/coach'] = status({ enabled: true })
    await tap(btn('Set up the Coach'))
    expect(sent('/api/admin/coach/config')).toEqual([
      { path: '/api/admin/coach/config', method: 'POST', body: { enabled: true } }
    ])
    // The screen re-reads rather than trusting its own optimism.
    expect(sent('/api/admin/coach')).toHaveLength(2)
    expect(master()).toBeTruthy()
  })

  it('switching it off posts enabled:false and the whole wizard disappears with it', async () => {
    await mount()
    mocks.routes['/api/admin/coach'] = status({ enabled: false })
    await tap(master())
    expect(sent('/api/admin/coach/config')[0].body).toEqual({ enabled: false })
    expect(host.textContent).toContain('nobody sees it anywhere in the app')
    expect(host.querySelector('.adm-step')).toBeFalsy()
  })

  it('a refused change is NOT applied locally — the switch stays where the server left it and says why', async () => {
    await mount()
    expect(master().getAttribute('aria-checked')).toBe('true')
    mocks.routes['/api/admin/coach/config'] = new Error('config file is read-only')
    await tap(master())
    expect(mocks.toast).toHaveBeenCalledWith('config file is read-only')
    expect(master().getAttribute('aria-checked')).toBe('true')
    // A failed write must not trigger a re-read that could look like success.
    expect(sent('/api/admin/coach')).toHaveLength(1)
  })
})

describe('AdminCoach — removing the stored credential (irreversible: the key is never shown again)', () => {
  it('posts the ACTIVE provider id to /disconnect, says so, and re-reads', async () => {
    await mount()
    mocks.routes['/api/admin/coach'] = status({ auth: { state: 'none' } })
    await removeConfirmed()
    expect(sent('/api/admin/coach/disconnect')).toEqual([
      { path: '/api/admin/coach/disconnect', method: 'POST', body: { provider: 'anthropic' } }
    ])
    expect(mocks.toast).toHaveBeenCalledWith('Credential removed')
    expect(sent('/api/admin/coach')).toHaveLength(2)
    expect(host.textContent).toContain('Paste either a Claude Code setup token')
  })

  it('removes the credential of whichever provider is active, not a hard-coded one', async () => {
    mocks.routes['/api/admin/coach'] = status({ provider: 'openai' })
    await mount()
    await removeConfirmed()
    expect(sent('/api/admin/coach/disconnect')[0].body).toEqual({ provider: 'openai' })
  })

  it('a failed removal reports the server\'s reason and never claims the credential is gone', async () => {
    await mount()
    mocks.routes['/api/admin/coach/disconnect'] = new Error('data directory is read-only')
    await removeConfirmed()
    expect(mocks.toast).toHaveBeenCalledWith('data directory is read-only')
    expect(mocks.toast).not.toHaveBeenCalledWith('Credential removed')
    expect(sent('/api/admin/coach')).toHaveLength(1)
    // The card still shows the credential as connected, because it still is.
    expect(host.textContent).toContain('ops@example.com')
  })

  // Every other irreversible action in this app (Settings → Reset everything, Sign out
  // everywhere, Disconnect from your server, even removing one gym card) asks first. Until
  // 2026-09-22 this one did not: a single tap destroyed a credential the server never shows
  // again. It asks now, in red, and nothing is posted until the dialog is confirmed.
  it('asks before removing the credential, and posts only on confirm', async () => {
    await mount()
    const before = sent('/api/admin/coach/disconnect').length
    await tap(btn('Remove'))
    expect(sent('/api/admin/coach/disconnect')).toHaveLength(before)      // not yet
    expect(mocks.confirmSheet).toHaveBeenCalledTimes(1)
    const ask = mocks.confirmSheet.mock.calls[0][0]
    expect(ask.title).toBe('Remove this credential?')
    expect(ask.danger).toBe(true)
    expect(ask.confirmText).toBe('Remove')
    expect(ask.message).toContain('cannot be recovered')
    await act(async () => { await ask.onConfirm() })
    expect(sent('/api/admin/coach/disconnect')).toHaveLength(before + 1)
    expect(mocks.toast).toHaveBeenCalledWith('Credential removed')
  })
})

describe('AdminCoach — switching provider', () => {
  it('posts the chip\'s provider id and drops the previous test result with it', async () => {
    await mount()
    await tap(btn('Test the Coach'))
    expect(host.textContent).toContain('Passed')

    mocks.routes['/api/admin/coach'] = status({ provider: 'openai', model: 'gpt-4o' })
    await tap(chip('OpenAI-compatible'))
    expect(sent('/api/admin/coach/config').at(-1).body).toEqual({ provider: 'compatible' })
    // A "Passed" banner from the provider you just switched away from would be a lie.
    expect(host.querySelector('.adm-result')).toBeFalsy()
  })

  it('marks the providers that already hold a key, so switching is visibly not a reset', async () => {
    await mount()
    expect(chip('Claude').textContent).toContain('key saved')
    expect(chip('OpenAI').textContent).not.toContain('key saved')
  })
})

describe('AdminCoach — the connection test', () => {
  it('shows "Asking the provider…" while the round trip is in flight, then the result', async () => {
    let release
    mocks.routes['/api/admin/coach/test'] = () => new Promise(r => { release = () => r({ ok: true, version: 'claude-sonnet-4' }) })
    await mount()
    await act(async () => { btn('Test the Coach').click() })
    expect(host.textContent).toContain('Asking the provider…')
    await act(async () => { release(); await new Promise(r => setTimeout(r, 0)) })
    expect(host.textContent).toContain('Passed')
    expect(mocks.toast).toHaveBeenCalledWith('Coach test passed ✅')
  })

  it('a provider refusal keeps its own reason on screen, where the toast cannot outrun it', async () => {
    mocks.routes['/api/admin/coach/test'] = { ok: false, error: '401 invalid x-api-key' }
    await mount()
    await tap(btn('Test the Coach'))
    expect(mocks.toast).toHaveBeenCalledWith('Test failed')
    const result = host.querySelector('.adm-result')
    expect(result.className).toContain('bad')
    expect(result.textContent).toContain('401 invalid x-api-key')
  })

  it('a thrown request (proxy timeout, 502) is reported inline too, not swallowed', async () => {
    mocks.routes['/api/admin/coach/test'] = new Error('HTTP 502')
    await mount()
    await tap(btn('Test the Coach'))
    expect(host.querySelector('.adm-result').textContent).toContain('HTTP 502')
    expect(mocks.toast).toHaveBeenCalledWith('HTTP 502')
    // A throw must not leave the step claiming a pass.
    expect(host.querySelector('.adm-result').className).toContain('bad')
  })

  it('refuses to spend a round trip with no credential, and names the step to finish', async () => {
    mocks.routes['/api/admin/coach'] = status({ auth: { state: 'none' } })
    await mount()
    expect(btn('Test the Coach').disabled).toBe(true)
    expect(host.textContent).toContain('Finish the Credential step first.')
    await tap(btn('Test the Coach'))
    expect(sent('/api/admin/coach/test')).toHaveLength(0)
  })

  it('a compatible endpoint with no base URL blocks the test on the endpoint, not the credential', async () => {
    mocks.routes['/api/admin/coach'] = status({ provider: 'compatible', baseUrl: null, model: null, auth: { state: 'optional' } })
    await mount()
    expect(btn('Test the Coach').disabled).toBe(true)
    expect(host.textContent).toContain('Finish the Endpoint step first.')
    expect(host.textContent).not.toContain('Finish the Credential step first.')
  })
})

describe('AdminCoach — endpoint', () => {
  it('a changed base URL is written on blur; an unchanged one writes nothing', async () => {
    mocks.routes['/api/admin/coach'] = status({ provider: 'compatible', baseUrl: 'http://ollama:11434', model: null, auth: { state: 'optional' } })
    await mount()
    const field = [...host.querySelectorAll('input.field')][0]
    expect(field.value).toBe('http://ollama:11434')

    await blurWith(field, 'http://ollama:11434')
    expect(sent('/api/admin/coach/config')).toHaveLength(0)

    await blurWith(field, 'http://lan-gpu:8000')
    expect(sent('/api/admin/coach/config')).toEqual([
      { path: '/api/admin/coach/config', method: 'POST', body: { baseUrl: 'http://lan-gpu:8000' } }
    ])
  })

  it('a server-refused endpoint is reported and the card keeps showing the endpoint still in force', async () => {
    mocks.routes['/api/admin/coach'] = status({ provider: 'compatible', baseUrl: 'http://ollama:11434', model: null, auth: { state: 'optional' } })
    mocks.routes['/api/admin/coach/config'] = new Error('endpoint must not contain a path')
    await mount()
    await blurWith([...host.querySelectorAll('input.field')][0], 'http://ollama:11434/v1')
    expect(mocks.toast).toHaveBeenCalledWith('endpoint must not contain a path')
    expect(host.textContent).toContain('http://ollama:11434')
  })

  it('a provider with a fixed endpoint shows no Endpoint step at all', async () => {
    await mount()
    const steps = [...host.querySelectorAll('.adm-step-t b')].map(e => e.textContent)
    expect(steps).toEqual(['Provider', 'Credential', 'Model', 'Test'])
  })
})

describe('AdminCoach — model', () => {
  it('picking from the served list writes that model', async () => {
    mocks.routes['/api/admin/coach'] = status({ knownModels: ['claude-haiku-4', 'claude-sonnet-4'] })
    await mount()
    const select = host.querySelector('select.adm-select')
    await pick(select, 'claude-haiku-4')
    expect(sent('/api/admin/coach/config')).toEqual([
      { path: '/api/admin/coach/config', method: 'POST', body: { model: 'claude-haiku-4' } }
    ])
  })

  it('picking the blank "Default" row clears the model rather than writing an empty string as a name', async () => {
    mocks.routes['/api/admin/coach'] = status({ knownModels: ['claude-haiku-4', 'claude-sonnet-4'], models: { anthropic: 'claude-haiku-4' }, model: 'claude-haiku-4' })
    await mount()
    await pick(host.querySelector('select.adm-select'), '')
    expect(sent('/api/admin/coach/config')[0].body).toEqual({ model: '' })
  })

  // DEFECT (see the report): the <select> reads `d.model` for its value but guards it with
  // `models.includes(d.model)`, so a model that IS configured but is no longer served by the
  // endpoint falls back to '' — the select shows "Default (…)" while the step's own summary
  // line right above it shows the real, configured model. The option the code renders for
  // exactly this case ("… (not in the list)") can never appear as the selected one.
  //
  // This is the screen an operator is on while working out why jobs fail, and it tells them the
  // default is in use when it is not.
  it('a configured model the endpoint no longer serves is shown as chosen, not as the default', async () => {
    mocks.routes['/api/admin/coach'] = status({
      knownModels: ['claude-haiku-4', 'claude-sonnet-4'],
      models: { anthropic: 'claude-3-opus' },
      model: 'claude-3-opus',
    })
    await mount()
    const select = host.querySelector('select.adm-select')
    expect([...select.options].map(o => o.value)).toContain('claude-3-opus')
    expect(select.value).toBe('claude-3-opus')
    // …and the summary line and the control must not disagree with each other.
    const hint = [...host.querySelectorAll('.adm-step-t')].find(e => e.textContent.startsWith('Model'))
    expect(hint.textContent).toContain('claude-3-opus')
  })

  it('with no list loaded the field is free text, seeded from the per-provider model and not the effective default', async () => {
    mocks.routes['/api/admin/coach'] = status({ knownModels: null, models: {}, model: 'claude-sonnet-4' })
    await mount()
    const field = [...host.querySelectorAll('input.field')][0]
    // `model` is the provider's default here, not a chosen one — the box must stay empty so
    // blurring it does not write the default in as an explicit choice.
    expect(field.value).toBe('')
    await blurWith(field, 'claude-haiku-4')
    expect(sent('/api/admin/coach/config')[0].body).toEqual({ model: 'claude-haiku-4' })
  })

  it('"List models" replaces the free-text box with the provider\'s own list and counts it', async () => {
    mocks.routes['/api/admin/coach/models'] = { ok: true, models: ['m1', 'm2', 'm3'] }
    await mount()
    expect(host.querySelector('select.adm-select')).toBeFalsy()
    await tap(btn('List models'))
    expect(sent('/api/admin/coach/models')).toEqual([
      { path: '/api/admin/coach/models', method: 'POST', body: {} }
    ])
    expect(mocks.toast).toHaveBeenCalledWith('3 models')
    expect([...host.querySelector('select.adm-select').options].map(o => o.value)).toEqual(['', 'm1', 'm2', 'm3'])
  })

  it('a refused list keeps the free-text box and shows the provider\'s reason, never an empty dropdown', async () => {
    mocks.routes['/api/admin/coach/models'] = { ok: false, error: '401 invalid x-api-key', models: [] }
    await mount()
    await tap(btn('List models'))
    expect(mocks.toast).toHaveBeenCalledWith('401 invalid x-api-key')
    expect(host.querySelector('select.adm-select')).toBeFalsy()
  })

  it('a refused list with no reason still says something an operator can act on', async () => {
    mocks.routes['/api/admin/coach/models'] = { ok: false, models: [] }
    await mount()
    await tap(btn('List models'))
    expect(mocks.toast).toHaveBeenCalledWith('Could not list models')
  })

  it('a listing request that never lands leaves the button usable instead of stuck on "busy"', async () => {
    mocks.routes['/api/admin/coach/models'] = new Error('HTTP 504')
    await mount()
    await tap(btn('List models'))
    expect(mocks.toast).toHaveBeenCalledWith('HTTP 504')
    expect(btn('List models').disabled).toBe(false)
    expect(host.querySelector('select.adm-select')).toBeFalsy()
  })
})

describe('AdminCoach — daily caps (what bounds the spend on the operator\'s account)', () => {
  const capFields = () => [...host.querySelectorAll('input.num')]

  it('changing the per-user cap sends BOTH caps, so the other one is not dropped by the merge', async () => {
    await mount()
    await blurWith(capFields()[0], '12')
    expect(sent('/api/admin/coach/config')).toEqual([
      { path: '/api/admin/coach/config', method: 'POST', body: { caps: { perProfileDaily: 12, instanceDaily: 50 } } }
    ])
  })

  it('changing the instance cap likewise carries the per-user one through untouched', async () => {
    await mount()
    await blurWith(capFields()[1], '400')
    expect(sent('/api/admin/coach/config')[0].body).toEqual({ caps: { perProfileDaily: 5, instanceDaily: 400 } })
  })

  it('an unchanged cap writes nothing', async () => {
    await mount()
    await blurWith(capFields()[0], '5')
    expect(sent('/api/admin/coach/config')).toHaveLength(0)
  })

  // `0 means no limit` is what the card says one line above these boxes, and a number input
  // hands back "" for anything it cannot parse. Until 2026-09-22 emptying the box to retype and
  // clicking away wrote 0: the daily cap on the operator's API key, gone in one blur with no
  // confirmation and no toast. An empty box is no change now, the stored value comes back into
  // it, and removing the cap takes typing an explicit 0.
  it('emptying a cap box writes nothing and puts the stored value back', async () => {
    await mount()
    await blurWith(capFields()[0], '')
    expect(sent('/api/admin/coach/config')).toHaveLength(0)
    expect(capFields()[0].value).toBe('5')
    await blurWith(capFields()[1], '   ')
    expect(sent('/api/admin/coach/config')).toHaveLength(0)
    expect(capFields()[1].value).toBe('50')
  })

  it('an explicit 0 still removes the cap, because that is what the hint promises', async () => {
    await mount()
    await blurWith(capFields()[0], '0')
    expect(sent('/api/admin/coach/config')[0].body).toEqual({ caps: { perProfileDaily: 0, instanceDaily: 50 } })
  })

  it('the community-medians switch is a separate write and does not carry the caps with it', async () => {
    await mount()
    const switches = [...host.querySelectorAll('[role="switch"]')]
    expect(switches).toHaveLength(2)
    await tap(switches[1])
    expect(sent('/api/admin/coach/config')[0].body).toEqual({ community: true })
  })
})

describe('AdminCoach — Claude Code setup token sheet', () => {
  const openToken = async () => {
    mocks.routes['/api/admin/coach'] = status({ auth: { state: 'none' } })
    await mount()
    await tap(btn('Add Claude Code token'))
    return openLastSheet()
  }

  it('saves a trimmed token and account, closes, and makes the card re-read the status', async () => {
    const { close } = await openToken()
    const [token, account] = sheetFields()
    await blurWith(token, '  sk-ant-oat-secret  ')
    await blurWith(account, '  ops@example.com  ')
    await tap(sheetBtn('Save token'))
    expect(sent('/api/admin/coach/connect')).toEqual([{
      path: '/api/admin/coach/connect', method: 'POST',
      body: { type: 'cli-token', token: 'sk-ant-oat-secret', account: 'ops@example.com' }
    }])
    expect(close).toHaveBeenCalledTimes(1)
    expect(sent('/api/admin/coach')).toHaveLength(2)
  })

  it('will not post a whitespace-only token', async () => {
    await openToken()
    await blurWith(sheetFields()[0], '   ')
    expect(sheetBtn('Save token').disabled).toBe(true)
    await tap(sheetBtn('Save token'))
    expect(sent('/api/admin/coach/connect')).toHaveLength(0)
  })

  it('a refused token keeps the sheet open with the token still in the box, so it is not lost', async () => {
    mocks.routes['/api/admin/coach/connect'] = new Error('anthropic does not take a credential of type "cli-token"')
    const { close } = await openToken()
    await blurWith(sheetFields()[0], 'sk-ant-oat-secret')
    await tap(sheetBtn('Save token'))
    expect(mocks.toast).toHaveBeenCalledWith('anthropic does not take a credential of type "cli-token"')
    expect(close).not.toHaveBeenCalled()
    expect(sheetFields()[0].value).toBe('sk-ant-oat-secret')
    expect(sheetBtn('Save token').disabled).toBe(false)   // retryable
  })

  it('the token box is a password field — a pasted subscription token is not left on screen', async () => {
    await openToken()
    expect(sheetFields()[0].type).toBe('password')
  })

  it('a token the server only filed is reported as saved, not as connected', async () => {
    mocks.routes['/api/admin/coach/connect'] = { ok: true }
    await openToken()
    await blurWith(sheetFields()[0], 'sk-ant-oat-secret')
    await tap(sheetBtn('Save token'))
    expect(mocks.toast).toHaveBeenLastCalledWith('Token saved')
  })

  it('a token the server also verified is reported as connected', async () => {
    mocks.routes['/api/admin/coach/connect'] = { ok: true, test: { ok: true } }
    await openToken()
    await blurWith(sheetFields()[0], 'sk-ant-oat-secret')
    await tap(sheetBtn('Save token'))
    expect(mocks.toast).toHaveBeenLastCalledWith('Connected ✅')
  })

  // The sheet clears `busy` only by going away: the success path closes instead of resetting it.
  // Harmless in the app (close unmounts the sheet) and pinned here so a change to either half
  // of that pairing is noticed.
  it('clears the typed token on a successful save', async () => {
    await openToken()
    await blurWith(sheetFields()[0], 'sk-ant-oat-secret')
    await tap(sheetBtn('Save token'))
    expect(sheetFields()[0].value).toBe('')
  })
})

describe('AdminCoach — API key sheet', () => {
  const openKey = async (over = {}) => {
    mocks.routes['/api/admin/coach'] = status({ auth: { state: 'none' }, ...over })
    await mount()
    await tap(btn(over.provider === 'compatible' ? 'Add API key (optional)' : 'Add API key'))
    return openLastSheet()
  }

  it('saves the trimmed key as an apikey credential, closes and re-reads', async () => {
    const { close } = await openKey()
    await blurWith(sheetFields()[0], '  sk-ant-api03-xyz  ')
    await tap(sheetBtn('Save key'))
    expect(sent('/api/admin/coach/connect')).toEqual([
      { path: '/api/admin/coach/connect', method: 'POST', body: { type: 'apikey', token: 'sk-ant-api03-xyz' } }
    ])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('a key the server could verify says so; one it only filed says only that', async () => {
    mocks.routes['/api/admin/coach/connect'] = { ok: true, test: { ok: true } }
    await openKey()
    await blurWith(sheetFields()[0], 'sk-good')
    await tap(sheetBtn('Save key'))
    expect(mocks.toast).toHaveBeenLastCalledWith('Key saved ✅')
  })

  it('a refused key keeps the sheet open and the key in the box', async () => {
    mocks.routes['/api/admin/coach/connect'] = new Error('no token supplied')
    const { close } = await openKey()
    await blurWith(sheetFields()[0], 'sk-bad')
    await tap(sheetBtn('Save key'))
    expect(close).not.toHaveBeenCalled()
    expect(sheetFields()[0].value).toBe('sk-bad')
    expect(mocks.toast).toHaveBeenCalledWith('no token supplied')
  })

  it('an endpoint whose key is optional still refuses to post an empty one', async () => {
    await openKey({ provider: 'compatible', baseUrl: 'http://ollama:11434', model: null })
    expect(sheetBtn('Save key').disabled).toBe(true)
    await tap(sheetBtn('Save key'))
    expect(sent('/api/admin/coach/connect')).toHaveLength(0)
  })

  it('"Replace key" on a connected provider posts a plain replacement, with no disconnect first', async () => {
    await mount()
    await tap(btn('Replace key'))
    const { close } = await openLastSheet()
    await blurWith(sheetFields()[0], 'sk-new')
    await tap(sheetBtn('Save key'))
    expect(sent('/api/admin/coach/connect')[0].body).toEqual({ type: 'apikey', token: 'sk-new' })
    expect(sent('/api/admin/coach/disconnect')).toHaveLength(0)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('AdminCoach — what the card refuses to show', () => {
  it('a job log is rendered as counts and outcomes only — no payload, prompt or proposal field is read', async () => {
    mocks.routes['/api/admin/coach'] = status({
      jobsToday: 2,
      recent: [
        { at: '2026-09-21T09:00:00Z', kind: 'create', trigger: 'scheduled', outcome: 'ready', ms: 42000 },
        { at: '2026-09-21T08:00:00Z', kind: 'review', trigger: 'manual', outcome: 'failed', ms: 1000 },
      ],
      lastError: { at: '2026-09-21T08:00:00Z', errorClass: 'auth', detail: 'the provider rejected the credential' },
    })
    await mount()
    const log = host.querySelector('.adm-log')
    expect(log.textContent).toContain('Plan · scheduled')
    expect(log.textContent).toContain('Review')
    expect(log.textContent).toContain('42 s')
    expect(host.textContent).toContain('The provider rejected the credential')
  })

  it('caps the log at ten rows however many the server sends', async () => {
    mocks.routes['/api/admin/coach'] = status({
      recent: Array.from({ length: 20 }, (_, i) => ({ at: '2026-09-21T08:00:00Z', kind: 'create', outcome: 'ready', ms: 1000 + i })),
    })
    await mount()
    expect(host.querySelectorAll('.adm-log-row')).toHaveLength(10)
  })

  it('ages every timestamp it shows, and says "never" rather than a blank when there is none', async () => {
    const ago = ms => new Date(Date.now() - ms).toISOString()
    mocks.routes['/api/admin/coach'] = status({
      lastSuccess: { at: ago(30 * 1000) },
      auth: { state: 'connected', type: 'apikey', account: 'ops@example.com', connectedAt: ago(3 * 86400 * 1000) },
      recent: [
        { at: ago(5 * 60 * 1000), kind: 'create', outcome: 'ready', ms: 1000 },
        { at: ago(3 * 3600 * 1000), kind: 'review', outcome: 'failed', ms: 0 },
      ],
    })
    await mount()
    expect(host.textContent).toContain('just now')
    expect(host.textContent).toContain('added 3 d ago')
    const rows = [...host.querySelectorAll('.adm-log-row')].map(r => r.textContent)
    expect(rows[0]).toContain('5 min ago')
    expect(rows[1]).toContain('3 h ago')
    expect(rows[1]).not.toContain(' s')    // ms: 0 must not print "0 s"

    mocks.routes['/api/admin/coach'] = status({ lastSuccess: null })
    act(() => { root.render(<AdminCoach key="again" />) })
    await settle()
    expect(host.textContent).toContain('never')
  })

  it('names which KIND of credential is filed, not just that one is', async () => {
    mocks.routes['/api/admin/coach'] = status({
      provider: 'claude',
      auth: { state: 'connected', type: 'cli-token', account: 'boris', connectedAt: null },
    })
    await mount()
    expect(host.textContent).toContain('Connected as boris via Claude Code setup token')
  })

  it('says plainly when one personal account is already bound and everyone else is refused', async () => {
    mocks.routes['/api/admin/coach'] = status({
      provider: 'claude',
      boundUid: 'u1',
      auth: { state: 'connected', type: 'cli-token', account: 'boris', connectedAt: null },
    })
    await mount()
    expect(host.textContent).toContain('already in use by one profile')
    expect(host.textContent).toContain('nobody spends somebody else\'s subscription')
  })

  it('says when jobs do run as a separate unprivileged user', async () => {
    mocks.routes['/api/admin/coach'] = status({
      provider: 'claude',
      auth: { state: 'connected', type: 'cli-token', account: null, connectedAt: null },
      unprivileged: { ok: true, dropped: true, why: null },
    })
    await mount()
    expect(host.textContent).toContain('cannot read your data directory or secrets')
  })

  it('a failed test with no reason at all still says the provider did not answer', async () => {
    mocks.routes['/api/admin/coach/test'] = { ok: false }
    await mount()
    await tap(btn('Test the Coach'))
    expect(host.querySelector('.adm-result').textContent).toContain('No answer from the provider.')
  })

  it('an unknown failure class is still named rather than printed as "undefined"', async () => {
    mocks.routes['/api/admin/coach'] = status({ lastError: { at: '2026-09-21T08:00:00Z', errorClass: undefined } })
    await mount()
    expect(host.querySelector('.adm-result.bad').textContent).toContain('Failed')
    expect(host.textContent).not.toContain('undefined')
  })

  it('a blocked privilege drop is stated in red as "nothing runs", not folded into a hint', async () => {
    mocks.routes['/api/admin/coach'] = status({
      provider: 'claude',
      auth: { state: 'connected', type: 'cli-token', account: null, connectedAt: null },
      unprivileged: { ok: false, dropped: false, why: 'COACH_UID is not set' },
    })
    await mount()
    expect(host.textContent).toContain('Jobs are blocked: COACH_UID is not set')
    expect(host.textContent).toContain('Nothing runs until this is fixed.')
  })
})

describe('AdminCoach — readiness and the step count', () => {
  it('a reachable, credentialed, enabled provider reads ready', async () => {
    await mount()
    expect(host.querySelector('.adm-pill').textContent).toBe('ready')
    expect(host.textContent).toContain('On · Claude · claude-sonnet-4')
    expect(host.querySelector('.adm-progress')).toBeFalsy()
  })

  it('an unreachable runtime reads not ready and points at the Test step', async () => {
    mocks.routes['/api/admin/coach'] = status({ runtime: { ok: false, version: null, error: 'connect ECONNREFUSED', needsKey: false } })
    await mount()
    expect(host.querySelector('.adm-pill').textContent).toBe('not ready')
    expect(host.textContent).toContain('the provider can’t be reached')
    expect(host.textContent).toContain('connect ECONNREFUSED')
  })

  it('counts and numbers only the steps this provider actually shows', async () => {
    // compatible: provider + endpoint + credential + model + test = 5.
    mocks.routes['/api/admin/coach'] = status({ provider: 'compatible', baseUrl: null, model: null, auth: { state: 'optional' }, lastSuccess: null })
    await mount()
    expect([...host.querySelectorAll('.adm-step-t b')].map(e => e.textContent))
      .toEqual(['Provider', 'Endpoint', 'Credential', 'Model', 'Test'])
    expect(host.textContent).toContain('of 5 steps done')

    // fixture: nothing to point at and nothing to paste — provider + model + test.
    mocks.routes['/api/admin/coach'] = status({ provider: 'fixture', model: null, auth: { state: 'not-required' }, lastSuccess: null, runtime: { ok: true, version: 'fixture', error: null, needsKey: false } })
    act(() => { root.render(<AdminCoach key="second" />) })
    await settle()
    expect([...host.querySelectorAll('.adm-step-t b')].map(e => e.textContent)).toEqual(['Provider', 'Model', 'Test'])
    // The numbers renumber with them: no gap where the skipped steps were.
    expect([...host.querySelectorAll('.adm-num')].map(e => e.textContent)).toEqual(['', '2', '3'])
  })

  it('an undecryptable stored key gets its own state and its own fix, not "not connected"', async () => {
    mocks.routes['/api/admin/coach'] = status({ auth: { state: 'unreadable' } })
    await mount()
    expect(host.textContent).toContain("can't be decrypted")
    expect(host.textContent).toContain('secret')
    // …and the way out is offered, not just described.
    expect(btn('Add API key')).toBeTruthy()
  })
})
