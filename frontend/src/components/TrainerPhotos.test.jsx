// @vitest-environment happy-dom
// Progress photos in the trainer dashboard: each file comes through the scope-checked trainer
// route, lives in an object URL only while shown, and the member's preview reads their own files.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({ blobs: [], store: [], released: [], fail: false }))
vi.mock('../lib/api.js', () => ({
  api: () => Promise.resolve({}),
  apiBlob: path => { mocks.blobs.push(path); return mocks.fail ? Promise.reject(Object.assign(new Error('no'), { status: 403 })) : Promise.resolve(new Blob(['x'], { type: 'image/jpeg' })) },
}))
vi.mock('../lib/media-store.js', () => ({
  mediaStore: { url: h => { mocks.store.push(h); return Promise.resolve(h === 'a'.repeat(64) ? 'blob:local-a' : null) }, release: h => mocks.released.push(h) },
}))

import TrainerPhotos from './TrainerPhotos.jsx'

const H = c => c.repeat(64)
const photos = { count: 12, last: '2026-11-01', items: Array.from({ length: 12 }, (_, i) => ({ hash: H('abcdef0123456789'[i]), d: `2026-10-${String(20 - i).padStart(2, '0')}` })) }
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve() }) }
let host, root, made, revoked
beforeEach(() => {
  mocks.blobs.length = 0; mocks.store.length = 0; mocks.released.length = 0; mocks.fail = false
  made = 0; revoked = []
  URL.createObjectURL = () => `blob:made-${++made}`
  URL.revokeObjectURL = u => revoked.push(u)
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('TrainerPhotos', () => {
  it('a trainer loads each shown photo through the trainer route, nine at a time, and frees them on the way out', async () => {
    await act(async () => root.render(<TrainerPhotos photos={photos} memberId="u_lea" />))
    await flush()
    expect(mocks.blobs).toHaveLength(9)
    expect(mocks.blobs[0]).toBe(`/api/trainer/member/photo?id=u_lea&hash=${H('a')}`)
    expect(mocks.store).toEqual([])                            // never the trainer's own media store
    expect(host.querySelectorAll('.tr-ph.in img')).toHaveLength(9)
    await act(async () => host.querySelector('.tr-wo-a button').click())
    await flush()
    expect(mocks.blobs).toHaveLength(12)
    // Tap one: the big view, then close it.
    await act(async () => host.querySelector('.tr-ph').click())
    await flush()
    expect(host.querySelector('.tr-ph-big img')).toBeTruthy()
    await act(async () => host.querySelector('.tr-ph-big .tr-x').click())
    expect(host.querySelector('.tr-ph-big')).toBeNull()
    act(() => root.unmount())
    expect(revoked.length).toBe(made)
    root = createRoot(host)
  })

  it('a refused file shows a placeholder and cannot be opened', async () => {
    mocks.fail = true
    await act(async () => root.render(<TrainerPhotos photos={{ count: 1, items: [photos.items[0]] }} memberId="u_lea" />))
    await flush()
    const b = host.querySelector('.tr-ph')
    expect(b.disabled).toBe(true)
    expect(b.querySelector('img')).toBeNull()
  })

  it('in the preview the member sees their own files, this device first, then their own media route', async () => {
    await act(async () => root.render(<TrainerPhotos photos={{ count: 2, items: photos.items.slice(0, 2) }} memberId={null} />))
    await flush()
    expect(mocks.store).toEqual([H('a'), H('b')])
    expect(mocks.blobs).toEqual([`/api/media/${H('b')}`])
    act(() => root.unmount())
    expect(mocks.released).toEqual([H('a')])
    root = createRoot(host)
  })

  it('says so when there is nothing yet', async () => {
    await act(async () => root.render(<TrainerPhotos photos={{ count: 0, items: [] }} memberId="u_lea" />))
    expect(host.textContent).toContain('No progress photos yet.')
  })
})
