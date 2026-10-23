// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CatalogueMediaManager from './CatalogueMediaManager.jsx'
import Media from './Media.jsx'
import { CATALOGUE, drawingIdOf } from '../lib/exercises.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ service: null, state: {}, listeners: new Set() }))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({ S: mocks.state, update: mut => mut(mocks.state) })
  const useStore = selector => selector(snapshot())
  useStore.getState = snapshot
  return { useStore }
})
vi.mock('../lib/catalogue-media.js', () => ({
  getCatalogueMedia: () => mocks.service,
  catalogueMediaSnapshot: () => mocks.service?.snapshot() || null,
  subscribeCatalogueMedia: fn => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn) },
  initCatalogueMedia: async () => mocks.service,
}))

const ex = CATALOGUE.find(e => e.fv)
const male = { assetId: 'male:clip', drawingId: drawingIdOf(ex, 'male'), kind: 'clip', format: 'webp', bytes: 22000, sha256: 'a'.repeat(64) }
const female = { ...male, assetId: 'female:clip', drawingId: ex.fv, sha256: 'b'.repeat(64) }
const local = id => `https://localhost/_capacitor_file_/data/${id}.webp`
let snapshot, host, root, released
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const mount = async element => { act(() => root.render(element)); await settle() }
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent === text || b.textContent.includes(text))
const click = async text => { const el = button(text); expect(el).toBeTruthy(); await act(async () => el.click()); await settle() }
const publish = patch => act(() => {
  snapshot = { ...snapshot, ...patch }
  mocks.listeners.forEach(fn => fn())
})
beforeEach(() => {
  snapshot = { resources: {}, batches: [], downloadedBytes: 0, bundledBytes: 100, obsoleteBytes: 0 }
  released = vi.fn()
  mocks.state = { gifSize: 'full', body: 'male', routines: [{ ex: [{ id: ex.id }] }], favEx: [] }
  mocks.listeners.clear()
  const service = {
    manifest: { assets: [male, female] },
    snapshot: () => snapshot,
    subscribe: fn => { mocks.listeners.add(fn); return () => mocks.listeners.delete(fn) },
    estimate: vi.fn(async ids => ({ missingCount: ids.length, downloadBytes: 22000, peakAdditionalBytes: 16821216, freeBytes: null })),
    enqueue: vi.fn(async () => ({ batchId: 'batch-1' })),
    pause: vi.fn(async () => {}), resume: vi.fn(async () => {}), cancel: vi.fn(async () => {}), retry: vi.fn(async () => {}),
    remove: vi.fn(async () => {}), removeAll: vi.fn(async () => {}), removeObsolete: vi.fn(async () => {}),
    resolve: vi.fn(async id => ({ status: snapshot.resources[id]?.status || 'missing',
      url: snapshot.resources[id]?.status === 'downloaded' ? local(id) : null, release: () => released(id) })),
    revalidate: vi.fn(async () => false),
  }
  mocks.service = service
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); mocks.service = null; vi.unstubAllEnvs() })

