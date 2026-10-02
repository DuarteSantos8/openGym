import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { normalizeMediaRef, referencedHashes, referencedFiles, cleanUrl, linkKind, mediaOf, fmtClip, HASH_RE } from './media-refs.js'

const A = 'a'.repeat(64)
const B = 'b'.repeat(64)
const C = 'c'.repeat(64)
const ref = over => ({ kind: 'image', hash: A, mime: 'image/webp', size: 1000, width: 800, height: 600, poster: { hash: B, mime: 'image/webp', size: 100, width: 480, height: 360 }, at: 1, ...over })

describe('normalizeMediaRef', () => {
  it('keeps a well-formed ref and nothing else of it', () => {
    expect(normalizeMediaRef({ ...ref(), name: 'IMG_0001.HEIC', gps: '47.3,8.5' })).toEqual(ref())
  })

  it('refuses a bad hash, a mime outside the list, and a kind that does not match the mime', () => {
    expect(normalizeMediaRef(ref({ hash: 'A'.repeat(64) }))).toBeNull()
    expect(normalizeMediaRef(ref({ hash: A.slice(1) }))).toBeNull()
    expect(normalizeMediaRef(ref({ mime: 'image/svg+xml' }))).toBeNull()
    expect(normalizeMediaRef(ref({ mime: 'text/html' }))).toBeNull()
    expect(normalizeMediaRef(ref({ kind: 'video' }))).toBeNull()
    expect(normalizeMediaRef(ref({ kind: 'gif' }))).toBeNull()
    expect(normalizeMediaRef(ref({ kind: 'gif', mime: 'image/gif' }))).not.toBeNull()
  })

  it('refuses sizes, dimensions and lengths out of range', () => {
    expect(normalizeMediaRef(ref({ size: 0 }))).toBeNull()
    expect(normalizeMediaRef(ref({ size: 200 * 1024 * 1024 + 1 }))).toBeNull()
    expect(normalizeMediaRef(ref({ size: 1.5 }))).toBeNull()
    expect(normalizeMediaRef(ref({ width: 0 }))).toBeNull()
    expect(normalizeMediaRef(ref({ height: 16385 }))).toBeNull()
    expect(normalizeMediaRef(ref({ kind: 'video', mime: 'video/mp4', dur: 3601 }))).toBeNull()
    expect(normalizeMediaRef(ref({ kind: 'video', mime: 'video/mp4', dur: -1 }))).toBeNull()
    expect(normalizeMediaRef(ref({ kind: 'video', mime: 'video/mp4', dur: 'long' }))).toBeNull()
    expect(normalizeMediaRef(ref({ kind: 'video', mime: 'video/mp4', dur: 12.345 })).dur).toBe(12.3)
  })

  it('knows the codecs, other included, and only on a video', () => {
    for (const codec of ['avc1', 'hvc1', 'av01', 'vp09', 'vp8', 'vp9', 'other']) {
      expect(normalizeMediaRef(ref({ kind: 'video', mime: 'video/mp4', codec }))?.codec).toBe(codec)
    }
    expect(normalizeMediaRef(ref({ kind: 'video', mime: 'video/mp4', codec: 'mjpeg' }))).toBeNull()
    expect(normalizeMediaRef(ref({ codec: 'avc1' }))).toBeNull()
  })

  it('drops a malformed poster and keeps the main file', () => {
    const r = normalizeMediaRef(ref({ poster: { hash: B, mime: 'image/gif', size: 1, width: 1, height: 1 } }))
    expect(r.hash).toBe(A)
    expect(r.poster).toBeUndefined()
    expect(normalizeMediaRef(ref({ poster: { hash: 'x' } })).poster).toBeUndefined()
  })

  it('treats anything that is not an object as no media', () => {
    for (const v of [null, undefined, 3, 'x', [], [ref()]]) expect(normalizeMediaRef(v)).toBeNull()
    expect(mediaOf({ media: ref() })).toEqual(ref())
    expect(mediaOf({})).toBeNull()
    expect(mediaOf(null)).toBeNull()
  })
})

