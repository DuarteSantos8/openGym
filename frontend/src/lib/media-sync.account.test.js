// @vitest-environment happy-dom
// GHSA-699c-6p5r-q574: a media sync started under account A and still going after this browser
// signed in as B (another tab) used to send A's files in B's session, and a late download could
// put A's file back after the sign-out cleared it. Network and storage are simulated here.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMediaSync } from './media-sync.js'
import { createMediaStore, memoryBackend } from './media-store.js'
import { sha256Hex } from './sha256.js'
import { _resetMediaOwed } from './media-owed.js'
import { jpeg } from './media-samples.test-util.js'

const hex = c => c.repeat(64)
const refOf = hash => ({ kind: 'image', hash, mime: 'image/webp', size: 10, width: 8, height: 6, at: 1 })
const deferred = () => { let resolve; const p = new Promise(r => { resolve = r }); return { p, resolve } }
const tick = () => new Promise(r => setTimeout(r, 0))

function appStore(init) {
  let st = { ready: true, user: { id: 'A' }, config: { media: { imageMB: 2, gifMB: 8, videoMB: 40, videoSec: 60, quotaMB: 200 } }, sync: { lastSynced: 0 }, S: { customEx: [] }, stashedMediaHashes: async () => new Set(), ...init }
  return { getState: () => st, setState: patch => { st = { ...st, ...patch } }, subscribe: () => () => {} }
}

let media, api, apiUpload, apiBlob
const make = (store, over = {}) => createMediaSync({ store, media, api, apiUpload, apiBlob, toast: vi.fn(), allowed: () => true, now: () => Date.now(), locks: null, storage: null, ...over })
const put = hash => media.put(hash, new Blob([new Uint8Array(10)]), { mime: 'image/webp', pending: true })
const twoFiles = () => ({ customEx: [{ id: 'a', media: refOf(hex('a')) }, { id: 'b', media: refOf(hex('b')) }] })

beforeEach(() => {
  _resetMediaOwed()
  media = createMediaStore(memoryBackend())
  api = vi.fn(async (path, { body }) => ({ missing: JSON.parse(body).hashes }))
  apiUpload = vi.fn(async () => ({ ok: true, existed: false }))
  apiBlob = vi.fn()
})

describe('a media sync bound to its account', () => {
  it('names the account on every request', async () => {
    await put(hex('a')); await put(hex('b'))
    await make(appStore({ S: twoFiles() })).syncMedia()
    expect(api.mock.calls[0][1].headers).toEqual({ 'X-OpenGym-Account': 'A' })
    expect(apiUpload.mock.calls.map(c => c[3])).toEqual([{ headers: { 'X-OpenGym-Account': 'A' } }, { headers: { 'X-OpenGym-Account': 'A' } }])
  })

  it('sends nothing once another account signed in while it asked what is missing', async () => {
    await put(hex('a')); await put(hex('b'))
    const store = appStore({ S: twoFiles() })
    const answer = deferred()
    api.mockImplementationOnce(() => answer.p)
    const run = make(store).syncMedia()
    await tick()
    store.setState({ user: { id: 'B' } })
    answer.resolve({ missing: [hex('a'), hex('b')] })
    await run
    expect(apiUpload).not.toHaveBeenCalled()
    expect([...media.pendingNow()].sort()).toEqual([hex('a'), hex('b')])
  })

  it('stops between uploads when the account changes during one', async () => {
    await put(hex('a')); await put(hex('b'))
    const store = appStore({ S: twoFiles() })
    const first = deferred()
    apiUpload.mockImplementationOnce(() => first.p)
    const run = make(store).syncMedia()
    while (!apiUpload.mock.calls.length) await tick()
    store.setState({ user: null })
    first.resolve({ ok: true, existed: false })
    await run
    expect(apiUpload).toHaveBeenCalledTimes(1)
    // Not marked as synced for whoever is here now either.
    expect([...media.pendingNow()].sort()).toEqual([hex('a'), hex('b')])
  })

  it('stops at the server\'s 409 for another account, without backing off the file', async () => {
    await put(hex('a')); await put(hex('b'))
    apiUpload.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 409, code: 'account-mismatch' }))
    const sync = make(appStore({ S: twoFiles() }))
    await sync.syncMedia()
    expect(apiUpload).toHaveBeenCalledTimes(1)
    // The next run (the right account's) tries the file at once, no ten-minute dedupe either.
    apiUpload.mockClear()
    await sync.syncMedia()
    expect(apiUpload).toHaveBeenCalledTimes(2)
  })
})

describe('signing out', () => {
  it('a download that answers after the sign-out settled is not kept', async () => {
    const file = jpeg()
    const h = await sha256Hex(file)
    const answer = deferred()
    apiBlob.mockImplementationOnce(() => answer.p)
    const store = appStore({})
    const sync = make(store)
    const job = sync.fetchToStore(h, { mime: 'image/jpeg' })
    await sync.settle()
    store.setState({ user: { id: 'B' } })
    answer.resolve(new Blob([file]))
    await expect(job).rejects.toMatchObject({ code: 'unavailable' })
    expect(await media.get(h)).toBeFalsy()
  })

  it('waits for a download that is being written to the local store', async () => {
    const file = jpeg()
    const h = await sha256Hex(file)
    apiBlob.mockResolvedValueOnce(new Blob([file]))
    const write = deferred()
    const realPut = media.put.bind(media)
    const slow = { ...media, put: (...a) => write.p.then(() => realPut(...a)) }
    media = Object.assign(Object.create(Object.getPrototypeOf(media)), media, slow)
    const sync = make(appStore({}))
    const job = sync.fetchToStore(h, { mime: 'image/jpeg' })
    while (!apiBlob.mock.calls.length) await tick()
    for (let i = 0; i < 5; i++) await tick()
    let settled = false
    const s = sync.settle().then(() => { settled = true })
    await tick()
    expect(settled).toBe(false)
    write.resolve()
    await s
    await job
    expect(settled).toBe(true)
    expect(await media.get(h)).toBeTruthy()
  })

  it('a clean-up started under A deletes nothing once B is signed in', async () => {
    await media.put(hex('c'), new Blob([new Uint8Array(10)]), { mime: 'image/webp', pending: false })
    const store = appStore({ S: { customEx: [] } })
    const stash = deferred()
    store.setState({ stashedMediaHashes: () => stash.p })
    const sync = make(store, { now: () => Date.now() + 365 * 86400e3 })
    const gc = sync.localMediaGc()
    await tick()
    store.setState({ user: { id: 'B' } })
    stash.resolve(new Set())
    await gc
    expect(await media.get(hex('c'))).toBeTruthy()
  })
})
