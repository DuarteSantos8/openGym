// @vitest-environment happy-dom
// The mobile build's "how should the Coach run?" screen. CoachSetup.test.jsx already pins the
// promise about what this file may import; this one drives what it does.
//
// Two answers, and everything hard about them lives in the refusals: a server with no Coach on
// it, a phone with no key, a base URL that is not one, an endpoint that does not answer, and
// the two failures on "Save" that issue #42 was about — the settings write and the secure-store
// write, which the screen deliberately does in that order.
//
// coach-local.js is mocked here only so the DYNAMIC import inside prepare()/turnOff() resolves
// without a network stack. providers.js, categories.js and coach.js are the real ones, so the
// provider table, the validator and the category copy are exactly what ships.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CoachSetup from './CoachSetup.jsx'
import { getApiKey, setApiKey, clearApiKey } from '../lib/coach-secrets.js'
import { localModels, localForget } from '../lib/coach-local.js'
import { CATEGORY_TEXT } from '../lib/coach.js'
import { HTTP_PROVIDERS } from '../../../api/coach/core/providers.js'
import { DATA_CATEGORIES } from '../../../api/coach/core/categories.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = {
    mobile: true, user: null, config: null, coachLocal: null,
    nav: vi.fn(), toast: vi.fn(), openSheet: vi.fn(), setCoachLocal: vi.fn(), refreshConfig: vi.fn(),
  }
  state.snapshot = () => ({
    user: state.user, config: state.config, coachLocal: state.coachLocal,
    setCoachLocal: (...a) => state.setCoachLocal(...a),
    refreshConfig: (...a) => state.refreshConfig(...a),
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: (...a) => mocks.toast(...a), openSheet: (...a) => mocks.openSheet(...a) })
  const useUI = selector => selector ? selector(snap()) : snap()
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
// A getter, so one test can be the web build and the rest the phone.
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.mobile } }))
vi.mock('../lib/coach-secrets.js', () => ({
  getApiKey: vi.fn(() => Promise.resolve(null)),
  setApiKey: vi.fn(() => Promise.resolve()),
  clearApiKey: vi.fn(() => Promise.resolve()),
}))
vi.mock('../lib/coach-local.js', () => ({
  localModels: vi.fn(() => Promise.resolve({ ok: true, models: [] })),
  localForget: vi.fn(() => Promise.resolve({ ok: true })),
}))
vi.mock('./MobileOnboarding.jsx', () => ({ ConnectSheet: () => <div className="connect-sheet" /> }))

