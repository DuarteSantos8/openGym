import { describe, it, expect } from 'vitest'
import { exMediaOf, setExMedia, clearExMedia, setExMediaShow, serverTakesExMedia } from './ex-media.js'
import { referencedHashes, stateMediaRefs } from './media-refs.js'
import { mergeStampedMap, STAMPED_MAPS } from './sync-merge.js'
import { ownItems } from './shared-items.js'
import { buildPlanBundle } from './plan-share.js'

// Your own photo or video on a built-in exercise (#259, #534).
const ref = (c = 'a', extra = {}) => ({ kind: 'video', hash: c.repeat(64), mime: 'video/mp4', size: 1000, width: 720, height: 1280, dur: 6, poster: { hash: 'f'.repeat(64), mime: 'image/webp', size: 100, width: 360, height: 640 }, ...extra })

describe('one per exercise, shown first once added', () => {
  it('sets, reads, flips and clears', () => {
    const S = {}
    expect(exMediaOf(S, '0025')).toBe(null)
    expect(setExMedia(S, '0025', ref(), 10)).toBe(true)
    expect(exMediaOf(S, '0025')).toMatchObject({ show: 'own', m: { hash: 'a'.repeat(64) } })
    expect(setExMediaShow(S, '0025', 'stock', 11)).toBe(true)
    expect(exMediaOf(S, '0025').show).toBe('stock')
    expect(S.exMedia['0025']._ts).toBe(11)
    expect(clearExMedia(S, '0025', 12)).toBe(true)
    // A stamped empty entry, so the removal wins a sync instead of coming back.
    expect(S.exMedia['0025']).toEqual({ _ts: 12 })
    expect(exMediaOf(S, '0025')).toBe(null)
    expect(setExMediaShow(S, '0025', 'own')).toBe(false)
  })

  it('refuses what is not a picture or a clip', () => {
    const S = {}
    expect(setExMedia(S, '0025', { kind: 'audio', hash: 'b'.repeat(64), mime: 'audio/wav', size: 10, width: 1, height: 1 })).toBe(false)
    expect(setExMedia(S, '0025', { hash: 'nope' })).toBe(false)
    expect(setExMedia(S, '', ref())).toBe(false)
    expect(exMediaOf({ exMedia: { x: { m: { hash: 'bad' } } } }, 'x')).toBe(null)
  })

  it('is offered locally, and signed in only where the server keeps it', () => {
    expect(serverTakesExMedia(null, null)).toBe(true)
    expect(serverTakesExMedia({ id: 'u' }, { media: { days: true } })).toBe(false)
    expect(serverTakesExMedia({ id: 'u' }, { media: { builtin: true } })).toBe(true)
    expect(serverTakesExMedia({ id: 'u' }, null)).toBe(false)
  })
})

describe('kept and synced like every other file of yours', () => {
  it('the files count as referenced, poster included, so the sync uploads them and no clean-up drops them', () => {
    const S = {}
    setExMedia(S, '0025', ref())
    expect(stateMediaRefs(S)).toHaveLength(1)
    expect([...referencedHashes(S)].sort()).toEqual(['a'.repeat(64), 'f'.repeat(64)])
  })

  it('two devices that each set one keep both; the later edit of one exercise wins', () => {
    expect(STAMPED_MAPS).toContain('exMedia')
    const a = {}, b = {}
    setExMedia(a, '0025', ref('a'), 10)
    setExMedia(b, '0652', ref('b'), 11)
    clearExMedia(b, '0025', 1)
    const m = mergeStampedMap(a.exMedia, b.exMedia)
    expect(exMediaOf({ exMedia: m }, '0025')).not.toBe(null)
    expect(exMediaOf({ exMedia: m }, '0652')).not.toBe(null)
  })
})

describe('private: never shared on its own', () => {
  it('the community library offers none of it, and a plan file carries none of it', () => {
    const S = { routines: [{ id: 'r', name: 'A', ex: [{ id: '0025', sets: 3, reps: 8 }] }], customEx: [], workouts: [] }
    setExMedia(S, '0025', ref())
    const types = ['exercise', 'plan', 'photo', 'formvideo', 'progress', 'sound', 'equipment', 'tip', 'look', 'measures']
    const shared = JSON.stringify(types.flatMap(type => ownItems(S, type)))
    expect(shared).not.toContain('a'.repeat(64))
    expect(JSON.stringify(buildPlanBundle(S, 'x'))).not.toContain('a'.repeat(64))
  })
})
