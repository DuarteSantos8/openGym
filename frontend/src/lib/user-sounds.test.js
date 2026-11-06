// @vitest-environment happy-dom
// Sounds of one's own for the rest timer (Settings → Sound): the ingest that turns a picked file
// into the WAV every platform plays, the slots, and what the timer is told to play.
import { describe, expect, it, vi } from 'vitest'
import { audibleRange, shapeSound, encodeWav, ingestSoundFile, RATE, MAX_SEC, PEAK } from './sound-ingest.js'
import { soundsOf, addSound, removeSound, slotChoice, setSlot, slotSound, toneFor, nameFromFile, isUserTone, SOUNDS_MAX } from './user-sounds.js'
import { buildRestAlert } from './rest-alert.js'
import { referencedHashes, uploadableFiles, normalizeMediaRef } from './media-refs.js'
import { sniffKind } from './media-sniff.js'
import { chime, _setOwnSoundSource, playUserTone } from './sound.js'
import { ensureSoundFiles } from './user-sounds-files.js'

const H = 'a'.repeat(64), H2 = 'b'.repeat(64)
const ref = (hash = H) => ({ kind: 'audio', hash, mime: 'audio/wav', size: 4000, width: 1, height: 1, dur: 1.5, at: 1 })
const tone = (sec, amp = 0.5) => Float32Array.from({ length: Math.round(sec * RATE) }, (_, i) => amp * Math.sin(i / 5))
const silence = sec => new Float32Array(Math.round(sec * RATE))
const cat = (...xs) => { const out = new Float32Array(xs.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of xs) { out.set(x, o); o += x.length } return out }

describe('the sound ingest', () => {
  it('trims the silence at both ends, keeps a hair of it, and brings the peak up', () => {
    const x = cat(silence(1), tone(0.5, 0.2), silence(2))
    const [a, b] = audibleRange(x)
    expect(a / RATE).toBeGreaterThan(0.98)
    expect(b / RATE).toBeLessThan(1.52)
    const y = shapeSound(x)
    expect(y.length / RATE).toBeLessThan(0.53)
    expect(Math.max(...y.map(Math.abs))).toBeCloseTo(PEAK, 3)
  })

  it('cuts a long one at 30 s with a fade, and finds nothing in silence', () => {
    const y = shapeSound(tone(45))
    expect(y.length).toBe(MAX_SEC * RATE)
    expect(Math.abs(y[y.length - 1])).toBeLessThan(0.01)
    expect(shapeSound(silence(3))).toBe(null)
  })

  it('writes the 16-bit PCM WAV the server and the phones read', () => {
    const w = encodeWav(Float32Array.from([0, 1, -1]))
    const d = new DataView(w.buffer)
    expect(String.fromCharCode(...w.slice(0, 4), ...w.slice(8, 16))).toBe('RIFFWAVEfmt ')
    expect(d.getUint16(20, true)).toBe(1)
    expect(d.getUint16(22, true)).toBe(1)
    expect(d.getUint32(24, true)).toBe(RATE)
    expect(d.getUint16(34, true)).toBe(16)
    expect([d.getInt16(44, true), d.getInt16(46, true), d.getInt16(48, true)]).toEqual([0, 32767, -32767])
    expect(sniffKind(w)).toEqual({ mime: 'audio/wav', kind: 'audio', category: 'audio' })
  })

  it('makes a MediaRef the state can keep, and refuses a big or silent file', async () => {
    const out = await ingestSoundFile({ size: 1000 }, { decode: async () => cat(silence(0.2), tone(1.2)) })
    expect(out.media).toMatchObject({ kind: 'audio', mime: 'audio/wav', width: 1, height: 1, dur: 1.2 })
    expect(normalizeMediaRef(out.media)).toEqual(out.media)
    expect(out.blob.size).toBe(out.media.size)
    await expect(ingestSoundFile({ size: 20 * 1024 * 1024 })).rejects.toMatchObject({ code: 'too-large' })
    await expect(ingestSoundFile({ size: 10 }, { decode: async () => silence(1) })).rejects.toMatchObject({ code: 'silent' })
  })
})

