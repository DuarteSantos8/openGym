import { describe, it, expect } from 'vitest'
import {
  avatarOf, initialOf, setAvatarPhoto, setAvatarPreset, clearAvatar, sanitizeAvatar, AVATAR_PRESETS,
  clampCrop, sourceRect, zoomAround, coverScale, hasImageMetadata, openAvatarImage, renderAvatar,
  AVATAR_EDGE, AVATAR_MAX_BYTES, ZOOM_MAX
} from './avatar.js'
import { referencedHashes, uploadableFiles, keptHashes } from './media-refs.js'
import { stampEdits, mergeStates } from './sync-merge.js'
import { exportBackupZip, readBackupFile, storeBackupMedia } from './backup-media.js'
import { createMediaStore, memoryBackend } from './media-store.js'
import { sha256Hex } from './sha256.js'
import { bytes, latin1, jpeg, webpVp8 } from './media-samples.test-util.js'

const H = c => c.repeat(64)
const ref = (hash = H('a'), extra = {}) => ({ kind: 'image', hash, mime: 'image/webp', size: 12000, width: 256, height: 256, at: 5, ...extra })

// A JPEG as a phone writes it: SOI, an APP1 Exif segment with a GPS tag in it, then the frame.
const u16be = n => [(n >> 8) & 255, n & 255]
function jpegWithGps() {
  const exif = bytes('Exif', [0, 0], 'MM', [0, 42], [0, 0, 0, 8], 'GPSLatitude 47.3769 N GPSLongitude 8.5417 E')
  return bytes([0xff, 0xd8, 0xff, 0xe1], u16be(exif.length + 2), exif, jpeg(640, 480).subarray(2))
}
const webpWithExif = () => bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [8, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'EXIF', [6, 0, 0, 0], 'GPS!!!')

/* A canvas that records what was drawn and "encodes" to fixed bytes, as a browser's would: what
   comes out depends only on the pixels, never on the file that was picked. */
function fakeDeps({ out = webpVp8(256, 256), sizes = null } = {}) {
  const drawn = []
  let n = 0
  const doc = {
    createElement: () => {
      const c = { width: 0, height: 0, getContext: () => ({ drawImage: (...a) => drawn.push({ canvas: c, args: a }) }) }
      return c
    }
  }
  const encodeImage = async (pic, edge, q) => {
    const size = sizes ? sizes[Math.min(n++, sizes.length - 1)] : out.length
    const b = size === out.length ? out : bytes(out, new Uint8Array(Math.max(0, size - out.length)))
    return { blob: new Blob([b], { type: 'image/webp' }), mime: 'image/webp', width: edge, height: edge, q }
  }
  const decodeImage = async () => ({ source: { decoded: true }, width: 4000, height: 3000, close() { this.closed = true } })
  return { doc, encodeImage, decodeImage, drawn }
}

describe('the avatar in the state', () => {
  it('reads a photo, a preset, and nothing else', () => {
    expect(avatarOf({})).toBe(null)
    expect(avatarOf({ avatar: { m: ref() } })).toEqual({ type: 'photo', m: ref() })
    expect(avatarOf({ avatar: { preset: 'flame' } })).toMatchObject({ type: 'preset', id: 'flame', icon: 'flame' })
    expect(avatarOf({ avatar: { preset: 'no-such' } })).toBe(null)
    expect(avatarOf({ avatar: { m: ref('nope') } })).toBe(null)
    expect(avatarOf({ avatar: { m: { ...ref(), kind: 'video', mime: 'video/mp4' } } })).toBe(null)
    expect(avatarOf({ avatar: 'x' })).toBe(null)
  })
  it('sets, replaces and clears it on a draft', () => {
    const s = {}
    setAvatarPreset(s, 'rocket')
    expect(s.avatar).toEqual({ preset: 'rocket' })
    setAvatarPhoto(s, ref())
    expect(s.avatar).toEqual({ m: ref() })
    setAvatarPreset(s, 'bogus')
    expect(s.avatar).toEqual({ m: ref() })
    clearAvatar(s)
    expect('avatar' in s).toBe(false)
    expect(new Set(AVATAR_PRESETS.map(p => p.id)).size).toBe(AVATAR_PRESETS.length)
  })
  it('falls back to the first letter, emoji and accents included', () => {
    expect(initialOf('ana')).toBe('A')
    expect(initialOf('  élise ')).toBe('É')
    expect(initialOf('😀 Bo')).toBe('😀')
    expect(initialOf('')).toBe(null)
    expect(initialOf(null)).toBe(null)
  })
})

