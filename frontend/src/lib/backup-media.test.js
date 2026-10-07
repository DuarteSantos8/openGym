import { describe, it, expect } from 'vitest'
import { exportBackupZip, readBackupFile, backupImportError, storeBackupMedia, sanitizeCustomMedia, BACKUP_JSON } from './backup-media.js'
import { createMediaStore, memoryBackend } from './media-store.js'
import { zipStore, readZip } from './zip.js'
import { sha256Hex } from './sha256.js'
import { jpeg, png, mp4 } from './media-samples.test-util.js'
import { workoutMediaOf } from './media-refs.js'

const refFor = async (bytes, mime, kind = 'image') => ({ kind, hash: await sha256Hex(bytes), mime, size: bytes.length, width: 4, height: 3, at: 1 })
const stateWith = customEx => ({ unit: 'kg', workouts: [], routines: [], bodyweight: [], customEx })

describe('export with photos & videos', () => {
  it('writes the same JSON, every file the state refers to under its hash, and a README; counts what it could not get', async () => {
    const media = createMediaStore(memoryBackend())
    const photo = jpeg(), poster = png(), clip = mp4().file
    const main = await refFor(photo, 'image/jpeg')
    const vid = await refFor(clip, 'video/quicktime', 'video')
    main.poster = { hash: await sha256Hex(poster), mime: 'image/webp', size: poster.length, width: 2, height: 2 }
    await media.put(main.hash, new Blob([photo]), { mime: 'image/jpeg' })
    await media.put(main.poster.hash, new Blob([poster]), { mime: 'image/png' })
    await media.put(vid.hash, new Blob([clip]), { mime: 'video/quicktime' })
    const gone = { ...main, hash: 'f'.repeat(64), poster: undefined }
    const S = stateWith([{ id: 'a', n: 'a', media: main }, { id: 'b', n: 'b', media: vid }, { id: 'c', n: 'c', media: gone }])
    const fetched = []
    const out = await exportBackupZip(S, { media, fetchOne: async h => { fetched.push(h); throw new Error('404') } })
    expect(out.missing).toBe(1)
    expect(out.included).toBe(3)
    expect(fetched).toEqual(['f'.repeat(64)])
    const entries = await readZip(out.blob)
    expect(entries.map(e => e.name)).toEqual([BACKUP_JSON, `media/${main.poster.hash}.png`, `media/${main.hash}.jpg`, `media/${vid.hash}.mov`, 'README.txt'])
    expect(JSON.parse(await entries[0].blob.text())).toEqual(JSON.parse(JSON.stringify(S, null, 2)))
  })
})