describe('referencedHashes', () => {
  // The same answers as api/media.js referencedHashes: the server keeps and the client keeps the
  // same set. The fixture is the api tests' own.
  const fixture = JSON.parse(readFileSync(new URL('../../../api/test/fixtures/media-refs.json', import.meta.url), 'utf8'))
  for (const c of fixture.referencedHashes) {
    it(`parity: ${c.name}`, () => {
      expect([...referencedHashes(c.state)].sort()).toEqual([...c.expect].sort())
    })
  }

  it('lists the files posters first, each once, with what the state says of them', () => {
    const S = { customEx: [
      { id: 'x', media: ref() },
      { id: 'y', media: ref({ hash: C, poster: { hash: B, mime: 'image/webp', size: 100, width: 480, height: 360 } }) },
      { id: 'z', media: { hash: 'nope' } }
    ] }
    expect(referencedFiles(S)).toEqual([
      { hash: B, mime: 'image/webp', size: 100, poster: true },
      { hash: A, mime: 'image/webp', size: 1000, poster: false },
      { hash: C, mime: 'image/webp', size: 1000, poster: false }
    ])
  })

  it('a small photo whose poster is the file itself is listed once', () => {
    const S = { customEx: [{ id: 'x', media: ref({ poster: { hash: A, mime: 'image/webp', size: 1000, width: 400, height: 300 } }) }] }
    expect(referencedFiles(S).map(f => f.hash)).toEqual([A])
  })
})

describe('cleanUrl', () => {
  // #246's cases.
  it('accepts http and https links as they are', () => {
    expect(cleanUrl('https://www.youtube.com/watch?v=123')).toBe('https://www.youtube.com/watch?v=123')
    expect(cleanUrl('http://example.com/guide')).toBe('http://example.com/guide')
  })
  it('puts https:// in front of a bare address', () => {
    expect(cleanUrl('youtube.com/watch?v=123')).toBe('https://youtube.com/watch?v=123')
    expect(cleanUrl('www.vimeo.com/456')).toBe('https://www.vimeo.com/456')
    expect(cleanUrl('  youtu.be/abc  ')).toBe('https://youtu.be/abc')
  })
  it('refuses other schemes, whatever the case', () => {
    for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<h1>hi</h1>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'mailto:a@b.c', 'intent://x#Intent;end', 'blob:https://x/y']) {
      expect(cleanUrl(u), u).toBeNull()
    }
  })
  it('refuses empty strings and anything that is not a string', () => {
    for (const u of ['', '   ', null, undefined, 3, {}, ['https://x.com']]) expect(cleanUrl(u)).toBeNull()
  })
  it('refuses a link with a user name or password in it', () => {
    expect(cleanUrl('https://user:secret@example.com/x')).toBeNull()
    expect(cleanUrl('https://user@example.com/x')).toBeNull()
  })
  it('refuses a link over 2048 characters', () => {
    expect(cleanUrl('https://example.com/' + 'a'.repeat(2020))).toBe('https://example.com/' + 'a'.repeat(2020))
    expect(cleanUrl('https://example.com/' + 'a'.repeat(2100))).toBeNull()
  })
  it('refuses what does not parse', () => {
    expect(cleanUrl('https://exa mple.com')).toBeNull()
    expect(cleanUrl('https://')).toBeNull()
  })
  // QA 1.3.9: Chrome parses "https://not a url" (the spaces go into the host as %20), so a
  // sentence typed into the link field was saved as a link.
  it('wants a host a browser could reach: no spaces, a dotted name, localhost or an IP', () => {
    for (const u of ['not a url', 'https://not a url', 'hello', 'https://hello', 'http://a..b', 'https://-x.com', 'https://x%20y.com']) {
      expect(cleanUrl(u), u).toBeNull()
    }
    expect(cleanUrl('http://localhost:8080/x')).toBe('http://localhost:8080/x')
    expect(cleanUrl('http://192.168.1.10/guide')).toBe('http://192.168.1.10/guide')
    expect(cleanUrl('http://[::1]:3000/')).toBe('http://[::1]:3000/')
    expect(cleanUrl('https://müller.de/x')).toBe('https://xn--mller-kva.de/x')
    expect(cleanUrl('example.com./x')).toBe('https://example.com./x')
  })
})

describe('linkKind', () => {
  it('calls the big video sites video, their subdomains included, and everything else a link', () => {
    for (const u of ['https://www.youtube.com/watch?v=x', 'youtu.be/x', 'https://m.youtube.com/shorts/x', 'https://vimeo.com/1', 'https://www.tiktok.com/@a/video/1', 'https://www.instagram.com/reel/x']) {
      expect(linkKind(u), u).toBe('video')
    }
    expect(linkKind('https://exrx.net/WeightExercises')).toBe('link')
    expect(linkKind('https://notyoutube.com/x')).toBe('link')
    expect(linkKind('https://youtube.com.evil.example/x')).toBe('link')
    expect(linkKind('javascript:alert(1)')).toBeNull()
  })
})

describe('small helpers', () => {
  it('writes a clip length as m:ss', () => {
    expect(fmtClip(7)).toBe('0:07')
    expect(fmtClip(65.4)).toBe('1:05')
    expect(fmtClip(undefined)).toBe('0:00')
  })
  it('matches only lowercase sha256 hex', () => {
    expect(HASH_RE.test(A)).toBe(true)
    expect(HASH_RE.test(A.toUpperCase())).toBe(false)
  })
})
