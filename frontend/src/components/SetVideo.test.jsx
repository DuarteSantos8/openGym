// @vitest-environment happy-dom
// A set's own form video on screen (components/SetVideo.jsx): the sheet that films it (the camera
// or the phone's videos, the caps of the server in force, where it is kept, said once that it stays
// private), the player, and an exercise's "Your form videos" with two dates side by side. The
// ingest is mocked (lib/media-ingest.js has its own tests); the rest is the real store.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const h = vi.hoisted(() => ({ ingest: null }))
vi.mock('../lib/media-ingest.js', () => ({ ingestMediaFile: (...a) => h.ingest(...a) }))

import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'
import { bindUI } from './ui.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'
import { filmSetSheet, FormVideosSection, FormVideoPlayer, CompareVideos } from './SetVideo.jsx'
import { formVideosFor } from '../lib/set-videos.js'

bindUI(useUI)

const mounted = []
const S = () => useStore.getState().S
const hex = n => n.toString(16).padStart(2, '0').repeat(32)
const video = (n, extra = {}) => ({ kind: 'video', hash: hex(n), mime: 'video/mp4', size: 400000, width: 720, height: 1280, dur: 6, codec: 'avc1', poster: { hash: hex(n + 100), mime: 'image/webp', size: 2000, width: 270, height: 480 }, at: 1, ...extra })
const MediaError = (code, extra) => Object.assign(new Error(code), { code, ...extra })
const CAPS = { imageMB: 2, gifMB: 8, videoMB: 25, videoSec: 30, quotaMB: 200, workouts: true, days: true }

function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
async function choose(host, which = 'capture') {
  const input = which === 'capture' ? host.querySelector('input[type="file"][capture]') : host.querySelector('input[type="file"]:not([capture])')
  Object.defineProperty(input, 'files', { value: [new File(['x'], 'VID_0001.MOV', { type: 'video/quicktime' })], configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  await settle()
}
const active = () => ({ id: 'live', d: '2026-10-28', start: 1, name: 'Legs', entries: [{ id: '0043', target: { sets: 2, reps: 5 }, sets: [{ w: 100, r: 5, done: true }, { w: 100, r: 5, done: false }] }] })

let media
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...structuredClone(DEF), active: active(), workouts: [] }, user: null, config: null })
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
  media = createMediaStore({ ...memoryBackend(), persistent: true, name: 'test' }, { objectURL: { createObjectURL: () => 'blob:t/1', revokeObjectURL() {} } })
  _setMediaStore(media)
  h.ingest = vi.fn(async () => {
    const r = video(1)
    return { media: r, blobs: [{ hash: r.hash, blob: new Blob(['main']), mime: r.mime }, { hash: r.poster.hash, blob: new Blob(['poster']), mime: 'image/webp' }], warnings: [] }
  })
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  _setMediaStore(null)
})

describe('filming a set', () => {
  it('records with the back camera or picks a video, and puts it on that set', async () => {
    filmSetSheet({ entry: 0, set: 1 }, 'Film Set 2')
    const host = renderTop()
    expect(host.querySelector('h3').textContent).toBe('Film Set 2')
    const cam = host.querySelector('input[type="file"][capture]')
    expect(cam.getAttribute('capture')).toBe('environment')
    expect(cam.getAttribute('accept')).toBe('video/*')
    expect(host.querySelector('input[type="file"]:not([capture])').getAttribute('accept')).toBe('video/*')
    // Said once, here: they stay private.
    expect(host.textContent).toContain('Only for you. Your videos never go to the Coach, MCP, share cards, Wrapped or PDFs.')
    await choose(host)
    const set = S().active.entries[0].sets[1]
    expect(set.media.map(m => m.hash)).toEqual([hex(1)])
    expect('local' in set.media[0]).toBe(false)   // a phone in local mode: kept here anyway, nothing to flag
    expect(await media.has(hex(1))).toBe(true)
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(useUI.getState().toastMsg).toBe('Video saved with this set')
  })

  it('holds the video to the server\'s caps, and says why one is refused', async () => {
    useStore.setState({ user: { id: 'u1' }, config: { media: { ...CAPS, sets: true } } })
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const host = renderTop()
    expect(host.textContent).toContain('Up to 30 seconds.')
    h.ingest = vi.fn(async () => { throw MediaError('too-long', { sec: 30 }) })
    await choose(host, 'library')
    expect(h.ingest.mock.calls[0][1]).toMatchObject({ videoMB: 25, videoSec: 30 })
    expect(useUI.getState().toastMsg).toBe('That video is too long. Max 30 seconds.')
    expect('media' in S().active.entries[0].sets[0]).toBe(false)
    h.ingest = vi.fn(async () => { throw MediaError('too-large', { mb: 25 }) })
    await choose(host, 'library')
    expect(useUI.getState().toastMsg).toBe('That file is too big. Max 25 MB.')
  })

  it('refuses a photo: a set gets a video', async () => {
    h.ingest = vi.fn(async () => ({ media: { kind: 'image', hash: hex(3), mime: 'image/webp', size: 10, width: 2, height: 2, at: 1 }, blobs: [], warnings: [] }))
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    const host = renderTop()
    await choose(host)
    expect('media' in S().active.entries[0].sets[0]).toBe(false)
    expect(useUI.getState().toastMsg).toBe('That’s a photo. Pick a video for a set.')
  })

  it('signed in: "Keep videos on this phone only" marks it, and a server that keeps none does by itself', async () => {
    useStore.setState({ user: { id: 'u1' }, config: { media: { ...CAPS, sets: true } } })
    filmSetSheet({ entry: 0, set: 0 }, 'Film Set 1')
    let host = renderTop()
    const sw = host.querySelector('button[role="switch"]')
    expect(sw.getAttribute('aria-checked')).toBe('false')
    act(() => { sw.click() })
    expect(S().formVideoLocal).toBe(true)
    await choose(host)
    expect(S().active.entries[0].sets[0].media[0].local).toBe(true)

    // A server from before v1.4.4 (no media.sets): no switch, a note, and kept here.
    useStore.setState({ S: { ...S(), formVideoLocal: undefined, active: active() }, config: { media: CAPS } })
    filmSetSheet({ entry: 0, set: 1 }, 'Film Set 2')
    host = renderTop()
    expect(host.querySelector('button[role="switch"]')).toBeNull()
    expect(host.textContent).toContain('Your server doesn’t keep set videos, so this one stays on this phone.')
    await choose(host)
    expect(S().active.entries[0].sets[1].media[0].local).toBe(true)
  })
})

