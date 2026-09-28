// @vitest-environment happy-dom
// The photo, GIF or video of a custom exercise, and its link, in the create/edit form: a picked
// file becomes a MediaRef in the draft (the ingest itself is lib/media-ingest.js, mocked here —
// its parts have their own tests), Save writes the ref and the cleaned link, Remove takes the
// ref off, a link that is not a web address stops the save, and an edit that leaves the media
// alone keeps it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'

const h = vi.hoisted(() => ({ ingest: null }))
vi.mock('./lib/media-ingest.js', () => ({ ingestMediaFile: (...a) => h.ingest(...a) }))

import { registerCustom } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { _setLangState } from './lib/i18n-core.js'
import { bindUI } from './components/ui.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from './lib/media-store.js'
import { customExSheet } from './sheets.jsx'

bindUI(useUI)

const mounted = []
const S = () => useStore.getState().S
const HASH = 'a'.repeat(64)
const POSTER = 'b'.repeat(64)
const REF = { kind: 'image', hash: HASH, mime: 'image/webp', size: 204800, width: 1600, height: 1200, poster: { hash: POSTER, mime: 'image/webp', size: 20480, width: 480, height: 360 }, at: 1727000000000 }

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const click = (host, sel, text) => {
  const el = [...host.querySelectorAll(sel)].find(e => e.textContent.trim() === text)
  if (!el) throw new Error(`nothing with text "${text}"`)
  act(() => el.click())
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
// The picked file goes through a dynamic import of the ingest; a busy run needs more than a
// fixed number of ticks, so this waits for the form to stop being busy.
async function pick(form, file = new File(['x'], 'IMG_0042.HEIC', { type: 'image/heic' })) {
  const input = form.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  act(() => { input.dispatchEvent(new Event('change', { bubbles: true })) })
  const end = Date.now() + 4000
  const busy = () => form.textContent.includes('Loading…') || !h.ingest.mock.calls.length
  while (busy() && Date.now() < end) await act(async () => { await new Promise(r => setTimeout(r, 10)) })
  await settle()
}
const custom = (over = {}) => ({ id: 'cm1', n: 'Sandbag carry', bp: 'back', eq: 'barbell', custom: true, desc: '', tg: '', sm: [], primaries: [], secondaries: [], muscleGroups: [], ...over })
function seed(ex) {
  useStore.setState(s => ({ S: { ...s.S, customEx: [ex] } }))
  registerCustom([ex])
}

let media
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null, config: null })
  registerCustom([])
  _setLangState('en', null, null, null)
  document.body.innerHTML = ''
  media = createMediaStore({ ...memoryBackend(), persistent: true, name: 'test' }, { objectURL: { createObjectURL: () => 'blob:t/1', revokeObjectURL() {} } })
  _setMediaStore(media)
  h.ingest = vi.fn(async () => ({
    media: REF,
    blobs: [{ hash: HASH, blob: new Blob(['main']), mime: 'image/webp' }, { hash: POSTER, blob: new Blob(['poster']), mime: 'image/webp' }],
    warnings: []
  }))
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  _setMediaStore(null)
  registerCustom([])
})