describe('import', () => {
  it('a zip brings its state and, once stored, its files as pending', async () => {
    const photo = jpeg()
    const main = await refFor(photo, 'image/jpeg')
    const S = stateWith([{ id: 'a', n: 'a', media: main, url: 'youtu.be/x' }])
    const zip = await zipStore([{ name: BACKUP_JSON, blob: new Blob([JSON.stringify(S)]) }, { name: `media/${main.hash}.jpg`, blob: new Blob([photo]) }, { name: 'media/' + 'e'.repeat(64) + '.jpg', blob: new Blob([photo]) }])
    const read = await readBackupFile(new File([zip], 'backup.zip'))
    expect(read.zip).toBe(true)
    expect(read.state.customEx[0].url).toBe('https://youtu.be/x')
    expect(read.files.map(f => f.hash)).toEqual([main.hash])   // only what the state refers to
    const media = createMediaStore(memoryBackend())
    expect(await storeBackupMedia(read.files, { media })).toEqual({ stored: 1, skipped: 0 })
    expect(await media.get(main.hash)).toMatchObject({ mime: 'image/jpeg', pending: true })
  })

  it('a tampered file is skipped, and so is one over its cap or of a type that is not stored', async () => {
    const photo = jpeg()
    const main = await refFor(photo, 'image/jpeg')
    const tampered = photo.slice(); tampered[tampered.length - 1] ^= 1
    const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>')
    const htmlRef = { ...main, hash: await sha256Hex(html) }
    const big = new Uint8Array(3 * 1024 * 1024); big.set(photo)
    const bigRef = { ...main, hash: await sha256Hex(big), size: big.length }
    const S = stateWith([{ id: 'a', media: main }, { id: 'b', media: htmlRef }, { id: 'c', media: bigRef }])
    const zip = await zipStore([
      { name: BACKUP_JSON, blob: new Blob([JSON.stringify(S)]) },
      { name: `media/${main.hash}.jpg`, blob: new Blob([tampered]) },
      { name: `media/${htmlRef.hash}.jpg`, blob: new Blob([html]) },
      { name: `media/${bigRef.hash}.jpg`, blob: new Blob([big]) }
    ])
    const read = await readBackupFile(new File([zip], 'b.zip'))
    const media = createMediaStore(memoryBackend())
    expect(await storeBackupMedia(read.files, { media })).toEqual({ stored: 0, skipped: 3 })
    expect(await media.list()).toEqual([])
  })

  it('a JSON backup reads as before, with its refs and links through the same gates', async () => {
    const S = stateWith([{ id: 'a', media: { kind: 'image', hash: 'nope' }, url: 'javascript:alert(1)' }, { id: 'b', media: await refFor(jpeg(), 'image/jpeg') }])
    const read = await readBackupFile(new File([JSON.stringify(S)], 'b.json', { type: 'application/json' }))
    expect(read.zip).toBe(false)
    expect(read.files).toEqual([])
    expect(read.state.customEx[0]).toEqual({ id: 'a' })
    expect(read.state.customEx[1].media.mime).toBe('image/jpeg')
  })

  it('refuses what is not an openGym backup, zipped or not', async () => {
    await expect(readBackupFile(new File(['{"hello":1}'], 'x.json'))).rejects.toThrow()
    const zip = await zipStore([{ name: 'something.txt', blob: new Blob(['x']) }])
    await expect(readBackupFile(new File([zip], 'x.zip'))).rejects.toThrow()
  })

  // German QA: 'Import fehlgeschlagen: not-zip', '... not an openGym backup', 'Unexpected token ...'.
  it('says why an import failed in words, never the thrown developer text', async () => {
    const why = async (content, name) => { try { await readBackupFile(new File([content], name)) } catch (e) { return backupImportError(e) } }
    const notOurs = 'That file isn’t an openGym backup.'
    expect(await why('[1,2]', 'x.json')).toBe(notOurs)
    expect(await why('hello there', 'x.txt')).toBe(notOurs)
    expect(await why(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]), 'fake.zip')).toBe(notOurs)
    expect(await why(await zipStore([{ name: 'something.txt', blob: new Blob(['x']) }]), 'x.zip')).toBe(notOurs)
    expect(backupImportError(Object.assign(new Error('compressed'), { code: 'compressed' }))).toBe('That zip was repacked. Import the original backup file.')
    expect(backupImportError(new TypeError('x is undefined'))).toBe('Couldn’t read that file.')
  })

  it('sanitizeCustomMedia leaves a state without custom exercises alone', () => {
    expect(sanitizeCustomMedia({ workouts: [] })).toEqual({ workouts: [] })
  })

  it('a workout\'s photos and videos come in through the same gates: bad refs dropped, one per file — past the cap kept, shown up to six', () => {
    const ok = n => ({ kind: 'image', hash: String(n).repeat(64), mime: 'image/webp', size: 10, width: 4, height: 3, at: 1 })
    const S = { workouts: [
      { id: 'w1', media: [ok(1), { ...ok(2), mime: 'text/html' }, ok(1), ok(3), ok(4), ok(5), ok(6), ok(7), ok(8)] },
      { id: 'w2', media: 'x' },
      { id: 'w3' }
    ] }
    sanitizeCustomMedia(S)
    expect(S.workouts[0].media.map(m => m.hash[0])).toEqual(['1', '3', '4', '5', '6', '7', '8'])
    expect(workoutMediaOf(S.workouts[0]).map(m => m.hash[0])).toEqual(['1', '3', '4', '5', '6', '7'])
    expect('media' in S.workouts[1]).toBe(false)
    expect(S.workouts[2]).toEqual({ id: 'w3' })
  })
})

describe('a workout\'s photos and videos in the zip', () => {
  it('are exported next to the exercises\' and come back in from the zip', async () => {
    const media = createMediaStore(memoryBackend())
    const photo = jpeg(), clip = mp4().file
    const p = await refFor(photo, 'image/jpeg')
    const v = await refFor(clip, 'video/mp4', 'video')
    await media.put(p.hash, new Blob([photo]), { mime: 'image/jpeg' })
    await media.put(v.hash, new Blob([clip]), { mime: 'video/mp4' })
    const S = { ...stateWith([]), workouts: [{ id: 'w1', d: '2026-09-20', start: 1, end: 2, entries: [], media: [p, v] }] }
    const out = await exportBackupZip(S, { media })
    expect(out).toMatchObject({ included: 2, missing: 0 })
    const read = await readBackupFile(new File([out.blob], 'backup.zip'))
    expect(read.state.workouts[0].media).toEqual([p, v])
    expect(read.files.map(f => f.hash).sort()).toEqual([p.hash, v.hash].sort())
    const into = createMediaStore(memoryBackend())
    expect(await storeBackupMedia(read.files, { media: into })).toEqual({ stored: 2, skipped: 0 })
    expect(await into.get(v.hash)).toMatchObject({ mime: 'video/mp4', pending: true })
  })
})
