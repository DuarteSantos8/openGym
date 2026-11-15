import { describe, expect, it } from 'vitest'
import * as L from './live-layout.js'

// The live widget's layout (lib/live-layout.js): one model for every surface, always valid,
// and each platform's room enforced, with a reason for what does not fit.

const lay = over => L.normalizeLayout({ ...L.PRESETS.default, ...over })

describe('normalizeLayout', () => {
  it('gives the default for nothing, junk, or a layout from nowhere', () => {
    const d = L.presetLayout('default')
    expect(L.normalizeLayout(null)).toEqual(d)
    expect(L.normalizeLayout('lots')).toEqual(d)
    expect(L.normalizeLayout(42)).toEqual(d)
    expect(L.layoutOf({})).toEqual(d)
    expect(d.v).toBe(L.LAYOUT_VERSION)
    for (const sf of L.SURFACES) expect(d[sf]).toBeTruthy()
  })
  it('drops unknown tiles and buttons, doubles and things a surface cannot show, and fixes sizes', () => {
    const out = L.normalizeLayout({
      v: 1,
      app: { t: [{ k: 'weight', s: 'xl' }, { k: 'nope' }, { k: 'weight', s: 's' }, 'reps', { k: 'progress', s: 's' }], a: ['log', 'log', 'teleport', 7] },
      widget: { t: [{ k: 'still' }, { k: 'progress' }, { k: 'hr', s: 'm' }], a: ['log'] },
      compact: { t: [{ k: 'notes' }, { k: 'rest' }] },
    })
    expect(out.app.t).toEqual([{ k: 'weight', s: 's' }, { k: 'reps', s: 's' }, { k: 'progress', s: 'l' }])
    expect(out.app.a).toEqual(['log'])
    expect(out.widget).toEqual({ t: [{ k: 'hr', s: 'm' }] })
    expect(out.compact.t).toEqual([{ k: 'rest', s: 'm' }])
  })
  it('reads the first sketch (a bare list of tiles) as the app card', () => {
    const out = L.normalizeLayout(['ex', 'weight', 'bogus'])
    expect(out.app.t.map(x => x.k)).toEqual(['ex', 'weight'])
    expect(out.app.a).toEqual(['log'])
    expect(out.lock).toEqual(L.presetLayout('default').lock)
  })
  it('keeps a surface it does not know about out, and fills a missing one from the default', () => {
    const out = L.normalizeLayout({ v: 1, app: { t: ['clock'], a: [] }, watchface: { t: ['hr'] } })
    expect(out.watchface).toBeUndefined()
    expect(out.android).toEqual(L.presetLayout('default').android)
  })
  it('is bounded: every tile at most once per surface, so a stored layout stays small', () => {
    const all = L.TILE_KEYS.flatMap(k => [k, k, k])
    const out = L.normalizeLayout({ app: { t: all, a: [...L.ACTION_KEYS, ...L.ACTION_KEYS] } })
    expect(out.app.t.length).toBe(L.TILE_KEYS.length)
    expect(out.app.a.length).toBe(L.ACTION_KEYS.length)
    expect(JSON.stringify(L.presetLayout('everything')).length).toBeLessThan(6000)
  })
  it('is stable: normalising twice changes nothing', () => {
    for (const id of [...L.PRESET_IDS, 'default']) {
      const once = L.presetLayout(id)
      expect(L.normalizeLayout(once)).toEqual(once)
    }
  })
})

