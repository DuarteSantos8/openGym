import { describe, it, expect } from 'vitest'
import { ownItems, applyImport, importedRefs, originOf, browseTypes, cardLine, bylineOf, originLine, hasCopy, newerThanCopy } from './shared-items.js'
import { libraryOf, libraryOn, sharedError, LIBRARY_CONSENT } from './shared-api.js'

const H = c => c.repeat(64)
const wav = { kind: 'audio', hash: H('a'), mime: 'audio/wav', size: 1000, width: 1, height: 1, dur: 2 }
const pic = { kind: 'image', hash: H('b'), mime: 'image/webp', size: 900, width: 256, height: 256 }
const origin = { kind: 'library', id: 's_abcdefghijklmnop', version: 1, by: 'Anna', at: 1730800000000, server: 'https://gym.example' }

describe('the library gate', () => {
  it('needs a session and a shared block; guests never', () => {
    const config = { shared: { types: ['sound'] } }
    expect(libraryOf({})).toBe(null)
    expect(libraryOn(config, null)).toBe(false)
    expect(libraryOn(config, { id: 'u', guest: true })).toBe(false)
    expect(libraryOn(config, { id: 'u' })).toBe(true)
    expect(browseTypes(config.shared).map(x => x.id)).toEqual(['sound'])
  })
  it('the consent text is the server\'s canonical one', async () => {
    const { currentConsent } = await import('../../../api/consent.js')
    expect(currentConsent('library').text).toBe(LIBRARY_CONSENT)
    expect(LIBRARY_CONSENT).toMatch(/public to everyone on this server/)
    expect(LIBRARY_CONSENT).not.toMatch(/—/)
  })
  it('every refusal has words', () => {
    for (const code of ['banned', 'consent-own', 'media-blocked', 'media-metadata', 'quota', 'rate-limited', 'already-reported']) {
      expect(sharedError({ code })).not.toMatch(/—/)
      expect(sharedError({ code }).length).toBeGreaterThan(5)
    }
  })
})

describe('ownItems', () => {
  const S = {
    unit: 'kg',
    sounds: [{ id: 's1', name: 'Gong', m: wav }, { id: 's2', name: 'Taken', m: { ...wav, hash: H('c') }, origin }],
    customEx: [{ id: 'c1', n: 'Banded walk', bp: 'upper legs', eq: 'band', custom: true, _ts: 3, media: pic }, { id: 'c2', n: 'Copy', origin }],
    equipProfiles: [{ id: 'g1', name: 'Home', equipment: ['dumbbell'], _ts: 1 }],
    exNotes: { '0001': 'Knees out', '0002': '  ' },
    customMeasurements: [{ id: 'm1', name: 'Calf', unit: 'cm' }],
    routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0001', sets: 3, reps: 8 }] }],
    week: {},
  }
  it('offers your own things, never a copy you took', () => {
    expect(ownItems(S, 'sound').map(x => x.src)).toEqual(['sound:s1'])
    const ex = ownItems(S, 'exercise')
    expect(ex.map(x => x.src)).toEqual(['exercise:c1'])
    expect(ex[0].payload.ex.id).toBeUndefined()
    expect(ex[0].payload.ex._ts).toBeUndefined()
    expect(ex[0].payload.media.hash).toBe(H('b'))
    expect(ownItems(S, 'tip').map(x => x.src)).toEqual(['tip:0001'])
    expect(ownItems(S, 'equipment')[0].payload.profile.id).toBeUndefined()
    expect(ownItems(S, 'measures')[0].payload.fields).toEqual([{ name: 'Calf', unit: 'cm' }])
    const plans = ownItems(S, 'plan')
    expect(plans.map(x => x.src)).toEqual(['plan:all', 'plan:r:r1'])
    expect(plans[0].payload.bundle.routines[0].name).toBe('Push')
  })
  it('never offers an archived routine', () => {
    const A = { ...S, routines: [...S.routines, { id: 'r2', name: 'Old', ex: [{ id: '0001', sets: 3, reps: 8 }], archived: true }] }
    const plans = ownItems(A, 'plan')
    expect(plans.map(x => x.src)).toEqual(['plan:all', 'plan:r:r1'])
    expect(plans[0].payload.bundle.routines.map(x => x.name)).toEqual(['Push'])
  })

  it('a set video kept on the phone is not offered', () => {
    const local = { ...S, customEx: [{ id: 'c3', n: 'Clip', media: { kind: 'video', hash: H('d'), mime: 'video/mp4', size: 9, width: 2, height: 2, local: true } }] }
    expect(ownItems(local, 'exercise')[0].media).toEqual([])
  })
})