describe('offline animation manager', () => {
  it('previews a figure-specific snapshot and mobile-data warning before starting a batch', async () => {
    mocks.state.exFigure = 'female'
    await mount(<CatalogueMediaManager service={mocks.service} initiallyOpen />)
    expect(mocks.service.enqueue).not.toHaveBeenCalled()
    await click('Download current plan')
    expect(mocks.service.estimate).toHaveBeenCalledWith([female.assetId])
    expect(host.textContent).toContain('1 missing · 22 kB to download')
    expect(host.textContent).toContain('Space could not be checked')
    expect(host.textContent).toContain('This download may use mobile data.')
    expect(mocks.service.enqueue).not.toHaveBeenCalled()
    // The plan changes after the preview: Start still submits the clicked snapshot.
    mocks.state.routines = []
    await click('Start')
    expect(mocks.service.enqueue).toHaveBeenCalledWith([female.assetId])
  })
  it('explains empty favourites and does not enqueue a request', async () => {
    await mount(<CatalogueMediaManager service={mocks.service} initiallyOpen />)
    await click('Download favourites')
    expect(host.textContent).toContain('No favourites to download.')
    expect(mocks.service.enqueue).not.toHaveBeenCalled()
  })
  it('shows queued files as unfinished and offers pause, resume preview, retry and cancel', async () => {
    snapshot.batches = [{ id: 'b1', assetIds: [male.assetId], completed: [], failed: {}, status: 'queued' }]
    snapshot.resources = { [male.assetId]: { status: 'queued', bytes: male.bytes } }
    await mount(<CatalogueMediaManager service={mocks.service} initiallyOpen />)
    expect(host.textContent).toContain('0 animations saved on this device')
    expect(host.textContent).toContain('0 completed · 0 failed · 1 total')
    await click('Pause')
    expect(mocks.service.pause).toHaveBeenCalledWith('b1')
    publish({ batches: [{ ...snapshot.batches[0], status: 'paused', unavailable: ['old'], failed: { [male.assetId]: { code: 'no-space' } } }] })
    expect(host.textContent).toContain('Not enough space. Free some space and continue.')
    expect(host.textContent).toContain('1 animations are no longer available.')
    await click('Continue'); await click('Start')
    expect(mocks.service.resume).toHaveBeenCalledWith('b1')
    await click('Retry failed downloads')
    expect(mocks.service.retry).toHaveBeenCalledWith('b1')
    await click('Cancel')
    expect(mocks.service.cancel).toHaveBeenCalledWith('b1')
  })
  it('requires an explicit cleanup click and leaves training state untouched', async () => {
    snapshot.resources = { [male.assetId]: { status: 'downloaded', bytes: male.bytes } }
    snapshot.downloadedBytes = male.bytes
    mocks.service.remove.mockResolvedValueOnce({ removedBytes: 0, deferredCount: 1 })
    const before = structuredClone(mocks.state)
    await mount(<CatalogueMediaManager service={mocks.service} initiallyOpen />)
    const check = host.querySelector('input[type="checkbox"]')
    act(() => check.click())
    await click('Delete selected downloads')
    expect(host.textContent).toContain('Remove 22 kB of downloaded animations?')
    expect(mocks.service.remove).not.toHaveBeenCalled()
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Delete').click())
    expect(mocks.service.remove).toHaveBeenCalledWith([male.assetId])
    expect(host.textContent).toContain('1 animations will be removed after playback.')
    expect(mocks.state).toEqual(before)
  })
})

describe('single exercise on-demand media', () => {
  it('does not acquire a playback reference for hidden workout animations', async () => {
    mocks.state.gifSize = 'off'
    await mount(<Media ex={ex} minimizable />)
    expect(host.innerHTML).toBe('')
    expect(mocks.service.resolve).not.toHaveBeenCalled()
  })
  it('uses a static image until an explicit download is verified', async () => {
    await mount(<Media ex={ex} />)
    expect(host.querySelector('img').getAttribute('src')).toContain('exercise-media/still/')
    expect(mocks.service.enqueue).not.toHaveBeenCalled()
    await click('Download animation · 22 kB')
    expect(mocks.service.enqueue).toHaveBeenCalledWith([male.assetId])
    publish({ resources: { [male.assetId]: { status: 'downloading', received: 11000, bytes: male.bytes } } })
    await settle()
    expect(host.textContent).toContain('Downloading 50%')
    expect(host.querySelector('img').getAttribute('src')).toContain('exercise-media/still/')
    publish({ resources: { [male.assetId]: { status: 'downloaded', bytes: male.bytes } } })
    await settle()
    expect(host.querySelector('img').getAttribute('src')).toBe(local(male.assetId))
  })
  it('releases old playback references and immediately shows the new figure still', async () => {
    snapshot.resources = { [male.assetId]: { status: 'downloaded', bytes: male.bytes } }
    await mount(<Media ex={ex} />)
    expect(host.querySelector('img').getAttribute('src')).toBe(local(male.assetId))
    mocks.state.exFigure = 'female'
    await mount(<Media ex={ex} />)
    expect(released).toHaveBeenCalledWith(male.assetId)
    expect(host.querySelector('img').getAttribute('src')).toContain(ex.fv + '.webp')
    expect(host.querySelector('img').getAttribute('src')).not.toBe(local(male.assetId))
    expect(mocks.service.enqueue).not.toHaveBeenCalled()
  })
  it('revalidates a failed local file and holds a static fallback without a retry loop', async () => {
    snapshot.resources = { [male.assetId]: { status: 'downloaded', bytes: male.bytes } }
    await mount(<Media ex={ex} />)
    act(() => host.querySelector('img').dispatchEvent(new Event('error')))
    await settle()
    expect(mocks.service.revalidate).toHaveBeenCalledWith(male.assetId)
    expect(mocks.service.revalidate).toHaveBeenCalledTimes(1)
    expect(host.querySelector('img').getAttribute('src')).toContain('exercise-media/still/')
    expect(host.textContent).toContain('Download failed. Try again.')
  })
  it('does not request a bundled animation if a slim manifest is unavailable', async () => {
    vi.stubEnv('VITE_APP_MEDIA_MODE', 'slim')
    mocks.service = null
    await mount(<Media ex={ex} />)
    expect(host.querySelector('img').getAttribute('src')).toContain('exercise-media/still/')
    expect(host.textContent).toContain('Animations are unavailable in this build.')
  })
})
