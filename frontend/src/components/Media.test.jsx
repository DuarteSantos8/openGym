// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Media, { Thumb } from './Media.jsx'
import { createMediaStore, memoryBackend, _setMediaStore } from '../lib/media-store.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: { gifSize: 'full' } }
  state.snapshot = () => ({
    S: state.S,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})

const EX = { id: 'bench', n: 'bench press', gif: 'bench.gif', img: 'bench.jpg' }

let host, root
beforeEach(() => {
  mocks.S = { gifSize: 'full' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = props => act(() => root.render(<Media ex={EX} {...props} />))

describe('Media gifSize', () => {
  it('renders the full animation by default and toggles to mini in the workout', () => {
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
    act(() => { host.querySelector('.giftoggle').click() })
    expect(mocks.S.gifSize).toBe('mini')
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia.mini')).toBeTruthy()
  })

  it("renders nothing at all in the workout when gifSize is 'off'", () => {
    mocks.S = { gifSize: 'off' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia')).toBeFalsy()
    expect(host.querySelector('img')).toBeFalsy()
    expect(host.innerHTML).toBe('')
  })

  it("'off' only applies to the workout — the detail sheet (not minimizable) still shows media", () => {
    mocks.S = { gifSize: 'off' }
    mount({})
    expect(host.querySelector('.exmedia img')).toBeTruthy()
  })

  it('treats a legacy/unknown value as full', () => {
    mocks.S = { gifSize: 'huge' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
  })
})

/* ---------------------------------------------------------------- custom exercises -------- */

const H = c => c.repeat(64)
const MAIN = H('a'), POSTER = H('b')
const still = { hash: POSTER, mime: 'image/webp', size: 3, width: 48, height: 36 }
const image = { kind: 'image', hash: MAIN, mime: 'image/webp', size: 3, width: 80, height: 60, poster: still, at: 1 }
const anim = { ...image, kind: 'gif', mime: 'image/gif', dur: 1.2 }
const clip = (dur, over = {}) => ({ kind: 'video', hash: MAIN, mime: 'video/mp4', size: 3, width: 64, height: 36, dur, codec: 'avc1', poster: still, at: 1, ...over })
const custom = over => ({ id: 'c1', n: 'sandbag carry', bp: 'back', custom: true, ...over })

// Object URLs the store hands out, by file, so a test can tell which file an element shows.
let media, made
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)) }) }
const mountCustom = async (ex, props = {}) => { act(() => root.render(<Media ex={ex} {...props} />)); await settle() }
async function holding(...hashes) {
  for (const h of hashes) await media.put(h, new Blob(['x']), { mime: h === MAIN ? 'image/webp' : 'image/webp', pending: false })
}

