// @vitest-environment happy-dom
// Which Spotify the music bar steers: the openGym account's when the instance offers it, the
// device's own Spotify app when it does not, and "try again" rather than "not connected" when the
// server did not answer.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('../api.js', () => api)
const device = vi.hoisted(() => ({ spotifyNowPlaying: vi.fn(), spotifyControl: vi.fn(), finishSpotify: vi.fn(), spotifyConnected: vi.fn(() => false), APP_REDIRECT: 'opengym://spotify' }))
vi.mock('./spotify.js', () => device)

import { nowPlaying, control, initMusicReturn, shownSource } from './index.js'
import { forgetAccountStatus } from './spotify-account.js'

const refusal = (status, code) => Object.assign(new Error('x'), { status, data: code ? { code } : {} })

beforeEach(() => {
  localStorage.clear()
  forgetAccountStatus()
  api.api.mockReset(); device.spotifyNowPlaying.mockReset(); device.spotifyControl.mockReset()
})

describe('Spotify through the account', () => {
  it('asks the server when the instance offers it and the profile connected it', async () => {
    api.api.mockImplementation(async (p, o) => {
      if (p === '/api/music/spotify') return { available: true, connected: true }
      if (p === '/api/music/spotify/player' && !o) return { track: { id: '1', title: 'Song', playing: true } }
      if (p === '/api/music/spotify/player') return { ok: true }
    })
    expect((await nowPlaying('spotify')).title).toBe('Song')
    await control('spotify', 'next')
    expect(api.api).toHaveBeenLastCalledWith('/api/music/spotify/player', { method: 'POST', body: JSON.stringify({ action: 'next' }) })
    expect(device.spotifyNowPlaying).not.toHaveBeenCalled()
  })

  it('says "not connected" when the profile has not connected yet', async () => {
    api.api.mockResolvedValue({ available: true, connected: false })
    await expect(nowPlaying('spotify')).rejects.toMatchObject({ code: 'auth' })
  })

  it('passes on the server\'s code for a refused control', async () => {
    api.api.mockImplementation(async p => {
      if (p === '/api/music/spotify') return { available: true, connected: true }
      throw refusal(403, 'premium')
    })
    await expect(control('spotify', 'pause')).rejects.toMatchObject({ code: 'premium' })
  })
})

describe('Spotify on the device', () => {
  it('is the way when the instance offers no Spotify', async () => {
    api.api.mockResolvedValue({ available: false, connected: false })
    device.spotifyNowPlaying.mockResolvedValue(null)
    expect(await nowPlaying('spotify')).toBe(null)
    expect(device.spotifyNowPlaying).toHaveBeenCalled()
  })

  it('and when there is no account to ask (a guest)', async () => {
    api.api.mockRejectedValue(refusal(401))
    device.spotifyControl.mockResolvedValue()
    await control('spotify', 'play')
    expect(device.spotifyControl).toHaveBeenCalledWith('play')
  })

  it('but a server that did not answer is a failure to retry, not a switch', async () => {
    api.api.mockResolvedValueOnce({ available: true, connected: true })
    api.api.mockResolvedValueOnce({ track: null })
    await nowPlaying('spotify')
    forgetAccountStatus()
    api.api.mockRejectedValue(Object.assign(new Error('timeout'), { code: 'timeout' }))
    await expect(nowPlaying('spotify')).rejects.toMatchObject({ code: 'failed' })
    expect(device.spotifyNowPlaying).not.toHaveBeenCalled()
  })

  it('while the server is down, a device that used its own Spotify app keeps doing so', async () => {
    api.api.mockResolvedValueOnce({ available: false, connected: false })
    device.spotifyNowPlaying.mockResolvedValue(null)
    await nowPlaying('spotify')
    forgetAccountStatus()
    api.api.mockRejectedValue(Object.assign(new Error('502'), { status: 502 }))
    expect(await nowPlaying('spotify')).toBe(null)
    expect(device.spotifyNowPlaying).toHaveBeenCalledTimes(2)
  })
})

describe('the music bar switch', () => {
  it('turned off, the bar shows no player; the choice is still there for when it is back on', () => {
    expect(shownSource({ music: 'spotify' })).toBe('spotify')
    expect(shownSource({ music: 'spotify', musicBar: false })).toBe('')
    expect(shownSource({ music: 'spotify', musicBar: true })).toBe('spotify')
    expect(shownSource({ musicBar: true })).toBe('')
  })
})

describe('the way back from the account\'s sign-in', () => {
  it('reads ?spotify= off the address and takes it away', () => {
    history.replaceState(null, '', '/?spotify=connected#/settings/features')
    const done = vi.fn()
    initMusicReturn(done)
    expect(done).toHaveBeenCalledWith(true)
    expect(location.search).toBe('')
    expect(location.hash).toBe('#/settings/features')
  })
})
