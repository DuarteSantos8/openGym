// @vitest-environment happy-dom
/* api(path, { gzip: true }) sends the body gzipped with Content-Encoding: gzip, but only where the
   browser has CompressionStream; without it, or without the flag, the body goes plain as before. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { api } from './api.js'

const body = JSON.stringify({ state: { workouts: [{ id: 'w1' }] }, baseRev: 3 })
const sent = () => {
  const [, init] = fetch.mock.calls[0]
  return init
}
const ok = () => vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true,"rev":4}', { status: 200 })))

afterEach(() => { vi.unstubAllGlobals() })

describe('api() gzip', () => {
  it('gzips the body when asked and CompressionStream exists', async () => {
    ok()
    await api('/api/data', { method: 'PUT', body, gzip: true })
    const init = sent()
    expect(init.headers['Content-Encoding']).toBe('gzip')
    expect(init.gzip).toBeUndefined()
    const bytes = Buffer.from(await new Response(init.body).arrayBuffer())
    expect(gunzipSync(bytes).toString()).toBe(body)
  })

  it('sends it plain without CompressionStream (an older browser)', async () => {
    ok()
    vi.stubGlobal('CompressionStream', undefined)
    await api('/api/data', { method: 'PUT', body, gzip: true })
    expect(sent().body).toBe(body)
    expect(sent().headers['Content-Encoding']).toBeUndefined()
  })

  it('sends it plain without the flag (a server that never said it takes gzip)', async () => {
    ok()
    await api('/api/data', { method: 'PUT', body })
    expect(sent().body).toBe(body)
    expect(sent().headers['Content-Encoding']).toBeUndefined()
  })
})
