// @vitest-environment happy-dom
// A logged workout's photos and videos in its detail sheet and the history row: a picked file
// goes through the same ingest as an exercise's picture (mocked here — lib/media-ingest.js has its
// own tests), lands in the local store as pending and on the saved record, stamped; the grid shows
// posters and opens the full-screen viewer, where one can be removed; a seventh is refused.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const h = vi.hoisted(() => ({ ingest: null }))
vi.mock('./lib/media-ingest.js', () => ({ ingestMediaFile: (...a) => h.ingest(...a) }))

import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from './lib/media-store.js'
import { workoutDetailSheet, WorkoutRow } from './sheets.jsx'
import WorkoutMediaSection, { openWorkoutMediaViewer } from './components/WorkoutMedia.jsx'
import { WORKOUT_MEDIA_MAX } from './lib/media-refs.js'

bindUI(useUI)

const mounted = []
const S = () => useStore.getState().S
const hex = n => n.toString(16).padStart(2, '0').repeat(32)
const refOf = (n, kind = 'image') => kind === 'video'
  ? { kind: 'video', hash: hex(n), mime: 'video/mp4', size: 400000, width: 1280, height: 720, dur: 6, codec: 'avc1', poster: { hash: hex(n + 100), mime: 'image/webp', size: 2000, width: 480, height: 270 }, at: 1727000000000 }
  : { kind: 'image', hash: hex(n), mime: 'image/webp', size: 200000, width: 1600, height: 1200, poster: { hash: hex(n + 100), mime: 'image/webp', size: 2000, width: 480, height: 360 }, at: 1727000000000 }

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
  return Object.assign(render(sheet.render(() => useUI.getState().closeSheet(sheet.id))), { sheet })
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
async function pick(host, count = 1, ingested = count) {
  const input = host.querySelector('.wmedia input[type="file"]')
  const files = Array.from({ length: count }, (_, i) => new File(['x' + i], `IMG_00${i}.HEIC`, { type: 'image/heic' }))
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  const before = h.ingest.mock.calls.length
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  const end = Date.now() + 4000
  while ((h.ingest.mock.calls.length < before + ingested || host.textContent.includes('Loading…')) && Date.now() < end) {
    await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  }
  await settle()
}
const workout = extra => ({ id: 'w1', d: '2026-09-15', start: Date.UTC(2026, 8, 15, 17), end: Date.UTC(2026, 8, 15, 18), name: 'Push', vol: 0, prs: [], routineIds: [], entries: [], _ts: 5, ...extra })

let media, next
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: { ...structuredClone(DEF), workouts: [workout()] }, user: null, config: null })
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
  media = createMediaStore({ ...memoryBackend(), persistent: true, name: 'test' }, { objectURL: { createObjectURL: () => 'blob:t/1', revokeObjectURL() {} } })
  _setMediaStore(media)
  next = 1
  h.ingest = vi.fn(async () => {
    const n = next++
    const kind = n % 2 ? 'image' : 'video'
    const r = refOf(n, kind)
    return { media: r, blobs: [{ hash: r.hash, blob: new Blob(['main' + n]), mime: r.mime }, { hash: r.poster.hash, blob: new Blob(['poster' + n]), mime: 'image/webp' }], warnings: [] }
  })
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  _setMediaStore(null)
})