describe('Media — a custom exercise', () => {
  beforeEach(() => {
    made = []
    media = createMediaStore(memoryBackend(), {
      objectURL: { createObjectURL: b => { const u = 'blob:t/' + made.length; made.push(u); return u }, revokeObjectURL: () => {} },
      canPlayType: () => ''
    })
    _setMediaStore(media)
    HTMLMediaElement.prototype.play = vi.fn(function () { return Promise.resolve() })
    HTMLMediaElement.prototype.pause = vi.fn()
  })
  afterEach(() => { _setMediaStore(null); delete window.matchMedia })

  it('shows its photo from the local store, never a dataset path', async () => {
    await holding(MAIN, POSTER)
    await mountCustom(custom({ media: image, img: 'fork.jpg', gif: 'fork.gif' }))
    const img = host.querySelector('.exmedia img')
    expect(img.getAttribute('src')).toMatch(/^blob:t\//)
    expect(host.innerHTML).not.toContain('fork.')
  })

  it('a GIF animates, and a tap switches to its still and back', async () => {
    await holding(MAIN, POSTER)
    await mountCustom(custom({ media: anim }))
    const src = () => host.querySelector('.exmedia img').getAttribute('src')
    const animated = src()
    expect(host.querySelector('.gifhint').textContent).toContain('tap to pause')
    act(() => { host.querySelector('.exmedia').click() })
    expect(src()).not.toBe(animated)
    expect(host.querySelector('.gifhint').textContent).toContain('tap to play')
    act(() => { host.querySelector('.exmedia').click() })
    expect(src()).toBe(animated)
  })

  it('a short video loops muted and inline, and plays by itself', async () => {
    await holding(MAIN, POSTER)
    await mountCustom(custom({ media: clip(8) }))
    const v = host.querySelector('.exmedia video')
    expect(v).toBeTruthy()
    expect(v.muted).toBe(true)
    expect(v.hasAttribute('muted')).toBe(true)
    expect(v.loop).toBe(true)
    expect(v.hasAttribute('playsinline')).toBe(true)
    expect(v.hasAttribute('controls')).toBe(false)
    expect(v.getAttribute('poster')).toMatch(/^blob:t\//)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    expect(host.querySelector('.gifhint').textContent).toContain('tap to pause')
  })

  it('does not play by itself in the workout\'s list layout, nor under reduced motion', async () => {
    await holding(MAIN, POSTER)
    mocks.S = { gifSize: 'full', workoutView: 'list' }
    await mountCustom(custom({ media: clip(8) }), { minimizable: true })
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    expect(host.querySelector('.gifhint').textContent).toContain('tap to play')
    act(() => root.render(<div />))
    mocks.S = { gifSize: 'full' }
    window.matchMedia = q => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} })
    await mountCustom(custom({ media: clip(8) }))
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    act(() => { host.querySelector('.exmedia').click() })
    await settle()
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it('plays only while it can be seen: a card off screen stops, and a loop starts again on its return', async () => {
    const observers = []
    const IO = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; observers.push(this) } observe() {} disconnect() {} }
    try {
      await holding(MAIN, POSTER)
      await mountCustom(custom({ media: clip(8) }))
      const plays = () => HTMLMediaElement.prototype.play.mock.calls.length
      const before = plays()
      expect(before).toBeGreaterThan(0)
      await act(async () => { observers.at(-1).cb([{ isIntersecting: false }]) })
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
      await act(async () => { observers.at(-1).cb([{ isIntersecting: true }]) })
      expect(plays()).toBeGreaterThan(before)
    } finally { globalThis.IntersectionObserver = IO }
  })

  // QA, v1.3.9: reopened within the half-minute its file stays cached, the sheet was still sliding
  // in when the file was there. The observer's first answer (off screen) paused the play() just
  // started, the AbortError that followed was taken for a refusal, and the clip never started.
  it('a play() cut short by its own pause (the sheet still sliding in) plays once the box is on screen', async () => {
    const observers = []
    const IO = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; observers.push(this) } observe() {} disconnect() {} }
    let reject = null
    HTMLMediaElement.prototype.play = vi.fn(function () { return new Promise((res, rej) => { reject = rej }) })
    HTMLMediaElement.prototype.pause = vi.fn(function () {
      reject?.(Object.assign(new Error('The play() request was interrupted by a call to pause().'), { name: 'AbortError' }))
    })
    try {
      await holding(MAIN, POSTER)
      await mountCustom(custom({ media: clip(10) }))
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
      await act(async () => { observers.at(-1).cb([{ isIntersecting: false }]) })
      await settle()
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled()
      HTMLMediaElement.prototype.play = vi.fn(function () { return Promise.resolve() })
      await act(async () => { observers.at(-1).cb([{ isIntersecting: true }]) })
      await settle()
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
      expect(host.querySelector('.gifhint').textContent).toContain('tap to pause')
    } finally { globalThis.IntersectionObserver = IO }
  })

  it('a short clip the browser refuses to start unasked waits for a tap', async () => {
    const observers = []
    const IO = globalThis.IntersectionObserver
    globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; observers.push(this) } observe() {} disconnect() {} }
    HTMLMediaElement.prototype.play = vi.fn(function () { return Promise.reject(Object.assign(new Error('no gesture'), { name: 'NotAllowedError' })) })
    try {
      await holding(MAIN, POSTER)
      await mountCustom(custom({ media: clip(10) }))
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
      await act(async () => { observers.at(-1).cb([{ isIntersecting: true }]) })
      await settle()
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
      expect(host.querySelector('.gifhint').textContent).toContain('tap to play')
      HTMLMediaElement.prototype.play = vi.fn(function () { return Promise.resolve() })
      act(() => { host.querySelector('.exmedia').click() })
      await settle()
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1)
    } finally { globalThis.IntersectionObserver = IO }
  })

  it('a long video waits for a tap, then plays with sound and its own controls', async () => {
    await holding(MAIN, POSTER)
    await mountCustom(custom({ media: clip(45) }))
    let v = host.querySelector('.exmedia video')
    expect(v.hasAttribute('controls')).toBe(false)
    expect(v.loop).toBe(false)
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    act(() => { host.querySelector('.exmedia').click() })
    await settle()
    v = host.querySelector('.exmedia video')
    expect(v.hasAttribute('controls')).toBe(true)
    expect(v.muted).toBe(false)
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
  })

  it("follows gifSize in the workout: nothing when 'off', the mini box when 'mini'", async () => {
    await holding(MAIN, POSTER)
    mocks.S = { gifSize: 'off' }
    await mountCustom(custom({ media: image, url: 'https://youtu.be/x' }), { minimizable: true })
    expect(host.innerHTML).toBe('')
    mocks.S = { gifSize: 'mini' }
    await mountCustom(custom({ media: image, url: 'https://youtu.be/x' }), { minimizable: true })
    expect(host.querySelector('.exmedia.mini')).toBeTruthy()
    expect(host.querySelector('.exlink-card')).toBeNull()   // the card waits for the full size
  })

  it('a link alone is a card that opens it without an opener or a referrer — no img, no iframe, nothing fetched', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    await mountCustom(custom({ url: 'youtube.com/watch?v=abc' }))
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelector('iframe')).toBeNull()
    expect(host.querySelector('a[href]')).toBeNull()
    const card = host.querySelector('button.exlink-card')
    expect(card.textContent).toContain('Watch video')
    expect(card.textContent).toContain('youtube.com')
    act(() => { card.click() })
    expect(open).toHaveBeenCalledWith('https://youtube.com/watch?v=abc', '_blank', 'noopener,noreferrer')
    open.mockRestore()
  })

  it('a link that is not a web address renders nothing and opens nothing', async () => {
    await mountCustom(custom({ url: 'javascript:alert(1)' }))
    expect(host.innerHTML).toBe('')
  })

  it('a photo and a link: the card sits under the picture, and says Open link for a guide', async () => {
    await holding(MAIN, POSTER)
    await mountCustom(custom({ media: image, url: 'https://exrx.net/guide' }))
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exlink-card').textContent).toContain('Open link')
  })

  it('a file that is not here, with no server to ask, shows the tile', async () => {
    await mountCustom(custom({ media: image }))
    expect(host.querySelector('.exmedia.broken .exmedia-x')).toBeTruthy()
    expect(host.querySelector('img')).toBeNull()
  })
})

