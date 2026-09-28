// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiBlob, apiUpload, setRemoteAuth } from './api.js'

afterEach(() => setRemoteAuth('', null))

const stream = (chunks, { stall = false } = {}) => ({
  getReader() {
    let i = 0
    return { read: () => (i < chunks.length ? Promise.resolve({ done: false, value: chunks[i++] }) : stall ? new Promise(() => {}) : Promise.resolve({ done: true })) }
  }
})
const answer = (status, { length, body, json } = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: k => (k.toLowerCase() === 'content-length' && length != null ? String(length) : null) },
  body, json: async () => { if (json === undefined) throw new Error('not json'); return json }, blob: async () => new Blob([])
})

describe('apiBlob', () => {
  it('reads the body into a Blob, with the Bearer token of a paired phone', async () => {
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    const fetchImpl = vi.fn(async () => answer(200, { length: 6, body: stream([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]) }))
    const b = await apiBlob('/api/media/abc', { expectSize: 6, fetchImpl })
    expect(new Uint8Array(await b.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]))
    expect(fetchImpl.mock.calls[0][0]).toBe('https://gym.example.com/api/media/abc')
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer TOKEN' })
  })

  it('refuses an answer that announces more than the file can be, before reading it', async () => {
    const read = vi.fn()
    const fetchImpl = async () => answer(200, { length: 50 * 1024 * 1024, body: { getReader: () => ({ read }) } })
    await expect(apiBlob('/api/media/abc', { expectSize: 1000, fetchImpl })).rejects.toMatchObject({ code: 'too-large' })
    expect(read).not.toHaveBeenCalled()
  })

  it('cuts off an answer that turns out longer than announced', async () => {
    const fetchImpl = async () => answer(200, { body: stream([new Uint8Array(900), new Uint8Array(900)]) })
    await expect(apiBlob('/api/media/abc', { expectSize: 500, fetchImpl })).rejects.toMatchObject({ code: 'too-large' })
  })

  it('carries the server\'s code on a refusal, and counts a stall as a timeout', async () => {
    await expect(apiBlob('/api/media/abc', { fetchImpl: async () => answer(404, { json: { error: 'no such file', code: 'media-missing' } }) }))
      .rejects.toMatchObject({ status: 404, code: 'media-missing' })
    const stalled = async () => answer(200, { body: stream([new Uint8Array(3)], { stall: true }) })
    await expect(apiBlob('/api/media/abc', { idleMs: 20, fetchImpl: stalled })).rejects.toMatchObject({ code: 'timeout' })
  })
})

// XMLHttpRequest, as far as apiUpload uses it.
function fakeXHR(respond) {
  const made = []
  class X {
    constructor() { this.headers = {}; this.upload = {}; made.push(this) }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(k, v) { this.headers[k] = v }
    getResponseHeader(k) { return (this.resHeaders || {})[k] ?? null }
    abort() { this.onabort?.() }
    send(body) { this.body = body; setTimeout(() => respond(this), 0) }
  }
  return { X, made }
}
const reply = (status, text, headers = {}) => x => { x.status = status; x.responseText = text; x.resHeaders = headers; x.onload() }

describe('apiUpload', () => {
  it('PUTs the file with its recorded type and answers the server\'s JSON', async () => {
    setRemoteAuth('https://gym.example.com', 'TOKEN')
    const { X, made } = fakeXHR(reply(201, JSON.stringify({ ok: true, existed: false })))
    const blob = new Blob(['bytes'], { type: 'application/octet-stream' })
    await expect(apiUpload('/api/media/abc', blob, 'video/quicktime', { XHR: X })).resolves.toEqual({ ok: true, existed: false })
    expect(made[0]).toMatchObject({ method: 'PUT', url: 'https://gym.example.com/api/media/abc', body: blob })
    expect(made[0].headers).toEqual({ 'Content-Type': 'video/quicktime', Authorization: 'Bearer TOKEN' })
  })

  it('names a proxy\'s own 413 apart from the API\'s', async () => {
    await expect(apiUpload('/p', new Blob(['x']), 'image/png', { XHR: fakeXHR(reply(413, '<html>Request Entity Too Large</html>')).X }))
      .rejects.toMatchObject({ status: 413, code: 'proxy-too-large' })
    await expect(apiUpload('/p', new Blob(['x']), 'image/png', { XHR: fakeXHR(reply(413, JSON.stringify({ error: 'full', code: 'media-quota', usedMB: 1, quotaMB: 2 }))).X }))
      .rejects.toMatchObject({ status: 413, code: 'media-quota', data: { usedMB: 1, quotaMB: 2 } })
  })

  it('gives a 429 its retryAfter, from the body or the header', async () => {
    await expect(apiUpload('/p', new Blob(['x']), 'image/png', { XHR: fakeXHR(reply(429, JSON.stringify({ code: 'busy', retryAfter: 5 }))).X }))
      .rejects.toMatchObject({ status: 429, code: 'busy', retryAfter: 5 })
    await expect(apiUpload('/p', new Blob(['x']), 'image/png', { XHR: fakeXHR(reply(429, JSON.stringify({ code: 'locked' }), { 'Retry-After': '1800' })).X }))
      .rejects.toMatchObject({ code: 'locked', retryAfter: 1800 })
  })

  it('a network failure has no status, and a stall is a timeout', async () => {
    await expect(apiUpload('/p', new Blob(['x']), 'image/png', { XHR: fakeXHR(x => x.onerror()).X })).rejects.toMatchObject({ code: 'network' })
    const e = await apiUpload('/p', new Blob(['x']), 'image/png', { idleMs: 20, XHR: fakeXHR(() => {}).X }).catch(err => err)
    expect(e.code).toBe('timeout')
    expect(e.status).toBeUndefined()
  })
})