describe('applyImport: a copy that is yours and says where it came from', () => {
  it('a sound', () => {
    const s = { sounds: [] }
    applyImport(s, { type: 'sound', payload: { name: 'Gong', m: wav }, origin })
    expect(s.sounds).toHaveLength(1)
    expect(originOf(s.sounds[0]).by).toBe('Anna')
    expect(applyImport(s, { type: 'sound', payload: { name: 'Gong', m: wav }, origin })).toMatch(/already/)
    expect(s.sounds).toHaveLength(1)
  })
  it('an exercise gets a fresh custom id', () => {
    const s = { customEx: [] }
    applyImport(s, { type: 'exercise', payload: { ex: { n: 'Banded walk', id: '0001' }, media: pic }, origin })
    expect(s.customEx[0].id).toMatch(/^c/)
    expect(s.customEx[0].custom).toBe(true)
    expect(s.customEx[0].media.hash).toBe(H('b'))
    expect(s.customEx[0].origin.id).toBe(origin.id)
  })
  it('a plan adds routines and never touches the week', () => {
    const s = { unit: 'kg', routines: [{ id: 'mine', name: 'Mine', ex: [] }], week: { 1: ['mine'] }, customEx: [] }
    const bundle = { opengym_plan: 1, unit: 'kg', week: { 2: ['r1'] }, routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0001', sets: 3, reps: 8 }] }], customEx: [] }
    applyImport(s, { type: 'plan', payload: { bundle }, origin })
    expect(s.routines).toHaveLength(2)
    expect(s.routines[1].origin.by).toBe('Anna')
    expect(s.week).toEqual({ 1: ['mine'] })
  })
  it('a tip goes into your note, once', () => {
    const s = { exNotes: { '0001': 'Mine' } }
    applyImport(s, { type: 'tip', payload: { exId: '0001', text: 'Knees out' }, origin })
    applyImport(s, { type: 'tip', payload: { exId: '0001', text: 'Knees out' }, origin })
    expect(s.exNotes['0001']).toBe('Mine\nKnees out')
  })
  it('measurement fields: only the new ones', () => {
    const s = { customMeasurements: [{ id: 'x', name: 'Calf', unit: 'cm' }] }
    applyImport(s, { type: 'measures', payload: { fields: [{ name: 'calf', unit: 'cm' }, { name: 'Neck', unit: 'in' }] }, origin })
    expect(s.customMeasurements.map(c => c.name)).toEqual(['Calf', 'Neck'])
  })
  it('a look only with icons this app draws', () => {
    const s = {}
    applyImport(s, { type: 'look', payload: { flame: { v: 'bolt', c: '#ffc93c' }, freeze: { v: 'nosuchicon' }, accent: '#123456' }, origin })
    expect(s.flameIcon).toEqual({ k: 'icon', v: 'bolt', c: '#ffc93c' })
    expect(s.freezeIcon).toBeUndefined()
    expect(s.accent).toBe('custom')
    expect(s.accentCustom).toBe('#123456')
  })
  it('a gym profile and the refs to fetch', () => {
    const s = {}
    applyImport(s, { type: 'equipment', payload: { name: 'FitBox', profile: { equipment: ['barbell'] } }, origin })
    expect(s.equipProfiles[0].name).toBe('FitBox')
    expect(importedRefs({ payload: { m: wav } }).map(r => r.hash)).toEqual([H('a')])
  })
  it('a new version is told apart, and comes in as another copy, never over yours', () => {
    const s = { sounds: [] }
    applyImport(s, { type: 'sound', payload: { name: 'Gong', m: wav }, origin })
    const item = { id: origin.id, type: 'sound', version: 2 }
    expect(hasCopy(s, item)).toBe(true)
    expect(newerThanCopy(s, item)).toBe(true)
    expect(newerThanCopy(s, { ...item, version: 1 })).toBe(false)
    applyImport(s, { type: 'sound', payload: { name: 'Gong 2', m: { ...wav, hash: H('e') } }, origin: { ...origin, version: 2 } })
    expect(s.sounds.map(x => x.name)).toEqual(['Gong', 'Gong 2'])
  })
  it('without an origin nothing is merged', () => {
    expect(() => applyImport({}, { type: 'sound', payload: { m: wav } })).toThrow()
  })
})

describe('words on the cards', () => {
  const fmt = () => '3 Nov'
  it('always says who and when', () => {
    expect(bylineOf({ by: { name: 'Anna' }, at: 1 }, fmt)).toBe('by Anna · 3 Nov')
    expect(bylineOf({ by: { name: '' }, at: 1 }, fmt)).toMatch(/left/)
    expect(originLine(origin, fmt)).toBe('From Anna, taken 3 Nov')
    expect(cardLine({ type: 'plan', summary: { routines: [{}, {}] } })).toBe('2 routines')
  })
})
