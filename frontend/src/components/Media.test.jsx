// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Media from './Media.jsx'

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

describe('Media with video URL on custom exercises', () => {
  it('renders nothing when custom exercise has no gif and no url', () => {
    act(() => root.render(<Media ex={{ id: 'c1', n: 'Custom' }} />))
    expect(host.querySelector('.exmedia')).toBeFalsy()
  })

  it('renders YouTube thumbnail and toggles to iframe on tap', () => {
    const customYt = { id: 'c1', n: 'Dasds', url: 'https://youtu.be/RJvcR7AAU6o' }
    act(() => root.render(<Media ex={customYt} />))
    const img = host.querySelector('.exmedia img')
    expect(img).toBeTruthy()
    expect(img.src).toContain('RJvcR7AAU6o')
    expect(host.querySelector('.gifhint')).toBeTruthy()

    // tap to play
    act(() => { host.querySelector('.exmedia').click() })
    expect(host.querySelector('iframe')).toBeTruthy()
    expect(host.querySelector('iframe').src).toContain('RJvcR7AAU6o')
  })

  it('renders video element for direct video URLs', () => {
    const customVid = { id: 'c2', n: 'Form check', url: 'https://example.com/squat.mp4' }
    act(() => root.render(<Media ex={customVid} />))
    expect(host.querySelector('video')).toBeTruthy()
    expect(host.querySelector('video').src).toBe('https://example.com/squat.mp4')
  })

  it('renders clickable link tile for general web URLs', () => {
    const customLink = { id: 'c3', n: 'Guide', url: 'https://example.com/guide' }
    act(() => root.render(<Media ex={customLink} />))
    expect(host.querySelector('.exlink-card')).toBeTruthy()
    expect(host.textContent).toContain('Watch video / guide')
    expect(host.textContent).toContain('example.com')
  })

  it('renders Instagram URL as external-link card with platform branding', () => {
    const customIg = { id: 'c4', n: 'IG Reel', url: 'https://www.instagram.com/reel/C_abc123/' }
    act(() => root.render(<Media ex={customIg} />))
    expect(host.querySelector('.exlink-card')).toBeTruthy()
    expect(host.querySelector('.exlink-icon.ig')).toBeTruthy()
    expect(host.textContent).toContain('Watch on Instagram')
    expect(host.textContent).toContain('instagram.com')
    expect(host.querySelector('iframe')).toBeFalsy()
  })

  it('renders TikTok URL as external-link card with platform branding', () => {
    const customTt = { id: 'c5', n: 'TikTok', url: 'https://www.tiktok.com/@gym/video/71234567890' }
    act(() => root.render(<Media ex={customTt} />))
    expect(host.querySelector('.exlink-card')).toBeTruthy()
    expect(host.querySelector('.exlink-icon.tt')).toBeTruthy()
    expect(host.textContent).toContain('Watch on TikTok')
    expect(host.textContent).toContain('tiktok.com')
    expect(host.querySelector('iframe')).toBeFalsy()
  })

  it('renders Vimeo URL as external-link card (no inline embed)', () => {
    const customVimeo = { id: 'c6', n: 'Vimeo', url: 'https://vimeo.com/76979871' }
    act(() => root.render(<Media ex={customVimeo} />))
    expect(host.querySelector('.exlink-card')).toBeTruthy()
    expect(host.textContent).toContain('Watch video / guide')
    expect(host.textContent).toContain('vimeo.com')
    expect(host.querySelector('iframe')).toBeFalsy()
  })
})