describe('the sounds of one\'s own', () => {
  it('only usable sounds count, at most eight', () => {
    const S = { sounds: [{ id: 'a', name: '  Gong  ', m: ref() }, { id: 'a', name: 'dup', m: ref() }, { id: 'b', name: 'x', m: { ...ref(), kind: 'image' } }, null] }
    expect(soundsOf(S)).toEqual([{ id: 'a', name: 'Gong', m: ref() }])
    const s = { sounds: [] }
    for (let i = 0; i < SOUNDS_MAX + 2; i++) addSound(s, { name: 'n' + i, m: ref() }, 'id' + i)
    expect(soundsOf(s)).toHaveLength(SOUNDS_MAX)
    expect(nameFromFile('my_gong-sound.mp3')).toBe('my gong sound')
  })

  it('a slot plays the chosen one, the hold follows the rest until it has its own', () => {
    const s = { sounds: [], restSound: 'bell' }
    const id = addSound(s, { name: 'Gong', m: ref() })
    expect(slotChoice(s, 'hold')).toBe('bell')
    setSlot(s, 'rest', 'u:' + id)
    expect(s.classicChime).toBe(false)
    expect(toneFor(s, 'rest')).toBe('u:' + H)
    expect(toneFor(s, 'hold')).toBe('u:' + H)
    setSlot(s, 'hold', 'whistle')
    expect(toneFor(s, 'hold')).toBe('whistle')
    expect(slotSound(s, 'rest').name).toBe('Gong')
    // Removed: the rest goes back to the chime, never to a sound that is gone.
    removeSound(s, id)
    expect(toneFor(s, 'rest')).toBe('chime')
    expect(isUserTone('u:' + H)).toBe(true)
    expect(isUserTone('u:xyz')).toBe(false)
  })

  it('an unknown or stale choice plays the chime, as an older app would', () => {
    expect(toneFor({ restSound: 'u:gone' }, 'rest')).toBe('chime')
    expect(toneFor({ restSound: 'u:gone', sounds: [{ id: 'x', name: 'x', m: ref() }] }, 'rest')).toBe('chime')
  })

  it('the native alarm is told the file, and a made-up tone is not passed on', () => {
    const at = Date.now() + 60000
    expect(buildRestAlert({ at, tone: 'u:' + H }).tone).toBe('u:' + H)
    expect(buildRestAlert({ at, tone: 'u:../../x' }).tone).toBe('chime')
  })

  it('their files are kept and synced like photos, but only to a server that keeps sounds', () => {
    const S = { sounds: [{ id: 'a', name: 'Gong', m: ref(H2) }] }
    expect([...referencedHashes(S)]).toEqual([H2])
    expect(uploadableFiles(S).map(f => f.hash)).toEqual([H2])
    expect(uploadableFiles(S, { sounds: false })).toEqual([])
  })

  it('a missing file is fetched once, one already here is left alone', async () => {
    const S = { sounds: [{ id: 'a', name: 'A', m: ref(H) }, { id: 'b', name: 'B', m: ref(H2) }] }
    const fetch = vi.fn(async () => true)
    const got = await ensureSoundFiles(S, { store: { has: async h => h === H }, fetch })
    expect(got).toEqual([H2])
    expect(fetch).toHaveBeenCalledWith(H2, { mime: 'audio/wav', size: 4000 })
  })
})

describe('playing one in the page', () => {
  it('decodes the file once and plays it; without the file it falls back to the chime', async () => {
    const started = []
    const ctx = {
      state: 'running', currentTime: 0, destination: {}, resume: async () => {}, suspend: async () => {},
      decodeAudioData: vi.fn(async () => ({ duration: 1 })),
      createBufferSource: () => ({ connect () {}, start: t => started.push(t) }),
      createOscillator: () => ({ connect () {}, start () {}, stop () {}, frequency: { value: 0, setValueAtTime () {}, linearRampToValueAtTime () {} }, setPeriodicWave () {} }),
      createGain: () => ({ connect () {}, gain: { setValueAtTime () {}, exponentialRampToValueAtTime () {} } }),
      createPeriodicWave: () => ({}),
    }
    window.AudioContext = function () { return ctx }
    _setOwnSoundSource(async h => (h === H ? { blob: new Blob([new Uint8Array(10)]) } : null))
    expect(await playUserTone(true, 'u:' + H)).toBe(true)
    expect(await playUserTone(true, 'u:' + H)).toBe(true)
    expect(ctx.decodeAudioData).toHaveBeenCalledTimes(1)
    expect(started).toHaveLength(2)
    expect(await playUserTone(true, 'u:' + H2)).toBe(false)
    expect(await playUserTone(false, 'u:' + H)).toBe(false)
    chime(true, 'u:' + H2)   // no file: the chime instead, no throw
    await new Promise(r => setTimeout(r, 0))
  })
})

describe('a sound for each kind of rest (#165)', () => {
  const own = { id: 's1', name: 'Gong', m: ref('a'.repeat(64)) }
  it('a kind plays its own sound, built-in or one of yours, else the rest’s', async () => {
    const { kindChoice, setKindSound } = await import('./user-sounds.js')
    const s = { restSound: 'bell', sounds: [own] }
    expect(toneFor(s, 'rest', 'exercise')).toBe('bell')
    setKindSound(s, 'exercise', 'whistle')
    setKindSound(s, 'superset', 'u:s1')
    expect(kindChoice(s, 'exercise')).toBe('whistle')
    expect(toneFor(s, 'rest', 'exercise')).toBe('whistle')
    expect(toneFor(s, 'rest', 'superset')).toBe('u:' + 'a'.repeat(64))
    expect(toneFor(s, 'rest', 'work')).toBe('bell')
    expect(toneFor(s, 'hold', 'exercise')).toBe('bell')
    setKindSound(s, 'exercise', null)
    expect(s.restSoundByKind).toEqual({ superset: 'u:s1' })
  })
  it('junk is ignored, and removing a sound frees the kinds that used it', async () => {
    const { kindChoice, setKindSound } = await import('./user-sounds.js')
    expect(kindChoice({ restSoundByKind: { work: 'kazoo' } }, 'work')).toBeNull()
    expect(kindChoice({ restSoundByKind: { work: 'u:gone' } }, 'work')).toBeNull()
    expect(kindChoice({ restSoundByKind: ['bell'] }, 'work')).toBeNull()
    const s = { sounds: [own] }
    setKindSound(s, 'work', 'u:s1')
    removeSound(s, 's1')
    expect('restSoundByKind' in s).toBe(false)
  })
})
