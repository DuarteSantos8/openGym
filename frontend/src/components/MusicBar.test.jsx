// @vitest-environment happy-dom
// The music bar of a workout: what plays, the buttons, and a sentence instead of the song when
// the player cannot be reached. The players themselves are stand-ins (lib/music/spotify.test.js
// covers Spotify's side; Apple Music needs an iPhone).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const music = vi.hoisted(() => ({ nowPlaying: vi.fn(), control: vi.fn() }))
vi.mock('../lib/music/index.js', () => music)

import MusicBar from './MusicBar.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  music.nowPlaying.mockReset(); music.control.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = async () => { await act(async () => { root.render(<MusicBar source="spotify" />) }) }
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const btn = label => host.querySelector(`[aria-label="${label}"]`)

describe('MusicBar', () => {
  it('shows what plays and pauses it, answering at once', async () => {
    music.nowPlaying.mockResolvedValue({ id: '1', playing: true, title: 'Song', artist: 'Band', art: '' })
    music.control.mockResolvedValue()
    await mount()
    expect(host.querySelector('.mb-title').textContent).toBe('Song')
    expect(host.querySelector('.mb-sub').textContent).toBe('Band')
    await act(async () => { btn('Pause').click() })
    expect(music.control).toHaveBeenCalledWith('spotify', 'pause')
    expect(btn('Play music')).toBeTruthy()
  })

  it('says when nothing plays, and still offers play', async () => {
    music.nowPlaying.mockResolvedValue(null)
    await mount()
    expect(host.querySelector('.mb-title').textContent).toBe('Nothing playing')
    expect(btn('Play music')).toBeTruthy()
  })

  it('sends to Settings when Spotify is not connected on this device, without buttons', async () => {
    music.nowPlaying.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth' }))
    await mount()
    await flush()
    expect(host.querySelector('.mb-sub').textContent).toBe('Connect Spotify in Settings → Features.')
    expect(btn('Next track')).toBe(null)
  })

  it('docked on every page, a player not connected yet hides the bar and tells the dock', async () => {
    music.nowPlaying.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth' }))
    const onBlocked = vi.fn()
    await act(async () => { root.render(<MusicBar source="spotify" onBlocked={onBlocked} hideBlocked />) })
    await flush()
    expect(host.innerHTML).toBe('')
    expect(onBlocked).toHaveBeenLastCalledWith(true)
  })

  it('says the player did not answer rather than stand empty, and keeps a song it already had', async () => {
    music.nowPlaying.mockRejectedValue(Object.assign(new Error('x'), { code: 'failed' }))
    await mount()
    await flush()
    expect(host.querySelector('.mb-title').textContent).toBe('Spotify')
    expect(host.querySelector('.mb-sub').textContent).toBe('The music player did not answer.')
    music.nowPlaying.mockResolvedValue({ id: '1', playing: true, title: 'Song', artist: 'Band', art: '' })
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(host.querySelector('.mb-title').textContent).toBe('Song')
    music.nowPlaying.mockRejectedValue(Object.assign(new Error('x'), { code: 'failed' }))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await flush()
    expect(host.querySelector('.mb-title').textContent).toBe('Song')
    expect(host.querySelector('.mb-sub').textContent).toBe('Band')
  })

  it('says Premium is needed when a control is refused', async () => {
    music.nowPlaying.mockResolvedValue({ id: '1', playing: false, title: 'Song', artist: 'Band', art: '' })
    music.control.mockRejectedValue(Object.assign(new Error('x'), { code: 'premium' }))
    await mount()
    await act(async () => { btn('Next track').click() })
    await flush()
    expect(host.querySelector('.mb-sub').textContent).toBe('Spotify Premium is needed to control the music.')
  })
})