describe('playing one', () => {
  it('loops muted inline with controls, and switches to half speed', async () => {
    await media.put(hex(1), new Blob(['main']), { mime: 'video/mp4', pending: true })
    const host = render(<FormVideoPlayer m={video(1)} label="Set 1" />)
    await settle()
    const v = host.querySelector('video')
    expect(v).not.toBeNull()
    expect(v.muted).toBe(true)
    expect(v.loop).toBe(true)
    expect(v.controls).toBe(true)
    expect(v.hasAttribute('playsinline')).toBe(true)
    const half = [...host.querySelectorAll('.fv-speed button')].find(b => b.textContent === '0.5×')
    act(() => { half.click() })
    expect(v.playbackRate).toBe(0.5)
    expect(host.querySelector('button[aria-label="Full screen"]')).not.toBeNull()
  })
  it('one kept on another phone says so and is never fetched', async () => {
    useStore.setState({ user: { id: 'u1' }, config: { media: { ...CAPS, sets: true } } })
    const host = render(<FormVideoPlayer m={video(2, { local: true })} />)
    await settle()
    expect(host.querySelector('video')).toBeNull()
    expect(host.textContent).toContain('On the phone that filmed it')
  })
})

describe('Your form videos', () => {
  const saved = (id, d, n, w) => ({ id, d, start: Date.parse(d + 'T08:00:00Z'), end: Date.parse(d + 'T09:00:00Z'), name: 'Legs', prs: [], entries: [{ id: '0043', target: { sets: 1, reps: 5 }, sets: [{ w, r: 5, done: true, media: [video(n)] }] }] })
  beforeEach(() => {
    useStore.setState({ S: { ...S(), active: null, workouts: [saved('w1', '2026-08-01', 1, 80), saved('w2', '2026-09-01', 2, 90), saved('w3', '2026-10-01', 3, 100)] } })
  })
  it('lists the exercise\'s videos newest first and plays one in a sheet, with Remove', async () => {
    const host = render(<FormVideosSection exId="0043" />)
    expect(host.querySelector('h4').textContent).toBe('Your form videos')
    const tiles = [...host.querySelectorAll('.fv-tile')]
    const sets = tiles.map(t => t.querySelector('.fv-set').textContent)
    expect(sets[0]).toContain('100')
    expect(sets[1]).toContain('90')
    expect(sets[2]).toContain('80')
    act(() => { tiles[0].click() })
    const sheet = renderTop()
    expect(sheet.querySelector('.fv-player')).not.toBeNull()
    act(() => { sheet.querySelector('button[aria-label="Remove video"]').click() })
    const remove = [...sheet.querySelectorAll('.fv-ask button')].find(b => b.textContent === 'Remove')
    act(() => { remove.click() })
    expect(formVideosFor(S(), '0043').map(x => x.d)).toEqual(['2026-09-01', '2026-08-01'])
    expect(S().workouts.find(w => w.id === 'w3')._ts).toBeGreaterThan(0)
  })
  it('compares two dates: the newest with the oldest to start, both muted and in step', async () => {
    const host = render(<FormVideosSection exId="0043" />)
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Compare two dates').click() })
    const picked = [...host.querySelectorAll('.fv-tile')].map(t => t.getAttribute('aria-pressed'))
    expect(picked).toEqual(['true', 'false', 'true'])
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Compare').click() })
    const sheet = renderTop()
    expect([...sheet.querySelectorAll('figcaption b')].map(b => b.textContent)).toHaveLength(2)
    expect(sheet.querySelector('button[aria-label="Restart both"]')).not.toBeNull()
    expect(sheet.querySelector('button[aria-label="Pause both"]')).not.toBeNull()
  })
  it('shows nothing for an exercise without videos', () => {
    const host = render(<FormVideosSection exId="0025" />)
    expect(host.innerHTML).toBe('')
  })
  it('the compare view renders a pair it is handed', () => {
    const items = formVideosFor(S(), '0043')
    const host = render(<CompareVideos pair={[items[0], items[2]]} exId="0043" />)
    expect(host.querySelectorAll('.fv-side')).toHaveLength(2)
  })
})
