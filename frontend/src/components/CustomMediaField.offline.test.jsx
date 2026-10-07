// @vitest-environment happy-dom
// The photo and video ingest is split off and loads on first use. Offline, before the worker had
// ever cached it, that load failed and the toast said "This browser cannot read that file." about
// a perfectly good photo; the next pick, back online, has to try the load again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ offline: true, toast: vi.fn() }))
vi.mock('../lib/media-ingest.js', () => {
  if (h.offline) throw new TypeError('Failed to fetch dynamically imported module')
  return { ingestMediaFile: async () => ({ blobs: [], warnings: [], media: { kind: 'image', hash: 'h' } }) }
})
vi.mock('../lib/media-store.js', () => ({ mediaStore: { ready: async () => {}, persistent: true, put: async () => {} } }))
vi.mock('../store/useUI.js', () => {
  const useUI = sel => sel({ toast: h.toast })
  useUI.getState = () => ({ toast: h.toast })
  return { useUI }
})

const { useMediaPicker, mediaErrorText } = await import('./CustomMediaField.jsx')

let host, root, picker
function Probe() { picker = useMediaPicker(); return null }

beforeEach(() => {
  h.offline = true
  h.toast.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Probe />))
})
afterEach(() => { act(() => root.render(null)); host.remove() })

describe('picking a photo with the ingest not loaded', () => {
  it('says the device is offline, not that the file is bad', async () => {
    let out
    await act(async () => { out = await picker.pick(new Blob(['x'], { type: 'image/jpeg' })) })
    expect(out).toBeNull()
    expect(h.toast).toHaveBeenCalledWith('You’re offline. Try again once you’re back online.')
    expect(mediaErrorText({ code: 'offline' })).toBe('You’re offline. Try again once you’re back online.')
  })

  it('loads it on the next pick once the network is back', async () => {
    await act(async () => { await picker.pick(new Blob(['x'], { type: 'image/jpeg' })) })
    h.offline = false
    let out
    await act(async () => { out = await picker.pick(new Blob(['x'], { type: 'image/jpeg' })) })
    expect(out).toEqual({ kind: 'image', hash: 'h' })
  })
})
