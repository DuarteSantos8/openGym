// @vitest-environment happy-dom
// A big video is made smaller on the device before it is kept (lib/video-shrink.js): the picker
// hands the ingest the smaller clip, shows how far it got, and says so when even that is too big.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const h = vi.hoisted(() => ({ toast: vi.fn(), seen: [], tooBig: false, labels: [] }))
vi.mock('../lib/media-ingest.js', () => ({
  ingestMediaFile: async file => {
    h.seen.push(file)
    if (h.tooBig) throw Object.assign(new Error('too-large'), { code: 'too-large', mb: 100 })
    return { blobs: [], warnings: [], media: { kind: 'video', hash: 'h' } }
  },
}))
vi.mock('../lib/video-shrink.js', () => ({
  shouldShrink: f => f.size > 10,
  shrinkVideo: async (f, { onProgress }) => { onProgress(0.5); await new Promise(r => setTimeout(r, 5)); return { size: 5, type: 'video/mp4', small: true } },
}))
vi.mock('../lib/media-store.js', () => ({ mediaStore: { ready: async () => {}, persistent: true, put: async () => {} } }))
vi.mock('../store/useUI.js', () => {
  const useUI = sel => sel({ toast: h.toast })
  useUI.getState = () => ({ toast: h.toast })
  return { useUI }
})

const { useMediaPicker, mediaErrorText, busyText } = await import('./CustomMediaField.jsx')

let host, root, picker
function Probe() { picker = useMediaPicker(); return null }

beforeEach(() => {
  h.toast.mockReset(); h.seen = []; h.tooBig = false; h.labels = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Probe />))
})
afterEach(() => { act(() => root.render(null)); host.remove() })

describe('a big video', () => {
  it('goes to the ingest shrunk, with the percent on the busy button', async () => {
    let out
    await act(async () => { out = await picker.pick({ size: 50, type: 'video/mp4', name: 'a.mp4', slice: () => new Blob() }) })
    expect(out).toEqual({ kind: 'video', hash: 'h' })
    expect(h.seen[0]).toMatchObject({ small: true })
    expect(busyText(0.5)).toBe('Shrinking the video… 50%')
    expect(busyText(null)).toBe('Loading…')
    expect(picker.busyLabel).toBe('Loading…')
  })

  it('a small one is taken as it is', async () => {
    const f = { size: 5, type: 'video/mp4', name: 'a.mp4' }
    await act(async () => { await picker.pick(f) })
    expect(h.seen[0]).toBe(f)
  })

  it('still too big after shrinking: says a shorter clip will fit', async () => {
    h.tooBig = true
    await act(async () => { await picker.pick({ size: 500, type: 'video/mp4', name: 'a.mp4' }) })
    expect(h.toast).toHaveBeenCalledWith('That video is still too big after squeezing it. Max 100 MB, so a shorter clip will fit.')
    expect(mediaErrorText({ code: 'too-large', mb: 2 })).toBe('That file is too big. Max 2 MB.')
  })
})