describe('custom exercise photo, GIF or video, and link', () => {
  it('asks for images and videos, nothing more specific', () => {
    customExSheet(null)
    const form = renderTop()
    expect(form.querySelector('input[type="file"]').getAttribute('accept')).toBe('image/*,video/*')
  })

  it('a picked file shows in the form, and Create saves its ref and the cleaned link — never the file name', async () => {
    customExSheet(null)
    const form = renderTop()
    act(() => type(form.querySelector('input.input'), 'Sandbag carry'))
    click(form, '.chip', 'back')
    click(form, '.chip', 'barbell')
    await pick(form)
    expect(h.ingest).toHaveBeenCalledTimes(1)
    expect(form.querySelector('.cmf-thumb')).toBeTruthy()
    expect(form.textContent).toContain('0.2 MB')
    expect(form.textContent).toContain('Change')
    // The files are in the local store, waiting for the server, before the form is even saved.
    expect([...media.pendingNow()].sort()).toEqual([HASH, POSTER])
    act(() => type(form.querySelector('input[type="url"]'), '  youtu.be/dQw4w9WgXcQ '))
    click(form, 'button', 'Create exercise')
    const c = S().customEx.find(x => x.n === 'Sandbag carry')
    expect(c.media).toEqual(REF)
    expect(c.url).toBe('https://youtu.be/dQw4w9WgXcQ')
    expect(JSON.stringify(S())).not.toContain('IMG_0042')
  })

  it('holds the draft\'s files out of the local clean-up while the form is open', async () => {
    customExSheet(null)
    const form = renderTop()
    await pick(form)
    expect(media.isHeld(HASH)).toBe(true)
    expect(media.isHeld(POSTER)).toBe(true)
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    expect(media.isHeld(HASH)).toBe(false)
    expect(media.isHeld(POSTER)).toBe(false)
  })

  it('Remove takes the photo off on save', async () => {
    seed(custom({ media: REF }))
    customExSheet(S().customEx[0])
    const form = renderTop()
    await settle()
    act(() => { form.querySelector('button[aria-label="Remove"]').click() })
    expect(form.querySelector('.cmf-thumb')).toBeNull()
    click(form, 'button', 'Save')
    expect(S().customEx[0].media).toBeUndefined()
  })

  it('a link that is not a web address says so and saves nothing', () => {
    seed(custom({ url: 'https://exrx.net/a' }))
    customExSheet(S().customEx[0])
    const form = renderTop()
    act(() => type(form.querySelector('input[type="url"]'), 'javascript:alert(1)'))
    click(form, 'button', 'Save')
    expect(useUI.getState().toastMsg).toBe('That link is not a web address')
    expect(S().customEx[0].url).toBe('https://exrx.net/a')
    expect(useUI.getState().sheets).toHaveLength(1)   // the form stays open with the edit
  })

  it('an edit that leaves the media alone keeps it; an empty link field removes the link', () => {
    seed(custom({ media: REF, url: 'https://exrx.net/a' }))
    customExSheet(S().customEx[0])
    const form = renderTop()
    act(() => type(form.querySelector('input.input'), 'Sandbag carry, heavy'))
    act(() => type(form.querySelector('input[type="url"]'), ''))
    click(form, 'button', 'Save')
    expect(S().customEx[0]).toMatchObject({ n: 'Sandbag carry, heavy', media: REF })
    expect(S().customEx[0].url).toBeUndefined()
  })

  it('an edit that leaves the media alone keeps a ref this version cannot read (a newer app wrote it)', () => {
    const future = { ...REF, kind: 'video', mime: 'video/mp4', codec: 'vvc1', dur: 12 }
    seed(custom({ media: future }))
    customExSheet(S().customEx[0])
    const form = renderTop()
    act(() => type(form.querySelector('input.input'), 'Sandbag carry, renamed'))
    click(form, 'button', 'Save')
    expect(S().customEx[0]).toMatchObject({ n: 'Sandbag carry, renamed', media: future })
  })

  it('a refused file becomes the sentence for it, and the draft stays as it was', async () => {
    h.ingest = vi.fn(async () => { throw Object.assign(new Error('too-large'), { code: 'too-large', mb: 40 }) })
    customExSheet(null)
    const form = renderTop()
    await pick(form)
    expect(useUI.getState().toastMsg).toBe('That file is too large — up to 40 MB.')
    expect(form.querySelector('.cmf-thumb')).toBeNull()
  })

  it('a device with no room for the file says so, rather than that the file cannot be read', async () => {
    media.put = vi.fn(async () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') })
    customExSheet(null)
    const form = renderTop()
    await pick(form)
    expect(useUI.getState().toastMsg).toBe('There is no room left on this device for that file.')
    expect(form.querySelector('.cmf-thumb')).toBeNull()
  })

  it('says a guest keeps it on this device only, and hides Add on a server that stores no media', async () => {
    customExSheet(null)
    let form = renderTop()
    await settle()
    expect(form.textContent).toContain('Kept on this device only')
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    useUI.setState({ sheets: [] })
    useStore.setState({ user: { id: 'u1', name: 'A' }, config: { invite_only: false } })
    customExSheet(null)
    form = renderTop()
    await settle()
    expect(form.textContent).toContain('Your server does not store photos and videos yet.')
    expect([...form.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add')).toBe(false)
    expect(form.querySelector('input[type="url"]')).toBeTruthy()   // the link still works
    // A guest in the browser is on that same server: what it picked would never reach it either.
    act(() => { mounted.splice(0).forEach(root => root.unmount()) })
    useUI.setState({ sheets: [] })
    useStore.setState({ user: null, config: { invite_only: false, allow_guest: true } })
    customExSheet(null)
    form = renderTop()
    await settle()
    expect(form.textContent).toContain('Your server does not store photos and videos yet.')
    expect([...form.querySelectorAll('button')].some(b => b.textContent.trim() === 'Add')).toBe(false)
  })

  it('where this browser cannot keep files, Add is there but off, and says why', async () => {
    const blocked = createMediaStore({ name: 'idb', persistent: true, open: async () => false })
    _setMediaStore(blocked)
    customExSheet(null)
    const form = renderTop()
    await settle()
    expect(form.textContent).toContain('This browser cannot store photos or videos here.')
    const add = [...form.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add')
    expect(add.disabled).toBe(true)
  })
})
