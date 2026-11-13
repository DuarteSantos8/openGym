// Settings → About & updates → Network log (lib/net-log.js): what left the phone this session.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addressOf, logRequest, netLog, hostsOf, startNetLog, subscribeNetLog, _resetNetLog } from './net-log.js'

beforeEach(() => _resetNetLog())

describe('network log', () => {
  it('keeps the address only, never the query, and skips the app\'s own files', () => {
    expect(addressOf('https://api.github.com/repos/x?token=secret#frag', 'https://localhost')).toEqual({ origin: 'https://api.github.com', host: 'api.github.com', path: '/repos/x' })
    expect(addressOf('/api/me', 'https://localhost')).toBe(null)
    expect(addressOf('https://localhost/assets/a.js', 'https://localhost')).toBe(null)
    expect(addressOf('data:image/png;base64,xx', 'https://localhost')).toBe(null)
    expect(addressOf('blob:https://localhost/1', 'https://localhost')).toBe(null)
    expect(addressOf('wss://gym.example/ws', 'https://localhost')?.host).toBe('gym.example')
  })

  it('counts, groups by host and tells listeners', () => {
    const fn = vi.fn()
    subscribeNetLog(fn)
    expect(netLog().total).toBe(0)
    logRequest('https://gym.example/api/data', { method: 'put', at: 1 })
    logRequest('https://gym.example/api/me', { at: 3 })
    logRequest('https://tile.openstreetmap.org/1/2/3.png', { via: 'img', at: 2 })
    logRequest('/local')
    expect(fn).toHaveBeenCalledTimes(3)
    const l = netLog()
    expect(l.total).toBe(3)
    expect(l.entries[0]).toMatchObject({ method: 'PUT', host: 'gym.example', path: '/api/data', via: 'fetch' })
    expect(hostsOf(l.entries)).toEqual([{ host: 'gym.example', count: 2, last: 3 }, { host: 'tile.openstreetmap.org', count: 1, last: 2 }])
  })

  it('wraps fetch and XMLHttpRequest without getting in their way', async () => {
    const fetch = vi.fn(async () => 'ok')
    class XHR { open () { return 'opened' } }
    const win = { fetch, XMLHttpRequest: XHR, navigator: {} }
    startNetLog(win)
    expect(await win.fetch('https://example.org/x?y=1', { method: 'POST' })).toBe('ok')
    expect(fetch).toHaveBeenCalledWith('https://example.org/x?y=1', { method: 'POST' })
    expect(new win.XMLHttpRequest().open('GET', 'https://example.net/a')).toBe('opened')
    expect(netLog().entries.map(e => [e.method, e.host, e.via])).toEqual([['POST', 'example.org', 'fetch'], ['GET', 'example.net', 'xhr']])
    expect(netLog().since).toBeGreaterThan(0)
  })
})