describe('Thumb — a custom exercise', () => {
  beforeEach(() => {
    made = []
    media = createMediaStore(memoryBackend(), { objectURL: { createObjectURL: () => 'blob:t/' + made.push(1), revokeObjectURL: () => {} } })
    _setMediaStore(media)
  })
  afterEach(() => _setMediaStore(null))
  const mountThumb = async ex => { act(() => root.render(<Thumb ex={ex} />)); await settle() }

  it('loads the poster and nothing else', async () => {
    const asked = []
    const url = media.url
    media.url = h => { asked.push(h); return url(h) }
    await holding(MAIN, POSTER)
    await mountThumb(custom({ media: clip(30) }))
    expect(host.querySelector('img.thumb')).toBeTruthy()
    expect(asked).toEqual([POSTER])
  })

  it('a video without a poster shows play; a link shows play for a video site and link otherwise; nothing shows the dumbbell', async () => {
    await mountThumb(custom({ media: clip(30, { poster: undefined }) }))
    expect(host.querySelector('.thumb-x [data-icon="play"]')).toBeTruthy()
    await mountThumb(custom({ url: 'https://vimeo.com/1' }))
    expect(host.querySelector('.thumb-x [data-icon="play"]')).toBeTruthy()
    await mountThumb(custom({ url: 'https://exrx.net/x' }))
    expect(host.querySelector('.thumb-x [data-icon="link"]')).toBeTruthy()
    await mountThumb(custom({}))
    expect(host.querySelector('.thumb-x [data-icon="dumbbell"]')).toBeTruthy()
  })

  it('a poster that is not here shows the tile while nothing can fetch it', async () => {
    await mountThumb(custom({ media: image }))
    expect(host.querySelector('.thumb-x')).toBeTruthy()
    expect(host.querySelector('img')).toBeNull()
  })
})