describe('the crop', () => {
  const pic = { width: 1200, height: 800 }
  it('covers the viewport at zoom 1, centred', () => {
    expect(coverScale(pic, 200)).toBe(0.25)
    expect(sourceRect(pic, 200, { x: 0, y: 0, zoom: 1 })).toEqual({ sx: 200, sy: 0, side: 800 })
  })
  it('never lets the picture leave the circle, and keeps the zoom in range', () => {
    expect(clampCrop(pic, 200, { x: 999, y: 999, zoom: 1 })).toEqual({ x: 50, y: 0, zoom: 1 })
    expect(clampCrop(pic, 200, { x: -999, y: 0, zoom: 1 }).x).toBe(-50)
    expect(clampCrop(pic, 200, { zoom: 99 }).zoom).toBe(ZOOM_MAX)
    expect(clampCrop(pic, 200, { zoom: 0.1 }).zoom).toBe(1)
    const r = sourceRect(pic, 200, { x: 999, y: -999, zoom: 2 })
    expect(r.sx).toBeGreaterThanOrEqual(0)
    expect(r.sy + r.side).toBeLessThanOrEqual(800)
    expect(r.side).toBe(400)
  })
  it('zooms around the fingers: the point under them stays put', () => {
    const c0 = { x: 0, y: 0, zoom: 1 }
    const c1 = zoomAround(pic, 200, c0, 2, 40, 20)
    const before = sourceRect(pic, 200, c0), after = sourceRect(pic, 200, c1)
    const at = (r, px, py) => [r.sx + (px + 100) * r.side / 200, r.sy + (py + 100) * r.side / 200]
    expect(at(after, 40, 20)[0]).toBeCloseTo(at(before, 40, 20)[0], 6)
    expect(at(after, 40, 20)[1]).toBeCloseTo(at(before, 40, 20)[1], 6)
  })
})

