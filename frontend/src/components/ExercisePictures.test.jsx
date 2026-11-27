// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExercisePictures from './ExercisePictures.jsx'
import { loadPictureIndex, mediaFor, picturesFor, resetPictureIndex, PICTURE_BASE, DEMO_BASE } from '../lib/exercise-pictures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const P = PICTURE_BASE, D = DEMO_BASE
const INDEX = {
  '0025': [
    { base: D, kind: 'video', f: 'files/small.mp4', poster: 'files/small.webp', w: 640, h: 360, license: 'CC-BY-3.0', author: 'Small', source: 'https://example.org/s' },
    { base: D, kind: 'video', f: 'files/video-0025.mp4', poster: 'files/video-0025.webp', w: 720, h: 1280, license: 'CC-BY-SA-4.0', author: 'Your Move', source: 'https://example.org/v' },
    { base: D, kind: 'image', pose: 'sequence', f: 'files/atp-14-6.webp', caption: 'Figure 14-6. FW4 Bench Press', license: 'PD-USGov', author: 'U.S. Army (ATP 7-22.02)', source: 'https://example.org/atp' },
    { base: P, f: 'files/0042-tension.webp', pose: 'end', license: 'CC-BY-SA-4.0', author: 'Jane Doe', source: 'https://example.org/b' },
    { base: P, f: 'files/0042-relaxation.webp', pose: 'start', license: 'CC-BY-SA-4.0', author: 'Jane Doe', source: 'https://example.org/a' },
    { base: P, f: 'files/c.webp', pose: 'end', license: 'All rights reserved', author: 'X', source: 'https://example.org/c' },
    { base: D, kind: 'video', f: 'files/x.webm', license: 'CC0-1.0', author: 'Y', source: 'https://example.org/y' },
  ],
  '0662': [{ base: P, f: 'files/only.webp', license: 'CC0-1.0', author: 'Someone', source: 'https://example.org/o' }],
}
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); resetPictureIndex() })
const mount = async ex => act(async () => { root.render(<ExercisePictures ex={ex} load={async () => INDEX} />) })
const caps = () => [...host.querySelectorAll('figcaption')].map(c => c.textContent)

describe('how-to media on the exercise sheet (free licences, credited)', () => {
  it('shows the sharpest video, then the whole movement, then numbered steps start to end', async () => {
    await mount({ id: '0025', name: 'barbell bench press' })
    const videos = host.querySelectorAll('video')
    expect(videos).toHaveLength(1)
    expect(videos[0].getAttribute('src')).toBe(D + 'files/video-0025.mp4')
    expect(videos[0].getAttribute('poster')).toBe(D + 'files/video-0025.webp')
    expect(videos[0].hasAttribute('muted') || videos[0].muted).toBe(true)
    expect(videos[0].getAttribute('preload')).toBe('none')
    const imgs = [...host.querySelectorAll('img')]
    expect(imgs.map(i => i.getAttribute('src'))).toEqual([D + 'files/atp-14-6.webp', P + 'files/0042-relaxation.webp', P + 'files/0042-tension.webp'])
    expect(imgs.every(i => i.getAttribute('loading') === 'lazy')).toBe(true)
    expect(imgs[1].getAttribute('alt')).toMatch(/step 1: start position$/)
    expect(imgs[2].getAttribute('alt')).toMatch(/step 2: end position$/)
    const c = caps()
    expect(c[0]).toContain('Your Move')
    expect(c[0]).toContain('CC BY-SA 4.0')
    expect(c[1]).toContain('Figure 14-6')
    expect(c[1]).toContain('Public domain')
    expect(c[2]).toContain('Step 1 · Start position')
    expect(c[3]).toContain('Step 2 · End position')
    const lic = host.querySelector('figcaption a')
    expect(lic.getAttribute('href')).toBe('https://creativecommons.org/licenses/by-sa/4.0/')
    expect(lic.getAttribute('rel')).toContain('noopener')
    expect(host.textContent).not.toContain('All rights reserved')
  })

  it('numbers pictures without a pose as steps', async () => {
    await mount({ id: '0662', name: 'push-up' })
    expect(host.querySelector('video')).toBeNull()
    expect(host.querySelector('img').getAttribute('alt')).toMatch(/step 1$/)
    expect(caps()[0]).toContain('Step 1')
  })

  it('renders nothing for an exercise without media or for your own exercise', async () => {
    await mount({ id: '9999', name: 'nothing here' })
    expect(host.innerHTML).toBe('')
    await mount({ id: 'c_1', name: 'mine', custom: true })
    expect(host.innerHTML).toBe('')
  })

  it('loads both indexes once, from this origin, merged, and survives a missing or HTML answer', async () => {
    const calls = []
    const html = async url => { calls.push(url); return { ok: true, json: async () => { throw new SyntaxError('<!doctype') } } }
    expect(await loadPictureIndex(html)).toEqual({})
    expect(await loadPictureIndex(html)).toEqual({})
    expect(calls.sort()).toEqual([D + 'index.json', P + 'index.json'].sort())
    expect(P.startsWith('http') || D.startsWith('http')).toBe(false)
    resetPictureIndex()
    const both = async url => ({ ok: true, json: async () => (url.startsWith(D) ? { a: [{ f: 'v.mp4', kind: 'video', license: 'CC0-1.0' }] } : { a: [{ f: 'p.webp', license: 'CC0-1.0' }], b: 'nope' }) })
    const merged = await loadPictureIndex(both)
    expect(merged.a.map(p => p.base + p.f)).toEqual([D + 'v.mp4', P + 'p.webp'])
    expect(merged.b).toBeUndefined()
    resetPictureIndex()
    expect(await loadPictureIndex(async () => ({ ok: false }))).toEqual({})
    resetPictureIndex()
    expect(await loadPictureIndex(async () => { throw new TypeError('offline') })).toEqual({})
  })

  it('picturesFor and mediaFor ignore malformed entries', () => {
    expect(picturesFor({ a: [null, { f: 1, license: 'CC0-1.0' }, { f: 'x', license: 'CC0-1.0' }] }, 'a')).toHaveLength(1)
    expect(picturesFor({ a: 'nope' }, 'a')).toEqual([])
    expect(picturesFor(null, 'a')).toEqual([])
    expect(mediaFor({ a: [{ kind: 'video', f: 'x.webm', license: 'CC0-1.0' }] }, 'a')).toEqual({ video: null, sequences: [], steps: [] })
  })
})
