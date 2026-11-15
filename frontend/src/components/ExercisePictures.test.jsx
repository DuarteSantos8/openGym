// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import ExercisePictures from './ExercisePictures.jsx'
import { loadPictureIndex, picturesFor, resetPictureIndex, PICTURE_BASE } from '../lib/exercise-pictures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const INDEX = {
  '0025': [
    { f: 'files/0042-relaxation.webp', pose: 'start', license: 'CC-BY-SA-4.0', author: 'Jane Doe', source: 'https://example.org/a' },
    { f: 'files/b.webp', license: 'CC0-1.0', author: 'Someone', source: 'https://example.org/b' },
    { f: 'files/c.webp', pose: 'end', license: 'All rights reserved', author: 'X', source: 'https://example.org/c' },
  ],
}
let host, root
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); resetPictureIndex() })
const mount = async ex => act(async () => { root.render(<ExercisePictures ex={ex} load={async () => INDEX} />) })

describe('extra exercise pictures (free licences, credited)', () => {
  it('shows each picture with its author, licence link and source, and drops unknown licences', async () => {
    await mount({ id: '0025', name: 'barbell bench press' })
    const imgs = host.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0].getAttribute('src')).toBe(PICTURE_BASE + 'files/0042-relaxation.webp')
    expect(imgs[0].getAttribute('loading')).toBe('lazy')
    expect(imgs[0].getAttribute('alt')).toMatch(/start position$/)
    expect(imgs[1].getAttribute('alt')).toMatch(/2$/)
    const caps = [...host.querySelectorAll('figcaption')].map(c => c.textContent)
    expect(caps[0]).toContain('Start position')
    expect(caps[0]).toContain('Jane Doe')
    expect(caps[0]).toContain('CC BY-SA 4.0')
    expect(caps[1]).toContain('CC0 1.0')
    const lic = host.querySelector('figcaption a')
    expect(lic.getAttribute('href')).toBe('https://creativecommons.org/licenses/by-sa/4.0/')
    expect(lic.getAttribute('rel')).toContain('noopener')
  })

  it('renders nothing for an exercise without pictures or for your own exercise', async () => {
    await mount({ id: '9999', name: 'nothing here' })
    expect(host.innerHTML).toBe('')
    await mount({ id: 'c_1', name: 'mine', custom: true })
    expect(host.innerHTML).toBe('')
  })

  it('loads the index once, from this origin, and survives a missing or HTML answer', async () => {
    const calls = []
    const html = async url => { calls.push(url); return { ok: true, json: async () => { throw new SyntaxError('<!doctype') } } }
    expect(await loadPictureIndex(html)).toEqual({})
    expect(await loadPictureIndex(html)).toEqual({})
    expect(calls).toEqual([PICTURE_BASE + 'index.json'])
    expect(PICTURE_BASE.startsWith('http')).toBe(false)
    resetPictureIndex()
    expect(await loadPictureIndex(async () => ({ ok: false }))).toEqual({})
    resetPictureIndex()
    expect(await loadPictureIndex(async () => { throw new TypeError('offline') })).toEqual({})
  })

  it('picturesFor ignores malformed entries', () => {
    expect(picturesFor({ a: [null, { f: 1, license: 'CC0-1.0' }, { f: 'x', license: 'CC0-1.0' }] }, 'a')).toHaveLength(1)
    expect(picturesFor({ a: 'nope' }, 'a')).toEqual([])
    expect(picturesFor(null, 'a')).toEqual([])
  })
})