describe('fitSurface', () => {
  it('has no limit in the app', () => {
    const f = L.fitSurface('app', L.presetLayout('everything'))
    expect(f.tiles.every(x => x.fit)).toBe(true)
    expect(f.actions.every(x => x.fit)).toBe(true)
  })
  it('keeps the Lock Screen inside about 160 points and says why the rest is left out', () => {
    const f = L.fitSurface('lock', L.presetLayout('everything'))
    const shown = f.tiles.filter(x => x.fit)
    const out = f.tiles.filter(x => !x.fit)
    expect(shown.length).toBeGreaterThan(0)
    expect(out.length).toBeGreaterThan(0)
    expect(out.every(x => x.why === 'height')).toBe(true)
    // Once one row does not fit, nothing after it does either: the order is the user's.
    const firstOut = f.tiles.findIndex(x => !x.fit)
    expect(f.tiles.slice(firstOut).every(x => !x.fit)).toBe(true)
    expect(f.actions.filter(x => x.fit).length).toBe(4)
    expect(f.actions.filter(x => !x.fit).every(x => x.why === 'buttons')).toBe(true)
  })
  it('fits the classic card and every preset but Everything whole, on every surface', () => {
    for (const id of ['default', 'minimal', 'lifter', 'cardio']) {
      for (const sf of L.SURFACES) {
        const f = L.fitSurface(sf, L.presetLayout(id))
        expect([...f.tiles, ...f.actions].filter(x => !x.fit).map(x => x.k), id + ' ' + sf).toEqual([])
      }
    }
  })
  it('gives the rows back the room the buttons do not take', () => {
    const tiles = ['ex', 'weight', 'reps', 'effort', 'setOf', 'rest', 'hr', 'time'].map(k => ({ k, s: 'm' }))
    const withBtn = L.fitSurface('lock', lay({ lock: { t: tiles, a: ['log'] } })).tiles.filter(x => x.fit).length
    const without = L.fitSurface('lock', lay({ lock: { t: tiles, a: [] } })).tiles.filter(x => x.fit).length
    expect(without).toBeGreaterThan(withBtn)
  })
  it('caps the Dynamic Island, its pill, Android and the widget by count', () => {
    const e = L.presetLayout('everything')
    expect(L.fitSurface('island', e).tiles.filter(x => x.fit).length).toBe(4)
    expect(L.fitSurface('compact', e).tiles.filter(x => x.fit).length).toBe(2)
    const and = L.fitSurface('android', e)
    expect(and.tiles.filter(x => x.fit).length).toBe(6)
    expect(and.actions.filter(x => x.fit).length).toBe(3)
    expect(and.tiles.filter(x => !x.fit).every(x => x.why === 'count')).toBe(true)
    expect(L.fitSurface('widget', e).tiles.filter(x => x.fit).length).toBe(3)
  })
  it('sends only what fits', () => {
    const s = L.shownOn('android', L.presetLayout('everything'))
    expect(s.t.length).toBe(6)
    expect(s.a.length).toBe(3)
  })
})

describe('editing', () => {
  it('adds, resizes, moves and removes, and stays valid all along', () => {
    let x = L.presetLayout('minimal')
    x = L.addTile(x, 'app', 'hr', 's')
    x = L.addTile(x, 'app', 'hr', 'm')
    expect(x.app.t.filter(y => y.k === 'hr')).toEqual([{ k: 'hr', s: 's' }])
    x = L.resizeTile(x, 'app', 'hr', 'm')
    x = L.moveTile(x, 'app', x.app.t.length - 1, 0)
    expect(x.app.t[0]).toEqual({ k: 'hr', s: 'm' })
    x = L.moveTile(x, 'app', 0, 99)
    expect(x.app.t[0].k).toBe('hr')
    x = L.removeTile(x, 'app', 'hr')
    expect(x.app.t.some(y => y.k === 'hr')).toBe(false)
    x = L.addAction(x, 'lock', 'restAdd')
    x = L.moveAction(x, 'lock', 1, 0)
    expect(x.lock.a).toEqual(['restAdd', 'log'])
    x = L.removeAction(x, 'lock', 'log')
    expect(x.lock.a).toEqual(['restAdd'])
    x = L.resetSurface(x, 'lock')
    expect(x.lock).toEqual(L.presetLayout('default').lock)
  })
  it('knows which preset is in use', () => {
    expect(L.presetMatches(L.presetLayout('lifter'), 'lifter')).toBe(true)
    expect(L.presetMatches(L.addTile(L.presetLayout('lifter'), 'app', 'gym'), 'lifter')).toBe(false)
  })
})

describe('the catalogue', () => {
  it('has the tiles and buttons asked for', () => {
    for (const k of ['ex', 'still', 'setOf', 'next', 'weight', 'reps', 'effort', 'warm', 'time', 'dist', 'speed', 'incline', 'level', 'band', 'rest', 'elapsed', 'sets', 'volume', 'hr', 'hrZone', 'kcal', 'equip', 'partner', 'notes', 'pr', 'gym', 'clock']) expect(L.TILES[k]).toBeTruthy()
    for (const k of ['log', 'wDown', 'wUp', 'rDown', 'rUp', 'effort', 'warm', 'restAdd', 'restSkip', 'next', 'prev', 'pause', 'finish', 'addSet']) expect(L.ACTIONS[k]).toBeTruthy()
  })
  it('has every label in every language pack (they are passed to t() by name)', async () => {
    const { readdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(__dirname, '..', 'locales')
    const labels = [...Object.values(L.TILES), ...Object.values(L.ACTIONS)].map(x => x.label)
    for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
      const pack = (await import(join(dir, f))).default
      expect(labels.filter(k => !(k in pack)), f).toEqual([])
    }
  }, 60000)
})