let host, root
beforeEach(() => {
  mocks.mobile = true
  mocks.user = { uid: 'u1', name: 'Ana' }
  mocks.config = { coach: { enabled: true } }
  mocks.coachLocal = null
  mocks.nav.mockReset(); mocks.toast.mockReset(); mocks.openSheet.mockReset()
  mocks.setCoachLocal.mockReset().mockResolvedValue(undefined)
  mocks.refreshConfig.mockReset()
  vi.mocked(getApiKey).mockReset().mockResolvedValue(null)
  vi.mocked(setApiKey).mockReset().mockResolvedValue(undefined)
  vi.mocked(clearApiKey).mockReset().mockResolvedValue(undefined)
  vi.mocked(localModels).mockReset().mockResolvedValue({ ok: true, models: [] })
  vi.mocked(localForget).mockReset().mockResolvedValue({ ok: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = async () => { await act(async () => { root.render(<CoachSetup />) }) }
const settle = async () => { await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }) }

const all = sel => [...host.querySelectorAll(sel)]
const rowTitled = title => all('.lrow').find(r => r.querySelector('.lrow-t')?.textContent === title)
const btn = text => all('.btn').find(b => b.textContent.trim() === text)
const chip = label => all('.chip').find(b => b.textContent.trim() === label)
const field = type => all('input').find(i => (i.getAttribute('type') || 'text') === type)
const click = el => { expect(el).toBeTruthy(); return act(() => el.click()) }
const typeIn = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const pickModel = value => act(() => {
  const el = host.querySelector('select')
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
const openByok = async () => { await click(rowTitled('Bring my own API key')) }

describe('CoachSetup — where it runs at all', () => {
  it('is a phone screen: the web build is sent straight back to Settings', async () => {
    mocks.mobile = false
    await mount()
    expect(mocks.nav).toHaveBeenCalledWith('/settings', { replace: true })
  })

  it('re-asks the paired server what it can do, because the admin may have switched it on', async () => {
    await mount()
    expect(mocks.refreshConfig).toHaveBeenCalledTimes(1)
  })

  it('asks nothing of a server it is not signed in to', async () => {
    mocks.user = null; mocks.config = null
    await mount()
    expect(mocks.refreshConfig).not.toHaveBeenCalled()
  })
})

describe('CoachSetup — "use my self-hosted openGym"', () => {
  it('hands the Coach to the server and leaves for the conversation', async () => {
    await mount()
    await click(rowTitled('Use my self-hosted openGym'))
    await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith({ mode: 'server' })
    expect(mocks.toast).toHaveBeenCalledWith('The Coach is on')
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  it('an unpaired phone is asked to connect first, and nothing is written', async () => {
    mocks.user = null; mocks.config = null
    await mount()
    expect(rowTitled('Use my self-hosted openGym').textContent).toContain('Connect to my server')
    await click(rowTitled('Use my self-hosted openGym'))
    expect(mocks.openSheet).toHaveBeenCalledTimes(1)
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('a paired server with no Coach on it refuses, explains, and writes nothing', async () => {
    mocks.config = { coach: { enabled: false } }
    await mount()
    const row = rowTitled('Use my self-hosted openGym')
    expect(row.textContent).toContain('Your server has no Coach enabled')
    await click(row)
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(host.querySelector('.card').textContent).toContain('ask its admin, or bring your own key below')
  })

  it('says it is still asking while the server has not answered yet', async () => {
    mocks.config = null
    await mount()
    expect(rowTitled('Use my self-hosted openGym').textContent).toContain('Loading…')
  })

  it('Back returns to Settings', async () => {
    await mount()
    await click(host.querySelector('.hdr .iconbtn'))
    expect(mocks.nav).toHaveBeenCalledWith('/settings')
  })
})

describe('CoachSetup — bringing your own key', () => {
  it('offers exactly the providers the shared table lists, Anthropic first', async () => {
    await mount(); await openByok()
    expect(all('.chip').map(c => c.textContent)).toEqual(Object.values(HTTP_PROVIDERS).map(p => p.label))
    expect(chip('Anthropic API').classList.contains('on')).toBe(true)
  })

  it('names every category the payload is built from, in that order, and where it would go', async () => {
    await mount(); await openByok()
    const section = all('.sect').find(s => s.querySelector('.sect-t')?.textContent === 'What leaves this phone')
    expect([...section.querySelectorAll('.lrow-t')].map(t => t.textContent))
      .toEqual(DATA_CATEGORIES.map(k => CATEGORY_TEXT[k][0]))
    expect(host.textContent).toContain('Each request goes straight to api.anthropic.com with your key')
  })

  it('shows an endpoint field only for the OpenAI-compatible provider', async () => {
    await mount(); await openByok()
    expect(host.textContent).not.toContain('Endpoint')
    await click(chip('OpenAI-compatible endpoint'))
    expect(host.textContent).toContain('Endpoint')
    expect(field('text').getAttribute('placeholder')).toBe('http://ollama.lan:11434')
    // With nothing typed there is no host to name, so the line falls back to the provider.
    expect(host.textContent).toContain('Each request goes straight to OpenAI-compatible endpoint with your key')
    typeIn(field('text'), 'http://ollama.lan:11434')
    expect(host.textContent).toContain('Each request goes straight to ollama.lan:11434 with your key')
  })

  it('refuses to reach out with no key, and never loads the pipeline to find out', async () => {
    await mount(); await openByok()
    await click(btn('List models')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Enter your API key')
    expect(localModels).not.toHaveBeenCalled()
    expect(host.querySelector('.card')).toBe(null)          // no progress steps started
  })

  it('a key already in the phone’s store counts — the field says so and stays optional', async () => {
    vi.mocked(getApiKey).mockResolvedValue('sk-saved')
    await mount(); await settle(); await openByok()
    expect(field('password').getAttribute('placeholder')).toContain('(saved)')
    await click(btn('List models')); await settle()
    expect(localModels).toHaveBeenCalledWith({ provider: 'anthropic', baseUrl: null }, 'sk-saved')
  })

  it('a typed key wins over the saved one and is never read back out of storage', async () => {
    vi.mocked(getApiKey).mockResolvedValue('sk-saved')
    await mount(); await settle(); await openByok()
    typeIn(field('password'), '  sk-typed  ')
    await click(btn('List models')); await settle()
    expect(localModels).toHaveBeenCalledWith({ provider: 'anthropic', baseUrl: null }, 'sk-typed')
  })

  it('the OpenAI-compatible endpoint needs no key at all', async () => {
    await mount(); await openByok()
    await click(chip('OpenAI-compatible endpoint'))
    typeIn(field('text'), 'http://ollama.lan:11434/')
    await click(btn('List models')); await settle()
    expect(mocks.toast).not.toHaveBeenCalled()
    expect(localModels).toHaveBeenCalledWith({ provider: 'compatible', baseUrl: 'http://ollama.lan:11434' }, null)
  })

  it('turns down a base URL that is not one, before anything is loaded', async () => {
    await mount(); await openByok()
    await click(chip('OpenAI-compatible endpoint'))
    const cases = [
      ['ollama.lan', 'not a valid URL'],
      // host:port with no scheme parses as a scheme of its own ("ollama.lan:"), so it lands on
      // the protocol message rather than the parse one — worth knowing, the placeholder is a URL.
      ['ollama.lan:11434', 'only http:// and https:// endpoints are supported'],
      ['ftp://ollama.lan', 'only http:// and https:// endpoints are supported'],
      ['http://me:pw@ollama.lan', 'put the key in the credential field, not in the URL'],
      ['http://ollama.lan?k=1', 'a base URL has no query string'],
    ]
    for (const [url, error] of cases) {
      mocks.toast.mockClear()
      typeIn(field('text'), url)
      await click(btn('List models')); await settle()
      expect(mocks.toast, url).toHaveBeenCalledWith(error)
    }
    expect(localModels).not.toHaveBeenCalled()
  })

  it('an empty compatible endpoint is refused before anything is loaded', async () => {
    // validateBaseUrl('') is {ok:true,value:null} on purpose: for a provider with a fixed
    // endpoint, empty means the default. `compatible` has none, so the screen refuses it here
    // rather than sending "List models" out with nowhere to go and failing at the adapter.
    await mount(); await openByok()
    await click(chip('OpenAI-compatible endpoint'))
    await click(btn('List models')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Enter the endpoint URL')
    expect(localModels).not.toHaveBeenCalled()
    expect(host.querySelector('.card')).toBe(null)          // no progress steps started
  })
})

describe('CoachSetup — listing the models', () => {
  const withKey = async () => {
    await mount(); await openByok()
    typeIn(field('password'), 'sk-1')
  }

  it('walks the three steps, lists what the endpoint serves and pre-picks the default', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['claude-opus-5', 'claude-haiku-4'] })
    await withKey()
    await click(btn('List models')); await settle()

    expect(all('.card .small').map(s => s.textContent))
      .toEqual(['Loading the exercise catalogue…', 'Checking the endpoint…', 'Ready'])
    const select = host.querySelector('select')
    expect([...select.options].map(o => o.value)).toEqual(['', 'claude-opus-5', 'claude-haiku-4'])
    expect(select.value).toBe('claude-opus-5')
    expect(btn('Save and use the Coach')).toBeTruthy()
    expect(btn('List models')).toBeTruthy()                 // still there, to re-list
  })

  it('leaves the model unchosen when the endpoint does not serve the default', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['qwen3-27b'] })
    await withKey()
    await click(btn('List models')); await settle()
    expect(host.querySelector('select').value).toBe('')
    expect(host.querySelector('select option').textContent).toBe('(claude-opus-5)')
  })

  it('an endpoint that will not answer clears the progress and says why', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: false, error: 'connection refused' })
    await withKey()
    await click(btn('List models')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Could not reach the provider: connection refused')
    expect(host.querySelector('.card')).toBe(null)
    expect(host.querySelector('select')).toBe(null)
    expect(btn('List models').disabled).toBe(false)          // and you can try again
  })

  it('a thrown failure is reported in its own words', async () => {
    vi.mocked(localModels).mockRejectedValue(new Error('secure storage timed out'))
    await withKey()
    await click(btn('List models')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('secure storage timed out')
    expect(host.querySelector('.card')).toBe(null)
  })

  it('a thrown failure with nothing to say still says something', async () => {
    vi.mocked(localModels).mockRejectedValue(new Error())
    await withKey()
    await click(btn('List models')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Could not connect')
  })

  it('switching provider throws the list away — a model name is not portable', async () => {
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['claude-opus-5'] })
    await withKey()
    await click(btn('List models')); await settle()
    expect(host.querySelector('select')).toBeTruthy()

    await click(chip('Google Gemini'))
    expect(host.querySelector('select')).toBe(null)
    expect(btn('Save and use the Coach')).toBeUndefined()

    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['gemini-2.5-pro'] })
    await click(btn('List models')); await settle()
    expect(localModels).toHaveBeenLastCalledWith({ provider: 'gemini', baseUrl: null }, 'sk-1')
    expect(host.querySelector('select').value).toBe('gemini-2.5-pro')
  })
})

