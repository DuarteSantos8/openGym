// @vitest-environment happy-dom
/* The sync push can go up gzipped (#1489, the idea of PR #1490): api(path, { gzip: true }) sends
   the body gzipped with Content-Encoding: gzip where CompressionStream exists, and plain where it
   does not or when nobody asked (a server that never said it takes gzip). The `gzip` flag itself
   never reaches fetch. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { api } from './api.js'

const body = JSON.stringify({ state: { workouts: [{ id: 'w1', note: 'x'.repeat(2000) }] }, baseRev: 3 })
const sent = () => fetch.mock.calls[0][1]
const ok = () => vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true,"rev":4}', { status: 200 })))

afterEach(() => { vi.unstubAllGlobals() })

describe('api() gzip', () => {
  it('gzips the body when asked and CompressionStream exists', async () => {
    ok()
    await api('/api/data', { method: 'PUT', body, gzip: true })
    const init = sent()
    expect(init.headers['Content-Encoding']).toBe('gzip')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect('gzip' in init).toBe(false)
    const bytes = Buffer.from(init.body)
    expect(bytes.length).toBeLessThan(body.length / 4)
    expect(gunzipSync(bytes).toString()).toBe(body)
  })

  it('sends it plain where there is no CompressionStream (an older WebView)', async () => {
    ok()
    vi.stubGlobal('CompressionStream', undefined)
    await api('/api/data', { method: 'PUT', body, gzip: true })
    expect(sent().body).toBe(body)
    expect(sent().headers['Content-Encoding']).toBeUndefined()
  })

  it('sends it plain without the flag', async () => {
    ok()
    await api('/api/data', { method: 'PUT', body })
    expect(sent().body).toBe(body)
    expect(sent().headers['Content-Encoding']).toBeUndefined()
    expect('gzip' in sent()).toBe(false)
  })
})
