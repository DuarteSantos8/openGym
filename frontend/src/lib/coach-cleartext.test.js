// Plain http:// for the phone's own Coach endpoint (#913): allowed to an address on the home
// network, never to one on the internet, both when the endpoint is set up and on every request.
import { describe, it, expect, vi } from 'vitest'
import { isPrivateHost, phoneMayCall, validateBaseUrl } from '../../../api/coach/core/providers.js'

const calls = []
vi.mock('./capacitor-fetch.js', () => ({
  nativeFetch: async url => { calls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'llama' }] }) } }
}))
vi.mock('./mobile.js', () => ({ MOBILE: true, readJsonFile: async () => null, writeJsonFile: async () => {} }))
vi.mock('./coach-secrets.js', () => ({ getApiKey: async () => null, setApiKey: async () => {}, clearApiKey: async () => {} }))
const local = await import('./coach-local.js')

describe('the home network', () => {
  it.each([
    'http://192.168.1.20:8080', 'http://10.0.0.5:11434', 'http://172.16.4.2', 'http://172.31.255.255',
    'http://100.64.0.1', 'http://100.101.102.103:1234', 'http://127.0.0.1:8080', 'http://169.254.10.1',
    'http://localhost:1234', 'http://llama.local:8080', 'http://ollama:11434',
    'http://[fd7a:115c:a1e0::1]:8080', 'http://[fc00::2]', 'http://[fe80::1]', 'http://[::1]:8080',
    'http://[::ffff:192.168.1.2]',
  ])('%s may be plain http', url => {
    expect(validateBaseUrl(url).ok).toBe(true)
    expect(phoneMayCall(validateBaseUrl(url).value)).toBe(true)
  })

  it.each([
    'http://example.com', 'http://8.8.8.8', 'http://172.32.0.1', 'http://172.15.0.1', 'http://100.128.0.1',
    'http://192.169.1.1', 'http://[2001:db8::1]', 'http://ollama.example.com:11434', 'http://my.lan.example',
  ])('%s needs https', url => {
    expect(phoneMayCall(url)).toBe(false)
    expect(phoneMayCall(url.replace('http:', 'https:'))).toBe(true)
  })

  it('reads an IPv4 address in any spelling the URL parser accepts, and nothing that is no URL', () => {
    expect(phoneMayCall('http://0xC0A80101')).toBe(true)     // 192.168.1.1
    expect(phoneMayCall('http://3232235777')).toBe(true)      // 192.168.1.1 as one number
    expect(phoneMayCall('http://134744072')).toBe(false)      // 8.8.8.8
    expect(phoneMayCall('ftp://192.168.1.1')).toBe(false)
    expect(phoneMayCall('not a url')).toBe(false)
    expect(isPrivateHost('')).toBe(false)
    expect(isPrivateHost('192.168.1.300')).toBe(false)
  })
})

describe('every request from the phone', () => {
  it('goes out to the home network over http, and never to the internet', async () => {
    calls.length = 0
    const lan = await local.localModels({ provider: 'compatible', baseUrl: 'http://192.168.1.20:8080' }, null)
    expect(lan.ok).toBe(true)
    expect(calls).toEqual(['http://192.168.1.20:8080/v1/models'])
    const net = await local.localModels({ provider: 'compatible', baseUrl: 'http://llm.example.com' }, null)
    expect(net.ok).toBe(false)
    expect(net.error).toMatch(/home network/)
    expect(calls).toHaveLength(1)
  })
})