describe('CoachSetup — saving', () => {
  const listed = async (provider, models, { key = 'sk-1', baseUrl } = {}) => {
    await mount(); await openByok()
    if (provider) await click(chip(HTTP_PROVIDERS[provider].label))
    if (baseUrl != null) typeIn(field('text'), baseUrl)
    if (key) typeIn(field('password'), key)
    vi.mocked(localModels).mockResolvedValue({ ok: true, models })
    await click(btn('List models')); await settle()
  }

  it('writes the mode, the provider and the chosen model, then stores the key and leaves', async () => {
    await listed(null, ['claude-opus-5'])
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith({ mode: 'byok', provider: 'anthropic', model: 'claude-opus-5', baseUrl: null })
    expect(setApiKey).toHaveBeenCalledWith('sk-1')
    expect(mocks.toast).toHaveBeenCalledWith('The Coach is on')
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  it('normalises the endpoint it saves for a compatible provider, and saves the model you pick', async () => {
    await listed('compatible', ['qwen3-27b', 'llama-3.3'], { key: null, baseUrl: 'http://ollama.lan:11434//' })
    pickModel('llama-3.3')
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith({
      mode: 'byok', provider: 'compatible', model: 'llama-3.3', baseUrl: 'http://ollama.lan:11434'
    })
    expect(setApiKey).not.toHaveBeenCalled()
  })

  it('does not touch the secure store when the key field was left alone', async () => {
    vi.mocked(getApiKey).mockResolvedValue('sk-saved')
    await mount(); await settle(); await openByok()
    vi.mocked(localModels).mockResolvedValue({ ok: true, models: ['claude-opus-5'] })
    await click(btn('List models')); await settle()
    await click(btn('Save and use the Coach')); await settle()
    expect(setApiKey).not.toHaveBeenCalled()
    expect(mocks.nav).toHaveBeenCalledWith('/coach')
  })

  it('refuses to save a provider with no model picked and no default to fall back on', async () => {
    await listed('compatible', [], { key: null, baseUrl: 'http://ollama.lan:11434' })
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Pick a model')
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  // DEFECT (fixed in CoachSetup.jsx, see the report): "List models" validates the endpoint and
  // "Save" did not. Editing the field after a successful listing — the one order in which the
  // two disagree — saved `baseUrl: null`, said "The Coach is on" and left for the conversation
  // with the phone pointed at nothing.
  it('refuses on Save the same endpoint it refused on List models', async () => {
    await listed('compatible', ['qwen3-27b'], { key: null, baseUrl: 'http://ollama.lan:11434' })
    pickModel('qwen3-27b')
    typeIn(field('text'), 'ollama.lan')
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('not a valid URL')
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  it('refuses on Save an endpoint field cleared after a successful listing', async () => {
    // The same hole as above in the one shape the validator lets through: empty. Cleared after
    // listing, Save would have written `baseUrl: null` and pointed the phone at nothing.
    await listed('compatible', ['qwen3-27b'], { key: null, baseUrl: 'http://ollama.lan:11434' })
    pickModel('qwen3-27b')
    typeIn(field('text'), '')
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('Enter the endpoint URL')
    expect(mocks.setCoachLocal).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
  })

  // Issue #42: both of these used to leave the button greyed out for ever with no explanation.
  it('a settings write that fails says so, keeps you here and never stores the key', async () => {
    await listed(null, ['claude-opus-5'])
    mocks.setCoachLocal.mockRejectedValueOnce(new Error('could not write the settings file'))
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.toast).toHaveBeenCalledWith('could not write the settings file')
    expect(setApiKey).not.toHaveBeenCalled()
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(btn('Save and use the Coach').disabled).toBe(false)
  })

  it('a secure-store write that fails says so — but the mode is already on, by design', async () => {
    await listed(null, ['claude-opus-5'])
    vi.mocked(setApiKey).mockRejectedValueOnce(new Error('secure storage timed out'))
    await click(btn('Save and use the Coach')); await settle()
    expect(mocks.setCoachLocal).toHaveBeenCalledWith(expect.objectContaining({ mode: 'byok' }))
    expect(mocks.toast).toHaveBeenCalledWith('secure storage timed out')
    expect(mocks.nav).not.toHaveBeenCalled()
    expect(btn('Save and use the Coach').disabled).toBe(false)
  })
})

describe('CoachSetup — turning it off', () => {
  it('offers the control only once the Coach is actually on', async () => {
    await mount()
    expect(rowTitled('Turn the Coach off on this phone')).toBeUndefined()
    expect(host.textContent).toContain('Off — choose how the Coach should run.')
  })

  it('says which way it is running now', async () => {
    mocks.coachLocal = { mode: 'server' }
    await mount()
    expect(host.textContent).toContain('Runs on your openGym server')
    expect(rowTitled('Turn the Coach off on this phone')).toBeTruthy()
  })

  it('forgets the key, the mode and everything the pipeline was holding', async () => {
    mocks.coachLocal = { mode: 'byok', provider: 'openai', model: 'gpt-5.6' }
    await mount()
    expect(host.textContent).toContain('Runs on this phone with your own API key')

    await click(rowTitled('Turn the Coach off on this phone')); await settle()
    expect(clearApiKey).toHaveBeenCalledTimes(1)
    expect(mocks.setCoachLocal).toHaveBeenCalledWith({ mode: 'off' })
    expect(localForget).toHaveBeenCalledTimes(1)
    expect(mocks.toast).toHaveBeenCalledWith('The Coach is off')
    expect(mocks.nav).not.toHaveBeenCalled()                          // you stay on the screen
  })

  it('starts the key picker on the provider the phone was already using', async () => {
    mocks.coachLocal = { mode: 'byok', provider: 'openai', model: 'gpt-5.6' }
    await mount(); await openByok()
    expect(chip('OpenAI API').classList.contains('on')).toBe(true)
    expect(field('password').getAttribute('placeholder')).toBe('sk-…')
  })
})
