// @vitest-environment happy-dom
// The per-provider "may the Coach send your training there?" answer: what counts as a third
// party, how a disclosure becomes something to ask about, and that the answer is kept per
// provider and host, on the phone in a file as well, and can be taken back.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ MOBILE: false, files: {} }))
vi.mock('./mobile.js', () => ({
  get MOBILE() { return mocks.MOBILE },
  readJsonFile: async name => (name in mocks.files ? JSON.parse(mocks.files[name]) : null),
  writeJsonFile: async (name, data) => { mocks.files[name] = JSON.stringify(data) },
}))

const { isLocalHost, consentTarget, hasAiConsent, allowAi, withdrawAi, aiConsents, onAiConsentChange, _resetAiConsent } = await import('./coach-consent.js')

beforeEach(() => {
  mocks.MOBILE = false
  mocks.files = {}
  localStorage.clear()
  _resetAiConsent()
})

describe('what is not a third party', () => {
  it.each([
    'localhost:11434', '127.0.0.1', '[::1]:8080', '10.0.0.5', '192.168.1.20:11434', '172.20.0.3',
    '100.101.102.103', 'ollama', 'ollama:11434', 'gpu-box.local', 'nas.lan', 'llm.home.arpa', 'box.tail1234.ts.net', 'fd12::1',
  ])('%s is the user\'s own machine or network', host => expect(isLocalHost(host)).toBe(true))

  it.each([
    'api.openai.com', 'api.anthropic.com', 'generativelanguage.googleapis.com', 'openrouter.ai',
    '8.8.8.8', '172.32.0.1', '192.169.1.1', 'ollama.example.com', '', null,
  ])('%s is somebody else\'s', host => expect(isLocalHost(host)).toBe(false))
})

describe('a disclosure, as something to ask about', () => {
  it('names the company a person knows, not the API product', () => {
    expect(consentTarget({ provider: 'openai', host: 'api.openai.com' }, 'device').name).toBe('OpenAI')
    expect(consentTarget({ provider: 'anthropic', host: 'api.anthropic.com' }, 'device').name).toBe('Anthropic')
    expect(consentTarget({ provider: 'gemini', host: 'generativelanguage.googleapis.com' }, 'server').name).toBe('Google Gemini')
    // The server's runtime providers have no base URL, and go to the same companies.
    expect(consentTarget({ provider: 'claude', host: null, providerLabel: 'Claude (Anthropic)' }, 'server').name).toBe('Anthropic')
  })

  it('names a compatible endpoint by its host, and keys on provider and host', () => {
    const a = consentTarget({ provider: 'compatible', host: 'OpenRouter.ai', providerLabel: 'OpenAI-compatible endpoint' }, 'device')
    expect(a).toMatchObject({ name: 'openrouter.ai', local: false, via: 'device' })
    const b = consentTarget({ provider: 'compatible', host: 'llm.example.org' }, 'device')
    expect(a.key).not.toBe(b.key)
    expect(consentTarget({ provider: 'compatible', host: 'llm.example.org' }, 'server').key).not.toBe(b.key)
  })

  it('marks a model on the LAN as local, and has nothing to ask for the demo or the test fixture', () => {
    expect(consentTarget({ provider: 'compatible', host: '192.168.1.20:11434' }, 'server').local).toBe(true)
    expect(consentTarget({ provider: 'demo' }, 'server')).toBeNull()
    expect(consentTarget({ provider: 'fixture' }, 'server')).toBeNull()
    expect(consentTarget(null, 'server')).toBeNull()
  })
})

describe('the remembered answer', () => {
  const openai = consentTarget({ provider: 'openai', host: 'api.openai.com' }, 'device')
  const gemini = consentTarget({ provider: 'gemini', host: 'generativelanguage.googleapis.com' }, 'device')

  it('is kept per provider: a yes to one is not a yes to another', async () => {
    expect(await hasAiConsent(openai)).toBe(false)
    await allowAi(openai)
    expect(await hasAiConsent(openai)).toBe(true)
    expect(await hasAiConsent(gemini)).toBe(false)
    const [row] = await aiConsents()
    expect(row).toMatchObject({ key: openai.key, name: 'OpenAI', via: 'device', provider: 'openai', host: 'api.openai.com' })
    expect(Date.parse(row.at)).not.toBeNaN()
  })

  it('survives a restart: from localStorage on the web', async () => {
    await allowAi(openai)
    _resetAiConsent()
    expect(await hasAiConsent(openai)).toBe(true)
  })

  it('survives a restart on the phone even when the WebView lost its storage', async () => {
    mocks.MOBILE = true
    await allowAi(openai)
    localStorage.clear()
    _resetAiConsent()
    expect(await hasAiConsent(openai)).toBe(true)
  })

  it('can be withdrawn, and then it is asked for again', async () => {
    const seen = vi.fn()
    onAiConsentChange(seen)
    await allowAi(openai); await allowAi(gemini)
    await withdrawAi(openai.key)
    expect(await hasAiConsent(openai)).toBe(false)
    expect(await hasAiConsent(gemini)).toBe(true)
    expect((await aiConsents()).map(c => c.key)).toEqual([gemini.key])
    expect(seen).toHaveBeenCalledTimes(3)
  })
})