describe('a workout\'s photos and videos', () => {
  it('asks for images and videos, several at once', () => {
    workoutDetailSheet(S().workouts[0])
    const input = renderTop().querySelector('.wmedia input[type="file"]')
    expect(input.getAttribute('accept')).toBe('image/*,video/*')
    expect(input.multiple).toBe(true)
  })

  it('a picked photo and video land on the saved record, stamped, with their files pending — never the file name', async () => {
    workoutDetailSheet(S().workouts[0])
    const host = renderTop()
    await pick(host, 2)
    const w = S().workouts[0]
    expect(w.media).toEqual([refOf(1), refOf(2, 'video')])
    expect(w._ts).toBeGreaterThan(5)
    expect([...media.pendingNow()].sort()).toEqual([hex(1), hex(101), hex(2), hex(102)].sort())
    expect(host.querySelectorAll('.wmedia-item')).toHaveLength(2)
    expect(host.querySelectorAll('.wmedia-kind')).toHaveLength(1)   // the play badge on the video
    expect(JSON.stringify(S())).not.toContain('IMG_00')
  })

  it('shows posters in the grid, and opens the viewer on the one tapped', async () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout({ media: [refOf(1), refOf(2, 'video')] })] } }))
    await media.put(hex(101), new Blob(['p']), { mime: 'image/webp' })
    workoutDetailSheet(S().workouts[0])
    const host = renderTop()
    await settle()
    expect(host.querySelector('.wmedia-item img.thumb')?.getAttribute('src')).toBe('blob:t/1')
    act(() => host.querySelectorAll('.wmedia-item')[1].click())
    const top = useUI.getState().sheets.at(-1)
    expect(top.kind).toBe('viewer')
    const viewer = renderTop()
    expect(viewer.querySelector('.mviewer-count').textContent).toBe('2 / 2')
    expect(viewer.querySelector('.exmedia.viewer')).toBeTruthy()
    act(() => viewer.querySelector('button[aria-label="Previous"]').click())
    expect(viewer.querySelector('.mviewer-count').textContent).toBe('1 / 2')
  })

  it('Remove in the viewer asks, then takes it off the record and stamps it', async () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout({ media: [refOf(1), refOf(3)] })] } }))
    workoutDetailSheet(S().workouts[0])
    const detail = renderTop()
    act(() => detail.querySelectorAll('.wmedia-item')[0].click())
    const viewer = renderTop()
    act(() => viewer.querySelector('button[aria-label="Remove"]').click())
    expect(viewer.textContent).toContain('Remove this photo or video?')
    expect(S().workouts[0].media).toHaveLength(2)
    act(() => [...viewer.querySelectorAll('.mviewer-ask button')].find(b => b.textContent.trim() === 'Remove').click())
    expect(S().workouts[0].media.map(m => m.hash)).toEqual([hex(3)])
    expect(S().workouts[0]._ts).toBeGreaterThan(5)
    expect(viewer.querySelector('.mviewer-count').textContent).toBe('1 / 1')
  })

  it('a full workout offers no Add and says how many fit; a seventh picked in a batch is refused', async () => {
    workoutDetailSheet(S().workouts[0])
    const host = renderTop()
    await pick(host, WORKOUT_MEDIA_MAX + 1, WORKOUT_MEDIA_MAX)
    expect(S().workouts[0].media).toHaveLength(WORKOUT_MEDIA_MAX)
    expect(h.ingest).toHaveBeenCalledTimes(WORKOUT_MEDIA_MAX)   // the seventh is never ingested
    expect(useUI.getState().toastMsg).toBe(`Up to ${WORKOUT_MEDIA_MAX} photos or videos per workout.`)
    expect(host.querySelector('.wmedia-add')).toBeNull()
    expect(host.textContent).toContain(`Up to ${WORKOUT_MEDIA_MAX} photos or videos per workout.`)
  })

  it('a batch bigger than the room left ingests only what fits', async () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout({ media: [1, 3, 5, 7].map(n => refOf(n + 20)) })] } }))
    workoutDetailSheet(S().workouts[0])
    const host = renderTop()
    await pick(host, 5, 2)
    expect(h.ingest).toHaveBeenCalledTimes(2)
    expect(S().workouts[0].media).toHaveLength(WORKOUT_MEDIA_MAX)
    expect(useUI.getState().toastMsg).toBe(`Up to ${WORKOUT_MEDIA_MAX} photos or videos per workout.`)
    expect([...media.pendingNow()]).toHaveLength(4)   // two files, each with its poster
  })

  it('a server without media storage: no section while there is nothing; with some, no Add and why', () => {
    useStore.setState({ user: { id: 'u1', name: 'One' }, config: { passkeys: true } })
    workoutDetailSheet(S().workouts[0])
    expect(renderTop().querySelector('.wmedia')).toBeNull()
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout({ media: [refOf(1)] })] } }))
    workoutDetailSheet(S().workouts[0])
    const host = renderTop()
    expect(host.querySelectorAll('.wmedia-item')).toHaveLength(1)
    expect(host.querySelector('.wmedia-add')).toBeNull()
    expect(host.textContent).toContain('Your server does not store photos and videos yet.')
  })

  it('signed in, Add is offered only when the server says a workout may carry media', () => {
    const caps = { imageMB: 2, gifMB: 8, videoMB: 40, videoSec: 60, quotaMB: 200 }
    useStore.setState({ user: { id: 'u1', name: 'One' }, config: { media: caps } })
    expect(render(<WorkoutMediaSection w={S().workouts[0]} hint />).querySelector('.wmedia')).toBeNull()
    useStore.setState({ config: { media: { ...caps, workouts: true } } })
    expect(render(<WorkoutMediaSection w={S().workouts[0]} hint />).querySelector('.wmedia-add')).toBeTruthy()
    // Config not known yet (offline start): offered, the files wait here.
    useStore.setState({ config: null })
    expect(render(<WorkoutMediaSection w={S().workouts[0]} />).querySelector('.wmedia-add')).toBeTruthy()
    // A guest is not held to it: the files stay on the device.
    useStore.setState({ user: null, config: { media: caps } })
    expect(render(<WorkoutMediaSection w={S().workouts[0]} />).querySelector('.wmedia-add')).toBeTruthy()
  })

  it('a browser that cannot store files shows no empty section', async () => {
    media = createMediaStore({ ...memoryBackend(), persistent: false, name: 'mem' }, { objectURL: { createObjectURL: () => 'blob:t/1', revokeObjectURL() {} } })
    _setMediaStore(media)
    const host = render(<WorkoutMediaSection w={S().workouts[0]} hint />)
    await settle()
    expect(host.querySelector('.wmedia')).toBeNull()
  })

  it('signed out, the finish screen\'s section explains itself; where the files live is said once there are some', () => {
    const host = render(<WorkoutMediaSection w={S().workouts[0]} hint />)
    expect(host.textContent).toContain('A progress photo or a form-check video, kept with this workout.')
    expect(host.textContent).not.toContain('Kept on this device only')
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout({ media: [refOf(1)] })] } }))
    const withOne = render(<WorkoutMediaSection w={S().workouts[0]} hint />)
    expect(withOne.textContent).toContain('Kept on this device only')
  })

  it('the viewer takes focus, keeps Tab inside, and steps with the arrow keys (mirrored right to left)', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout({ media: [refOf(1), refOf(3), refOf(5)] })] } }))
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    openWorkoutMediaViewer(S().workouts[0], 0)
    const host = renderTop()
    const box = host.querySelector('.mviewer')
    const count = () => host.querySelector('.mviewer-count').textContent
    expect(document.activeElement).toBe(host.querySelector('button[aria-label="Close"]'))
    const key = (k, extra = {}) => act(() => { document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra })) })
    key('ArrowRight')
    expect(count()).toBe('2 / 3')
    key('ArrowLeft')
    key('ArrowLeft')
    expect(count()).toBe('3 / 3')
    // Tab from the last control wraps to the first; Shift+Tab from the first to the last.
    const buttons = [...box.querySelectorAll('button')]
    buttons.at(-1).focus()
    key('Tab')
    expect(document.activeElement).toBe(buttons[0])
    key('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(buttons.at(-1))
    document.documentElement.dir = 'rtl'
    try {
      key('ArrowRight')
      expect(count()).toBe('2 / 3')
    } finally { document.documentElement.dir = 'ltr' }
  })

  it('Delete workout in the detail sheet says its photos and videos go with it', () => {
    useStore.setState(s => ({ S: { ...s.S, workouts: [workout({ media: [refOf(1)] })] } }))
    workoutDetailSheet(S().workouts[0])
    const host = renderTop()
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete workout').click())
    expect(renderTop().textContent).toContain('This removes it from your history for good. Its photo or video is deleted with it.')
  })

  it('Delete workout without any says nothing about them', () => {
    workoutDetailSheet(S().workouts[0])
    const host = renderTop()
    act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Delete workout').click())
    expect(renderTop().textContent).not.toContain('deleted with it')
  })

  it('the history row shows how many a workout has', () => {
    const plain = render(<WorkoutRow w={workout()} onClick={() => {}} />)
    expect(plain.querySelector('.wrow-media')).toBeNull()
    const row = render(<WorkoutRow w={workout({ media: [refOf(1), refOf(2, 'video'), { hash: 'bad' }] })} onClick={() => {}} />)
    expect(row.querySelector('.wrow-media').textContent).toBe('2')
    expect(row.querySelector('.wrow-media').getAttribute('aria-label')).toBe('2 photos or videos')
  })
})
