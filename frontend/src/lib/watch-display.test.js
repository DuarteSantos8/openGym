import { describe, expect, it, vi } from 'vitest'
import { watchDisplayOf } from './watch-display.js'
import { watchThumbnailFor, syncWatchThumbnails } from './watch-thumbnails.js'

vi.mock('./media-store.js', () => ({ mediaStore: { get: vi.fn(async () => null) } }))
vi.mock('./media-sync.js', () => ({ fetchToStore: vi.fn(), mayFetch: () => false }))

describe('Watch display compatibility', () => {
  it('gives old profiles the digital green clock without modifying them', () => {
    const profile = { unit: 'kg' }
    expect(watchDisplayOf(profile)).toEqual({ timerFont: 'segments', timerColor: '#a3e635' })
    expect(profile).toEqual({ unit: 'kg' })
  })
  it('retains supported choices and rejects invalid values from imported profiles', () => {
    expect(watchDisplayOf({ watchDisplay: { timerFont: 'mono', timerColor: '#ffffff' } }))
      .toEqual({ timerFont: 'mono', timerColor: '#ffffff' })
    expect(watchDisplayOf({ watchDisplay: { timerFont: 'missing', timerColor: 'invalid' } }))
      .toEqual({ timerFont: 'segments', timerColor: '#a3e635' })
  })
})

describe('Watch still thumbnails', () => {
  const poster = { hash: 'b'.repeat(64), mime: 'image/jpeg', size: 1000, width: 96, height: 96 }
  it('uses the still photograph for a built-in animated exercise', () => {
    const thumbnail = watchThumbnailFor({ id: 'a', img: 'a.jpg', gif: 'a.gif' })
    expect(thumbnail.url).toMatch(/a\.jpg$/)
    expect(thumbnail.key).not.toContain('a.gif')
  })
  it('transfers a video poster rather than the video', () => {
    const media = { kind: 'video', hash: 'a'.repeat(64), mime: 'video/mp4', size: 10000,
      width: 320, height: 320, dur: 5, poster }
    expect(watchThumbnailFor({ custom: true, media })).toEqual({ key: `custom:${poster.hash}`, file: poster })
  })
  it('retains a placeholder for links and missing media', () => {
    expect(watchThumbnailFor({ custom: true, url: 'https://example.com/video' })).toBeNull()
    expect(watchThumbnailFor({ id: 'no-picture' })).toBeNull()
  })
  it('sends only unacknowledged images and tolerates an unavailable image', async () => {
    const native = { missingThumbnails: vi.fn(async () => ({ missing: ['second', 'third'] })),
      sendThumbnail: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({}) }
    await syncWatchThumbnails(native, { getState: () => ({}) }, [
      { key: 'first', url: 'https://example.com/1.jpg' },
      { key: 'second', url: 'https://example.com/2.jpg' },
      { key: 'third', url: 'https://example.com/3.jpg' },
    ])
    expect(native.sendThumbnail.mock.calls.map(([item]) => item.key)).toEqual(['second', 'third'])
  })
})
