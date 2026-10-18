// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  spotifyAuthUrl, finishSpotify, spotifyConnected, disconnectSpotify, spotifyNowPlaying, spotifyControl, trackOf, redirectUri,
} from './spotify.js'

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) })

beforeEach(() => { localStorage.clear() })

async function signIn(fetchFn) {
  const url = new URL(await spotifyAuthUrl('abc123abc123abc123'))
  const state = url.searchParams.get('state')
  return finishSpotify('?code=CODE&state=' + state, fetchFn)
}

describe('Spotify sign-in', () => {
  it('asks for a PKCE code with the playback scopes and this page as the way back', async () => {
    const url = new URL(await spotifyAuthUrl('abc123abc123abc123'))
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(url.searchParams.get('client_id')).toBe('abc123abc123abc123')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('scope')).toContain('user-modify-playback-state')
    expect(url.searchParams.get('redirect_uri')).toBe(redirectUri())
  })

  it('trades the code for tokens, with the verifier it kept', async () => {
    const fetchFn = vi.fn(async () => json(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600 }))
    expect(await signIn(fetchFn)).toBe(true)
    const body = new URLSearchParams(fetchFn.mock.calls[0][1].body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('CODE')
    expect(body.get('code_verifier')).toHaveLength(64)
    expect(spotifyConnected()).toBe(true)
    disconnectSpotify()
    expect(spotifyConnected()).toBe(false)
  })

  it('ignores an address that is not its own answer', async () => {
    await spotifyAuthUrl('abc123abc123abc123')
    const fetchFn = vi.fn()
    expect(await finishSpotify('?code=X&state=someone-else', fetchFn)).toBe(false)
    expect(await finishSpotify('?link=abc', fetchFn)).toBe(false)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('throws when the person said no', async () => {
    const url = new URL(await spotifyAuthUrl('abc123abc123abc123'))
    await expect(finishSpotify('?error=access_denied&state=' + url.searchParams.get('state'))).rejects.toThrow('access_denied')
    expect(spotifyConnected()).toBe(false)
  })
})

describe('Spotify player', () => {
  it('reads what plays, with the smallest cover of 64 px or more', () => {
    expect(trackOf({
      is_playing: true,
      item: { id: 't1', name: 'Song', artists: [{ name: 'A' }, { name: 'B' }], album: { images: [{ url: 'big', width: 640 }, { url: 'mid', width: 300 }, { url: 'small', width: 64 }] } },
    })).toEqual({ id: 't1', playing: true, title: 'Song', artist: 'A, B', art: 'small' })
  })

  it('says nothing plays on a 204', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600 }))
      .mockResolvedValueOnce({ ok: true, status: 204 })
    await signIn(fetchFn)
    expect(await spotifyNowPlaying(fetchFn)).toBe(null)
    expect(fetchFn.mock.calls[1][1].headers.Authorization).toBe('Bearer A')
  })

  it('refreshes an expired token and keeps the refresh token Spotify did not replace', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: 'A', refresh_token: 'R', expires_in: 0 }))
      .mockResolvedValueOnce(json(200, { access_token: 'B', expires_in: 3600 }))
      .mockResolvedValueOnce({ ok: true, status: 204 })
    await signIn(fetchFn)
    await spotifyNowPlaying(fetchFn)
    expect(new URLSearchParams(fetchFn.mock.calls[1][1].body).get('refresh_token')).toBe('R')
    expect(fetchFn.mock.calls[2][1].headers.Authorization).toBe('Bearer B')
    expect(JSON.parse(localStorage.getItem('og.spotify')).refresh).toBe('R')
  })

  it('names why a control failed: Premium, or no device', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: 'A', refresh_token: 'R', expires_in: 3600 }))
      .mockResolvedValueOnce(json(403, {}))
      .mockResolvedValueOnce(json(404, {}))
    await signIn(fetchFn)
    await expect(spotifyControl('next', fetchFn)).rejects.toMatchObject({ code: 'premium' })
    await expect(spotifyControl('play', fetchFn)).rejects.toMatchObject({ code: 'device' })
    expect(fetchFn.mock.calls[1][0]).toBe('https://api.spotify.com/v1/me/player/next')
    expect(fetchFn.mock.calls[1][1].method).toBe('POST')
    expect(fetchFn.mock.calls[2][1].method).toBe('PUT')
  })

  it('asks to sign in again when Spotify no longer knows the refresh token', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json(200, { access_token: 'A', refresh_token: 'R', expires_in: 0 }))
      .mockResolvedValueOnce(json(400, { error: 'invalid_grant' }))
    await signIn(fetchFn)
    await expect(spotifyNowPlaying(fetchFn)).rejects.toMatchObject({ code: 'auth' })
    expect(spotifyConnected()).toBe(false)
  })
})