describe('no metadata leaves the device', () => {
  it('spots EXIF, XMP and comments in what an encoder handed back, and lets the sRGB profile be', () => {
    const icc = bytes([0xff, 0xd8, 0xff, 0xe2, 0, 16], 'ICC_PROFILE', [0, 1, 0], [0xff, 0xda, 0, 2])
    expect(hasImageMetadata(icc)).toBe(false)
    const mpf = bytes([0xff, 0xd8, 0xff, 0xe2, 0, 8], 'MPF', [0, 0, 0], [0xff, 0xda, 0, 2])
    expect(hasImageMetadata(mpf)).toBe(true)
    const webpIcc = bytes('RIFF', [0, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0x20, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'ICCP', [4, 0, 0, 0], 'sRGB', 'VP8 ', [0, 0, 0, 0])
    expect(hasImageMetadata(webpIcc)).toBe(false)
    expect(hasImageMetadata(jpegWithGps())).toBe(true)
    expect(hasImageMetadata(jpeg())).toBe(true)   // the shared sample carries an APP1 Exif
    const jfif = bytes([0xff, 0xd8, 0xff, 0xe0], u16be(16), 'JFIF', [0, 1, 1, 0, 0, 1, 0, 1, 0, 0], [0xff, 0xc0], u16be(17), [8, 1, 0, 1, 0, 3], new Uint8Array(9), [0xff, 0xda, 0, 2])
    expect(hasImageMetadata(jfif)).toBe(false)
    expect(hasImageMetadata(webpWithExif())).toBe(true)
    expect(hasImageMetadata(webpVp8())).toBe(false)
    const comment = bytes([0xff, 0xd8, 0xff, 0xfe, 0, 6], 'hey!', [0xff, 0xda, 0, 2])
    expect(hasImageMetadata(comment)).toBe(true)
  })

  it('stores only the re-drawn square: a 256 px WebP under the cap, never the picked bytes', async () => {
    const d = fakeDeps()
    const file = new Blob([jpegWithGps()], { type: 'image/jpeg' })
    const pic = await openAvatarImage(file, d)
    expect(pic.width).toBe(1280)
    expect(pic.height).toBe(960)
    const out = await renderAvatar(pic, 264, { x: 0, y: 0, zoom: 1.5 }, d)
    const stored = new Uint8Array(await out.blob.arrayBuffer())
    expect(stored).toEqual(webpVp8(256, 256))
    expect(String.fromCharCode(...stored)).not.toMatch(/Exif|GPS/)
    expect(out.blob.size).toBeLessThanOrEqual(AVATAR_MAX_BYTES)
    expect(out.media).toMatchObject({ kind: 'image', mime: 'image/webp', width: AVATAR_EDGE, height: AVATAR_EDGE, size: stored.length })
    expect(out.media.hash).toBe(await sha256Hex(stored))
    // The original is decoded into a working canvas, the square is drawn from that canvas only.
    expect(d.drawn[0].args[0]).toEqual({ decoded: true })
    expect(d.drawn[1].args[0]).toBe(pic.source)
    expect(d.drawn[1].args.slice(5)).toEqual([0, 0, AVATAR_EDGE, AVATAR_EDGE])
  })

  it('steps the quality down until it fits, and refuses an encoder that leaked metadata', async () => {
    const big = fakeDeps({ sizes: [90000, 60000, 20000] })
    const pic = await openAvatarImage(new Blob([jpeg()]), big)
    const out = await renderAvatar(pic, 264, { zoom: 1 }, big)
    expect(out.blob.size).toBe(20000)
    const leak = fakeDeps({ out: webpWithExif() })
    await expect(renderAvatar(await openAvatarImage(new Blob([jpeg()]), leak), 264, { zoom: 1 }, leak)).rejects.toMatchObject({ code: 'unreadable' })
    const never = fakeDeps({ sizes: [90000] })
    await expect(renderAvatar(await openAvatarImage(new Blob([jpeg()]), never), 264, { zoom: 1 }, never)).rejects.toMatchObject({ code: 'too-large' })
  })

  it('refuses what is not a still image before decoding anything', async () => {
    const d = fakeDeps()
    const wav = bytes('RIFF', [0, 0, 0, 0], 'WAVE', 'fmt ', [16, 0, 0, 0], [1, 0], new Uint8Array(40))
    await expect(openAvatarImage(new Blob([wav]), d)).rejects.toMatchObject({ code: 'type' })
    await expect(openAvatarImage(new Blob([latin1('<svg onload=alert(1)>')]), d)).rejects.toMatchObject({ code: 'type' })
    await expect(openAvatarImage(new Blob([jpeg(20000, 20000)]), d)).rejects.toMatchObject({ code: 'photo-too-big' })
  })
})

describe('the avatar syncs as a hash', () => {
  it('is a referenced file, kept here, and uploaded only to a server that keeps avatars', () => {
    const S = { avatar: { m: ref(H('b')) }, customEx: [{ id: 'c', media: ref(H('c'), { mime: 'image/jpeg' }) }] }
    expect([...referencedHashes(S)]).toContain(H('b'))
    expect(keptHashes(S).has(H('b'))).toBe(true)
    expect(uploadableFiles(S).map(f => f.hash)).toEqual([H('c'), H('b')])
    expect(uploadableFiles(S, { avatar: false }).map(f => f.hash)).toEqual([H('c')])
    expect([...referencedHashes({ avatar: { preset: 'flame' } })]).toEqual([])
  })

  it('the picture set last wins a merge, and a removal stays removed', () => {
    const base = { _ts: 1, unit: 'kg', workouts: [], routines: [] }
    const phone = stampEdits(base, { ...base, _ts: 10, avatar: { m: ref(H('d')) } }, 100)
    const laptop = stampEdits(base, { ...base, _ts: 20, avatar: { preset: 'crown' } }, 50)
    expect(mergeStates(phone, laptop).avatar).toEqual({ m: ref(H('d')) })
    expect(mergeStates(laptop, phone).avatar).toEqual({ m: ref(H('d')) })
    const cleared = stampEdits(phone, { ...phone, _ts: 30, avatar: undefined }, 200)
    delete cleared.avatar
    expect(mergeStates(cleared, phone).avatar).toBeUndefined()
    expect(mergeStates(phone, cleared).avatar).toBeUndefined()
  })
})

describe('the avatar in a backup', () => {
  it('goes out with the photos and comes back as a pending file under its hash', async () => {
    const from = createMediaStore(memoryBackend())
    const pic = webpVp8(256, 256)
    const m = { ...ref(await sha256Hex(pic)), size: pic.length }
    await from.put(m.hash, new Blob([pic], { type: 'image/webp' }), { mime: 'image/webp' })
    const S = { unit: 'kg', workouts: [], routines: [], bodyweight: [], avatar: { m } }
    const zip = await exportBackupZip(S, { media: from })
    expect(zip.included).toBe(1)

    const to = createMediaStore(memoryBackend())
    const read = await readBackupFile(new File([zip.blob], 'b.zip'))
    expect(read.state.avatar).toEqual({ m })
    expect(read.files.map(f => f.hash)).toEqual([m.hash])
    expect(await storeBackupMedia(read.files, { media: to })).toEqual({ stored: 1, skipped: 0 })
    const rec = await to.get(m.hash)
    expect(rec.pending).toBe(true)
    expect(new Uint8Array(await rec.blob.arrayBuffer())).toEqual(pic)
  })

  it('a malformed avatar in a backup is dropped, a preset kept', async () => {
    const bad = { unit: 'kg', workouts: [], routines: [], avatar: { m: { hash: '../../etc', mime: 'text/html' } } }
    expect((await readBackupFile(new File([JSON.stringify(bad)], 'b.json'))).state.avatar).toBeUndefined()
    expect(sanitizeAvatar({ avatar: { preset: 'moon', junk: 1 } }).avatar).toEqual({ preset: 'moon' })
  })

  it('a sound of one\'s own comes back from the zip too (it was exported, then skipped on import)', async () => {
    const from = createMediaStore(memoryBackend())
    const wav = bytes('RIFF', [36 + 8, 0, 0, 0], 'WAVE', 'fmt ', [16, 0, 0, 0], [1, 0, 1, 0], [0x22, 0x56, 0, 0], [0x44, 0xac, 0, 0], [2, 0, 16, 0], 'data', [8, 0, 0, 0], new Uint8Array(8))
    const m = { kind: 'audio', hash: await sha256Hex(wav), mime: 'audio/wav', size: wav.length, width: 1, height: 1, dur: 0.1, at: 1 }
    await from.put(m.hash, new Blob([wav], { type: 'audio/wav' }), { mime: 'audio/wav' })
    const S = { unit: 'kg', workouts: [], routines: [], bodyweight: [], sounds: [{ id: 's1', name: 'Gong', m }] }
    const zip = await exportBackupZip(S, { media: from })
    const read = await readBackupFile(new File([zip.blob], 'b.zip'))
    const to = createMediaStore(memoryBackend())
    expect(await storeBackupMedia(read.files, { media: to })).toEqual({ stored: 1, skipped: 0 })
    expect(await to.has(m.hash)).toBe(true)
  })
})
