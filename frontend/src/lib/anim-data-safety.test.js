// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* DATA SAFETY. The animation quality and the figure only ever change which picture shows: the
   profile, its workouts, routines and history are never touched, and every exercise anything
   refers to keeps a picture at every quality and on both figures. Run against a synthetic profile
   in the shape of real ones (fixtures/anim-safety-state.json: v1.3 ids, a drawing id stored as an
   exercise id, twins drawn on both figures, a female exercise with a male twin, custom exercises
   with and without a photo, one deleted on another device, an id no catalogue knows). The quality
   choice lives in this device's localStorage under one key and nowhere else. */
vi.mock('./mobile.js', () => ({ MOBILE: true }))
vi.mock('@capacitor/core', () => {
  const impl = {
    available: async () => ({ available: true }),
    status: async () => ({ state: 'ready', bytes: 1 }),
    localPath: async ({ packId }) => ({ path: '/packs/' + packId }),
    download: async () => {}, remove: async () => {}, addListener: () => ({ remove() {} }),
  }
  return {
    registerPlugin: () => new Proxy({}, { get: (_, k) => impl[k] || (() => new Promise(() => {})) }),
    Capacitor: { convertFileSrc: p => 'app://files' + p },
  }
})

import FIXTURE from './fixtures/anim-safety-state.json' with { type: 'json' }
import { EXIDX, exOr, isCustomEx, registerCustom, gifSrc, imgSrc, figureOf, canonicalExId } from './exercises.js'
import { PACK_QUALITIES, packId, clipSources, packDrawingId } from './anim-quality.js'
import * as packs from './anim-packs.js'

const CHOICES = ['auto', 'still', 'builtin', ...PACK_QUALITIES]
const FIGS = ['male', 'female']
const deepFreeze = o => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze) } return o }
const all = fig => Object.fromEntries(PACK_QUALITIES.map(px => [packId(px, fig), `app://files/packs/${packId(px, fig)}`]))
const INSTALLED = { none: () => ({}), all, half: fig => ({ [packId(360, fig)]: `app://files/packs/${packId(360, fig)}` }), other: fig => all(fig === 'male' ? 'female' : 'male') }

/** Every exercise id the profile refers to anywhere. */
export function referencedIds(S) {
  const ids = new Set()
  for (const w of S.workouts || []) for (const e of w.entries || []) ids.add(e.id)
  for (const w of S.workouts || []) for (const id of w.prs || []) ids.add(id)
  for (const r of S.routines || []) for (const e of r.ex || []) ids.add(e.id)
  for (const k of Object.keys(S.exWeights || {})) ids.add(k)
  for (const id of S.favEx || []) ids.add(id)
  for (const k of Object.keys(S.exNotes || {})) ids.add(k)
  return [...ids]
}

/** What the media for one id is, at one choice and figure: the same split Media.jsx makes. */
function pictureFor(id, { choice, figure, installed }) {
  const ex = exOr(id)
  if (isCustomEx(ex)) return { kind: 'custom', ex }
  if (ex.missing) return { kind: 'missing', ex }
  return { kind: 'catalogue', ex, stillSrc: imgSrc(ex, figure), ...clipSources({ ex, figure, choice, device: { shortSide: 390 }, installed, builtin: gifSrc(ex, figure) }) }
}

export function assertEveryPictureResolves(S) {
  registerCustom(S.customEx)
  const counts = { catalogue: 0, custom: 0, missing: 0 }
  for (const id of referencedIds(S)) {
    for (const choice of CHOICES) for (const figure of FIGS) for (const [name, inst] of Object.entries(INSTALLED)) {
      const p = pictureFor(id, { choice, figure, installed: inst(figure) })
      const where = `${id} ${choice} ${figure} ${name}`
      if (p.kind === 'catalogue') {
        expect(p.stillSrc, where).toMatch(/^exercise-media\/still\/\d{4,5}\.webp$/)
        if (choice === 'still') { expect(p.sources, where).toEqual([]); continue }
        expect(p.sources.length, where).toBeGreaterThan(0)
        expect(p.sources.at(-1), where).toBe(gifSrc(p.ex, figure))
        // Never another figure's pack, never a drawing the figure does not show.
        for (const src of p.sources.slice(0, -1)) {
          expect(src, where).toContain(`-${figure}/`)
          expect(src.endsWith('/' + packDrawingId(p.ex, figure) + '.webp'), where).toBe(true)
        }
      } else if (p.kind === 'custom') {
        // Custom media keep their own path (components/CustomMedia.jsx): never a pack, never the catalogue's.
        expect(p.ex.custom === true || S.customEx.some(c => c.id === id), where).toBe(true)
      } else {
        expect(p.ex.missing, where).toBe(true)
      }
      if (choice === 'auto' && figure === 'male' && name === 'none') counts[p.kind]++
    }
  }
  return counts
}

beforeEach(() => { localStorage.clear(); packs._resetAnimPacks() })

describe('every exercise the profile refers to has a picture, at every quality and on both figures', () => {
  it('the synthetic profile: catalogue, v1.3, alias, twins, custom with and without media, deleted, unknown', () => {
    const counts = assertEveryPictureResolves(structuredClone(FIXTURE))
    expect(counts).toEqual({ catalogue: 5, custom: 2, missing: 2 })
  })
  it('a drawing id stored as an exercise id still reads as its exercise, and is left as it is', () => {
    expect(EXIDX['2476']).toBe(EXIDX['0001'])
    expect(canonicalExId('2476')).toBe('0001')
    expect(FIXTURE.workouts[1].entries[0].id).toBe('2476')
  })
})

describe('switching quality and figure never touches the profile', () => {
  it('the state is deep-equal before and after, and only the device key is written', async () => {
    const S = deepFreeze(structuredClone(FIXTURE))
    const before = JSON.stringify(S)
    const keysBefore = Object.keys(localStorage)
    await packs.refresh()
    for (const choice of CHOICES) {
      packs.writePrefs({ choice })
      for (const figure of FIGS) {
        // what a figure switch reads: S.exFigure, never written by any of this
        figureOf({ ...S, exFigure: figure })
        await packs.ensureWanted(figure, { shortSide: 1024 })
        for (const id of referencedIds(S)) pictureFor(id, { choice, figure, installed: packs.installedBases() })
      }
    }
    packs.writePrefs({ wifiOnly: false })
    expect(JSON.stringify(S)).toBe(before)
    expect(Object.keys(localStorage).filter(k => !keysBefore.includes(k))).toEqual([packs.PREFS_KEY])
    expect(JSON.parse(localStorage.getItem(packs.PREFS_KEY))).toEqual({ choice: 1080, wifiOnly: false })
  })
  it('nothing about the quality is kept in the profile that syncs', () => {
    expect(JSON.stringify(FIXTURE)).not.toMatch(/gym_anim|quality|anim-\d+/)
  })
})
