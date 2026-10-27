// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* Settings → Workout → Animation quality in the store apps, and what it puts on screen: the
   chosen pack's file, the next one down when it will not load, the built-in one, then the still.
   The profile (S) is never written. The native plugin is a stand-in. */
// The store apps' built-in animations are animated WebP (VITE_CLIP_EXT=webp), shown as images.
vi.hoisted(() => { vi.stubEnv('VITE_CLIP_EXT', 'webp') })
const mocks = vi.hoisted(() => ({
  MOBILE: true, available: true, ready: new Set(), downloads: [], sheets: [], writes: 0,
  S: { gifSize: 'full', exFigure: 'female', workouts: [{ id: 'w1', entries: [{ id: '0001' }] }] },
}))
vi.mock('../lib/mobile.js', () => ({ get MOBILE() { return mocks.MOBILE } }))
vi.mock('../store/useStore.js', () => {
  const snapshot = () => ({ S: mocks.S, update: () => { mocks.writes++ } })
  const useStore = selector => (selector ? selector(snapshot()) : snapshot())
  useStore.getState = snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ toast: vi.fn(), openSheet: render => { mocks.sheets.push(render); return {} } })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('@capacitor/core', () => {
  const impl = {
    available: async () => ({ available: mocks.available }),
    status: async ({ packId }) => (mocks.ready.has(packId) ? { state: 'ready', bytes: 42 * 1024 * 1024 } : { state: 'none' }),
    localPath: async ({ packId }) => ({ path: '/packs/' + packId }),
    download: async ({ packId }) => { mocks.downloads.push(packId) },
    remove: async ({ packId }) => { mocks.ready.delete(packId) },
    addListener: () => ({ remove() {} }),
  }
  return {
    registerPlugin: () => new Proxy({}, { get: (_, k) => impl[k] || (() => new Promise(() => {})) }),
    Capacitor: { convertFileSrc: p => 'app://files' + p },
  }
})

import Media from './Media.jsx'
import { AnimationQualityRow, AnimationQualitySheet } from './Animations.jsx'
import * as packs from '../lib/anim-packs.js'
import { EXIDX } from '../lib/exercises.js'

let host, root
const settle = () => act(() => new Promise(r => setTimeout(r, 0)))
async function mount(el) { await act(async () => { root.render(el) }); await settle() }
const rowTitles = () => [...host.querySelectorAll('.lrow-t')].map(e => e.textContent)
const rowByTitle = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const img = () => host.querySelector('.exmedia img')
const fire = (el, type) => act(() => { el.dispatchEvent(new Event(type)) })

beforeEach(async () => {
  localStorage.clear()
  Object.assign(mocks, { MOBILE: true, available: true, ready: new Set(), downloads: [], sheets: [], writes: 0 })
  mocks.S = { gifSize: 'full', exFigure: 'female', workouts: [{ id: 'w1', entries: [{ id: '0001' }] }] }
  packs._resetAnimPacks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('the setting', () => {
  it('is not there on the web or a self-hosted server', async () => {
    mocks.MOBILE = false
    await mount(<AnimationQualityRow />)
    expect(host.textContent).toBe('')
  })
  it('offers auto, still only, built in and every pack quality, each with how it stands here', async () => {
    mocks.ready.add('anim-480-female')
    await packs.refresh()
    await mount(<AnimationQualitySheet close={() => {}} />)
    expect(rowTitles()).toEqual(expect.arrayContaining(['Still only', 'Built in (180 px)', '240 px', '360 px', '480 px', '720 px', '1080 px', 'Download over Wi-Fi only']))
    expect(rowTitles().some(r => r.startsWith('Auto ('))).toBe(true)
    expect(rowByTitle('480 px').textContent).toContain('Downloaded · 42 MB')
    expect(rowByTitle('720 px').textContent).toContain('Not downloaded')
    expect(rowByTitle('480 px · Female').textContent).toContain('42 MB')
  })
  it('picking a quality downloads its pack for the figure shown, and writes nothing to the profile', async () => {
    await packs.refresh()
    const before = structuredClone(mocks.S)
    await mount(<AnimationQualitySheet close={() => {}} />)
    await act(async () => { rowByTitle('720 px').click() })
    await settle()
    expect(packs.readPrefs().choice).toBe(720)
    expect(mocks.downloads).toEqual(['anim-720-female'])
    expect(mocks.writes).toBe(0)
    expect(mocks.S).toEqual(before)
  })
  it('without packs on this device: still only and built in, and it says why', async () => {
    mocks.available = false
    await packs.refresh()
    await mount(<AnimationQualitySheet close={() => {}} />)
    expect(rowTitles()).toEqual(['Still only', 'Built in (180 px)'])
    expect(host.textContent).toContain('Sharper animations aren’t available on this device yet.')
  })
  it('deleting a pack frees it and lists it no more', async () => {
    mocks.ready.add('anim-1080-male')
    await packs.refresh()
    await mount(<AnimationQualitySheet close={() => {}} />)
    await act(async () => { rowByTitle('1080 px · Male').querySelector('button').click() })
    await settle()
    expect(rowByTitle('1080 px · Male')).toBeUndefined()
  })
})

describe('what the animation shows', () => {
  const ex = EXIDX['0001']   // drawn on both figures: the female drawing is 2476
  it('the chosen pack first; one that will not load hands over to the next, then the built-in file, then the still', async () => {
    mocks.ready.add('anim-720-female'); mocks.ready.add('anim-360-female')
    packs.writePrefs({ choice: 720 })
    await packs.refresh()
    await mount(<Media ex={ex} />)
    expect(img().getAttribute('src')).toBe('app://files/packs/anim-720-female/2476.webp')
    fire(img(), 'error')
    expect(img().getAttribute('src')).toBe('app://files/packs/anim-360-female/2476.webp')
    fire(img(), 'error')
    expect(img().getAttribute('src')).toBe('exercise-media/clip/2476.webp')
    fire(img(), 'error')
    expect(img().getAttribute('src')).toBe('exercise-media/still/2476.webp')
  })
  it('still only shows the still, and a tap does not start anything', async () => {
    packs.writePrefs({ choice: 'still' })
    await packs.refresh()
    await mount(<Media ex={ex} />)
    expect(img().getAttribute('src')).toMatch(/exercise-media\/still\/2476\.webp$/)
    expect(host.querySelector('.gifhint')).toBeNull()
    act(() => { host.querySelector('.exmedia').click() })
    expect(img().getAttribute('src')).toMatch(/still\/2476\.webp$/)
  })
  it('a pack not downloaded yet: the built-in file meanwhile, never a blank', async () => {
    packs.writePrefs({ choice: 1080 })
    await packs.refresh()
    await mount(<Media ex={ex} />)
    expect(img().getAttribute('src')).toBe('exercise-media/clip/2476.webp')
  })
})

describe('sizes and details', () => {
  it('says what a pack takes to download before it is downloaded', async () => {
    await packs.refresh()
    await mount(<AnimationQualitySheet close={() => {}} />)
    const row = rowByTitle('480 px')
    expect(row.textContent).toMatch(/Not downloaded · ~742 MB/)
  })
  it('shows the packs’ details after five taps on the title', async () => {
    await packs.refresh()
    await mount(<AnimationQualitySheet close={() => {}} />)
    expect(host.textContent).not.toContain('Check the packs')
    const h3 = host.querySelector('h3')
    for (let i = 0; i < 5; i++) await act(async () => { h3.click() })
    expect(host.textContent).toContain('Check the packs')
  })
})
