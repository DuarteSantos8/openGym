// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useClipInMemory } from './Media.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The phone app plays a clip from memory: Capacitor's local server answered every loop's seek
// with a slow fresh read, and the animations crawled and stalled. The web keeps the plain URL.
function Probe({ src, inApp, out }) { out.value = useClipInMemory(src, inApp); return null }
const mount = props => { const host = document.createElement('div'); const root = createRoot(host); act(() => root.render(<Probe {...props} />)); return root }

describe('useClipInMemory', () => {
  afterEach(() => vi.restoreAllMocks())

  it('keeps the URL on the web', () => {
    const out = {}
    mount({ src: 'exercise-media/clip/0001.mp4', inApp: false, out })
    expect(out.value).toBe('exercise-media/clip/0001.mp4')
  })

  it('in the app, shows nothing until the clip is in memory, then a blob URL, read once', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Blob(['x'], { type: 'video/mp4' })))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:clip-1')
    const out = {}
    mount({ src: 'exercise-media/clip/0002.mp4', inApp: true, out })
    expect(out.value).toBe(null)
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(out.value).toBe('blob:clip-1')
    const again = {}
    mount({ src: 'exercise-media/clip/0002.mp4', inApp: true, out: again })
    expect(again.value).toBe('blob:clip-1')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('falls back to the URL when the read fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    const out = {}
    mount({ src: 'exercise-media/clip/0003.mp4', inApp: true, out })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    expect(out.value).toBe('exercise-media/clip/0003.mp4')
  })
})
