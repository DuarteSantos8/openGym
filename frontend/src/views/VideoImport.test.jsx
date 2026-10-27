// @vitest-environment happy-dom
// The import screen against a faked server: a link goes in, the job is polled, the boxes are
// drawn when the server asks for them, and the reviewed rows are saved as one routine.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VideoImport from './VideoImport.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), appBase: () => '/' }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
// Not every test environment has sessionStorage; the screen only uses it to resume a job.
if (!globalThis.sessionStorage) {
  const m = new Map()
  globalThis.sessionStorage = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear() }
}

const JOB = 'c'.repeat(24)
const SOURCE = { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ', title: 'Quick HIIT', channel: 'Coach', channelId: 'UC1' }
const DONE = {
  id: JOB, status: 'done', stage: 'done', pct: 100, source: SOURCE, method: 'video',
  result: {
    source: SOURCE, method: 'video', roiSaved: false,
    draft: { sections: [
      { kind: 'interval', rounds: 3, work: 40, rest: 20, rows: [
        { id: 'v1', name: 'Burpees', conf: 0.9, sec: 40, rest: 20, rounds: 3, occurrences: [{ start: 30, dur: 40 }, { start: 150, dur: 40 }, { start: 270, dur: 40 }] },
        { id: 'v2', name: 'Turbo Frog Shuffle', conf: 0.8, sec: 40, rest: 20, rounds: 3, occurrences: [{ start: 90, dur: 40 }, { start: 210, dur: 40 }, { start: 330, dur: 40 }] }
      ] }
    ] }
  }
}
const WAITING = {
  id: JOB, status: 'needs_roi', stage: 'needs_roi', pct: 28, source: SOURCE, method: 'video',
  roiSetup: { width: 640, height: 360, samples: [{ t: 60, src: 'data:image/jpeg;base64,AA' }], suggest: { name: { x: 0.05, y: 0.8, w: 0.6, h: 0.12 }, timer: null } }
}

let root, container, jobAnswer
const flush = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0) }) }
const poll = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1600) }) }
const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === text)

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><VideoImport /></MemoryRouter>))
}

beforeEach(() => {
  vi.useFakeTimers()
  sessionStorage.clear(); try { localStorage.clear() } catch { /* none */ }
  const S = JSON.parse(JSON.stringify(DEF))
  useStore.setState({ S, user: { id: 'u1', name: 'P' }, config: { video_import: true } })
  useUI.setState({ sheets: [], toastMsg: '' })
  jobAnswer = WAITING
  vi.mocked(api).mockReset()
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (path === '/api/video-import') return { id: JOB, status: 'queued', stage: 'queued', pct: 0 }
    if (path.startsWith('/api/video-import/job')) return jobAnswer
    if (path === '/api/video-import/roi') { jobAnswer = DONE; return { ...WAITING, status: 'running', stage: 'frames' } }
    if (path === '/api/video-import/cancel') return { id: JOB, status: 'cancelled' }
    throw new Error('unexpected ' + path + ' ' + (init?.method || 'GET'))
  })
})

afterEach(() => {
  if (root) act(() => root.unmount())
  container?.remove()
  vi.useRealTimers()
})

describe('import from a video', () => {
  it('is not offered on a server without the worker', () => {
    useStore.setState({ config: {} })
    render()
    expect(container.textContent).toMatch(/does not offer importing from videos/)
    expect(container.querySelector('input')).toBeNull()
  })

  it('link → boxes → review → one routine with timed sets', async () => {
    render()
    const input = container.querySelector('input')
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, 'https://youtu.be/dQw4w9WgXcQ')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { button('Analyse video').click() })
    await flush()
    expect(api).toHaveBeenCalledWith('/api/video-import', expect.objectContaining({ method: 'POST' }))
    expect(JSON.parse(vi.mocked(api).mock.calls[0][1].body)).toEqual({ url: 'https://youtu.be/dQw4w9WgXcQ' })

    // The server asks for the boxes; its suggestion is already drawn.
    await poll()
    expect(container.textContent).toMatch(/Mark the name and the timer/)
    expect(container.querySelector('.vi-box.name')).toBeTruthy()
    await act(async () => { button('Continue').click() })
    const roiCall = vi.mocked(api).mock.calls.find(c => c[0] === '/api/video-import/roi')
    expect(JSON.parse(roiCall[1].body)).toMatchObject({ id: JOB, name: { x: 0.05, y: 0.8, w: 0.6, h: 0.12 }, timer: null, remember: true })

    // Then the draft.
    await poll(); await poll()
    expect(container.textContent).toMatch(/Intervals · 3 rounds/)
    expect(container.querySelectorAll('.vi-row')).toHaveLength(6)   // every round its own row
    expect(container.textContent).toMatch(/Round 2/)
    expect(container.textContent).toMatch(/New exercise:/)    // the unmatched name is kept, not dropped

    await act(async () => { button('Save routine').click() })
    const S = useStore.getState().S
    const r = S.routines.find(x => x.videoId === 'dQw4w9WgXcQ')
    expect(r).toBeTruthy()
    expect(r.name).toBe('Quick HIIT')
    expect(r.sourceUrl).toBe(SOURCE.url)
    expect(r.ex.map(e => [e.mode, e.sets, e.sec, e.restSec])).toEqual(Array(2).fill(['time', 3, 40, 20]))   // one circuit, a set per round
    expect(S.customEx.some(c => c.n === 'turbo frog shuffle' && c.custom)).toBe(true)
  })

  it('a deleted row is not saved', async () => {
    jobAnswer = DONE
    sessionStorage.setItem('gym_video_import_job', JOB)   // a reload in the middle of an import resumes it
    render()
    await flush()
    expect(container.querySelectorAll('.vi-row')).toHaveLength(6)
    await act(async () => { container.querySelectorAll('.vi-row')[1].querySelector('button[aria-label="Delete"]').click() })
    await act(async () => { button('Save routine').click() })
    const r = useStore.getState().S.routines.find(x => x.videoId === 'dQw4w9WgXcQ')
    expect(r.ex).toHaveLength(5)
  })

  it('saves a block that repeats whole as one circuit: one superset, a set per round', async () => {
    jobAnswer = DONE
    sessionStorage.setItem('gym_video_import_job', JOB)
    render()
    await flush()
    await act(async () => { button('Save routine').click() })
    const r = useStore.getState().S.routines.find(x => x.videoId === 'dQw4w9WgXcQ')
    expect(r.ex).toHaveLength(2)
    expect(r.ex.every(e => e.sets === 3 && e.sec === 40 && e.restSec === 20)).toBe(true)
    expect(r.ex[0].sg).toBeTruthy()
    expect(r.ex[0].sg).toBe(r.ex[1].sg)
    expect(r.ex[0].sgName).toBe('Circuit 1')
  })

  it('a row with no name and no exercise stops the save and says why', async () => {
    jobAnswer = { ...DONE, result: { ...DONE.result, draft: { sections: [{ kind: 'stretch', rows: [
      { id: 'v9', name: '', conf: 0, sec: 30, rest: 0, rounds: 1, occurrences: [{ start: 3500, dur: 30 }] }
    ] }] } } }
    sessionStorage.setItem('gym_video_import_job', JOB)
    render()
    await flush()
    expect(container.textContent).toMatch(/No name on screen/)
    await act(async () => { button('Save routine').click() })
    expect(useUI.getState().toastMsg).toMatch(/no exercise yet/)
    expect(useStore.getState().S.routines.some(x => x.videoId === 'dQw4w9WgXcQ')).toBe(false)
  })
})
