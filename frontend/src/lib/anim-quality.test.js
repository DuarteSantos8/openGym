import { describe, expect, it } from 'vitest'
import {
  PACK_QUALITIES, BUILTIN_PX, packQualities, packId, parsePackId, autoPx, readChoice, wantedQuality,
  packDrawingId, clipSources, wantedPack,
} from './anim-quality.js'
import { EXDB } from './exercises-data.js'

/* Which file an exercise animation is drawn from in the store apps (lib/anim-quality.js). Only
   names are looked at here: no media file is ever opened. */
const male = { id: '0001', gif: '0001.mp4', img: '0001.webp', fv: '2476' }        // drawn on both figures
const female = { id: '9001', gif: '9001.mp4', img: '9001.webp', mv: '9002' }      // a female exercise with a male twin
const once = { id: '5965', gif: '5965.mp4', img: '5965.webp' }                    // drawn once
const base = (px, fig) => `http://localhost/_capacitor_file_/packs/anim-${px}-${fig}`
const all = fig => Object.fromEntries(PACK_QUALITIES.map(px => [packId(px, fig), base(px, fig)]))
const phone = { shortSide: 390 }, tablet = { shortSide: 820 }

describe('choices and qualities', () => {
  it('the repository build has 180 px built in and offers every pack above it', () => {
    expect(BUILTIN_PX).toBe(180)
    expect(packQualities()).toEqual([240, 360, 480, 720, 1080])
    expect(packQualities(240)).toEqual([360, 480, 720, 1080])
  })
  it('auto is 360 on a phone, 720 on a tablet', () => {
    expect(autoPx(phone)).toBe(360)
    expect(autoPx(tablet)).toBe(720)
    expect(autoPx()).toBe(360)
  })
  it('reads anything unknown as auto', () => {
    for (const v of [undefined, null, '', 'hd', 999, '360px', {}]) expect(readChoice(v)).toBe('auto')
    expect(readChoice('720')).toBe(720)
    expect(readChoice('still')).toBe('still')
  })
  it('a pack no sharper than the built-in files is the built-in files', () => {
    expect(wantedQuality(240, phone, 240)).toBe('builtin')
    expect(wantedQuality(480, phone, 240)).toBe(480)
    expect(wantedQuality('auto', tablet)).toBe(720)
  })
  it('names packs per quality and figure, and reads them back', () => {
    expect(packId(720, 'female')).toBe('anim-720-female')
    expect(packId(720, 'whatever')).toBe('anim-720-male')
    expect(parsePackId('anim-1080-male')).toEqual({ px: 1080, figure: 'male' })
    expect(parsePackId('anim-999-male')).toBeNull()
    expect(wantedPack('auto', 'female', phone)).toBe('anim-360-female')
    expect(wantedPack('still', 'male', phone)).toBeNull()
    expect(wantedPack('builtin', 'male', phone)).toBeNull()
  })
})

describe('packDrawingId', () => {
  it('the twin on that figure, else the exercise’s own drawing', () => {
    expect(packDrawingId(male, 'male')).toBe('0001')
    expect(packDrawingId(male, 'female')).toBe('2476')
    expect(packDrawingId(female, 'male')).toBe('9002')
    expect(packDrawingId(female, 'female')).toBe('9001')
    expect(packDrawingId(once, 'female')).toBe('5965')
    expect(packDrawingId(once, 'male')).toBe('5965')
  })
  it('agrees with lib/exercises.js gifSrc for every catalogue exercise', async () => {
    const { gifSrc } = await import('./exercises.js')
    for (const ex of EXDB) {
      for (const fig of ['male', 'female']) {
        expect(gifSrc(ex, fig).split('/').pop().replace(/\.(mp4|webp)$/, ''), ex.id + ' ' + fig).toBe(packDrawingId(ex, fig))
      }
    }
  })
})

describe('clipSources', () => {
  const builtin = 'exercise-media/clip/0001.webp'
  it('the chosen pack first, then every smaller one installed, then the built-in file', () => {
    const r = clipSources({ ex: male, figure: 'female', choice: 720, device: phone, installed: all('female'), builtin })
    expect(r.sources).toEqual([
      base(720, 'female') + '/2476.webp', base(480, 'female') + '/2476.webp', base(360, 'female') + '/2476.webp',
      base(240, 'female') + '/2476.webp', builtin,
    ])
  })
  it('the chosen pack not there yet: the next smaller one of the same figure, never the other figure’s', () => {
    const installed = { [packId(360, 'male')]: base(360, 'male'), [packId(1080, 'female')]: base(1080, 'female') }
    const r = clipSources({ ex: male, figure: 'male', choice: 720, device: phone, installed, builtin })
    expect(r.sources).toEqual([base(360, 'male') + '/0001.webp', builtin])
  })
  it('nothing installed: the built-in file, so there is never a blank', () => {
    for (const choice of ['auto', 240, 360, 480, 720, 1080, 'builtin', 'nonsense']) {
      expect(clipSources({ ex: once, figure: 'female', choice, device: tablet, installed: {}, builtin }).sources).toEqual([builtin])
    }
  })
  it('built in means built in, even with packs installed', () => {
    expect(clipSources({ ex: male, figure: 'male', choice: 'builtin', installed: all('male'), builtin }).sources).toEqual([builtin])
  })
  it('still only: no animation at all, the caller shows the still', () => {
    expect(clipSources({ ex: male, figure: 'male', choice: 'still', installed: all('male'), builtin })).toEqual({ still: true, sources: [] })
  })
  it('auto follows the device: a phone reads up to 360, a tablet up to 720', () => {
    const p = clipSources({ ex: once, figure: 'male', choice: 'auto', device: phone, installed: all('male'), builtin })
    expect(p.sources[0]).toBe(base(360, 'male') + '/5965.webp')
    const t = clipSources({ ex: once, figure: 'male', choice: 'auto', device: tablet, installed: all('male'), builtin })
    expect(t.sources[0]).toBe(base(720, 'male') + '/5965.webp')
  })
  it('a pack whose base is missing or empty counts as not there', () => {
    const r = clipSources({ ex: once, figure: 'male', choice: 360, installed: { [packId(360, 'male')]: '' }, builtin })
    expect(r.sources).toEqual([builtin])
  })
})
