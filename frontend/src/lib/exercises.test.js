import { describe, it, expect, afterEach } from 'vitest'
import { matchExercise, normalizeStr, EXDB, EXIDX, effectiveCatalogue, allExercises, imgSrc, gifSrc, registerExerciseState, isCustomEx, exOr } from './exercises.js'
import { EXALIAS } from './exercises-data.js'
import { _setLangState } from './i18n-core.js'

describe('normalizeStr', () => {
  it('handles null, undefined and empty strings', () => {
    expect(normalizeStr(null)).toBe('')
    expect(normalizeStr(undefined)).toBe('')
    expect(normalizeStr('')).toBe('')
  })

  it('lowercases text and removes diacritics / accents', () => {
    expect(normalizeStr('Elevação Lateral')).toBe('elevacao lateral')
    expect(normalizeStr('SUPINO INCLINADO COM HALTERES')).toBe('supino inclinado com halteres')
    expect(normalizeStr('Tríceps & Panturrilhas')).toBe('triceps & panturrilhas')
    expect(normalizeStr('Quadríceps / Glúteos')).toBe('quadriceps / gluteos')
  })
})

describe('matchExercise', () => {
  const benchPress = {
    id: '0025',
    n: 'barbell bench press',
    bp: 'chest',
    tg: 'pectorals',
    eq: 'barbell',
    sm: ['triceps', 'deltoids'],
    desc: 'Classic chest exercise using a barbell on a flat bench.'
  }

  const lateralRaise = {
    id: '0283',
    n: 'dumbbell lateral raise',
    bp: 'shoulders',
    tg: 'delts',
    eq: 'dumbbell',
    sm: ['traps'],
    desc: 'Shoulder isolation movement.'
  }

  it('returns true for empty or whitespace-only query', () => {
    expect(matchExercise(benchPress, '')).toBe(true)
    expect(matchExercise(benchPress, '   ')).toBe(true)
    expect(matchExercise(benchPress, null)).toBe(true)
  })

  it('matches exact and partial words in exercise name regardless of case', () => {
    expect(matchExercise(benchPress, 'bench')).toBe(true)
    expect(matchExercise(benchPress, 'BENCH')).toBe(true)
    expect(matchExercise(benchPress, 'barbell')).toBe(true)
    expect(matchExercise(benchPress, 'press')).toBe(true)
    expect(matchExercise(benchPress, 'squat')).toBe(false)
  })

  it('matches multiple tokens in ANY order (not just sequential)', () => {
    // "bench barbell" is reversed order compared to "barbell bench press"
    expect(matchExercise(benchPress, 'bench barbell')).toBe(true)
    expect(matchExercise(benchPress, 'press bench barbell')).toBe(true)
    expect(matchExercise(benchPress, 'barbell press chest')).toBe(true)
    expect(matchExercise(benchPress, 'bench squat')).toBe(false)
  })

  it('matches target muscle, equipment, secondary muscles and description', () => {
    expect(matchExercise(benchPress, 'pectorals')).toBe(true)
    expect(matchExercise(benchPress, 'triceps barbell')).toBe(true)
    expect(matchExercise(benchPress, 'flat bench')).toBe(true)
    expect(matchExercise(lateralRaise, 'dumbbell shoulder')).toBe(true)
  })

  it('matches accent-insensitively', () => {
    const customEx = {
      id: 'custom-1',
      n: 'Elevação de Panturrilha',
      bp: 'lower legs',
      tg: 'calves',
      eq: 'body weight',
      desc: 'Exercício para panturrilhas em pé.'
    }

    expect(matchExercise(customEx, 'elevacao')).toBe(true)
    expect(matchExercise(customEx, 'elevação')).toBe(true)
    expect(matchExercise(customEx, 'panturrilha elevacao')).toBe(true)
    expect(matchExercise(customEx, 'ELEVACAO PE')).toBe(true)
  })

  it('matches translated UI terms when a language is active', () => {
    _setLangState('pt', {
      chest: 'peito',
      barbell: 'barra',
      dumbbell: 'halteres',
      shoulders: 'ombros'
    }, null)

    // "peito" is the translated bp, "barra" is the translated eq
    expect(matchExercise(benchPress, 'peito')).toBe(true)
    expect(matchExercise(benchPress, 'barra')).toBe(true)
    expect(matchExercise(benchPress, 'peito barra bench')).toBe(true)
    expect(matchExercise(lateralRaise, 'halteres ombros')).toBe(true)
  })

  // The pt-BR exercise-name pack (!16) renames the catalogue in the UI. Searching has to reach
  // that name as well as the canonical English one, or the library goes dark for pt-BR profiles
  // the moment they type what they see on screen.
  it('matches the localized exercise name as well as the English one', () => {
    _setLangState('pt-BR', {}, null, { '0025': 'supino reto com barra' })

    expect(matchExercise(benchPress, 'supino')).toBe(true)
    expect(matchExercise(benchPress, 'supino barra')).toBe(true)
    expect(matchExercise(benchPress, 'bench press')).toBe(true)   // English still reaches it
    expect(matchExercise(lateralRaise, 'supino')).toBe(false)     // untranslated entry unaffected
  })

  it('rebuilds the cached haystack when the language changes', () => {
    _setLangState('pt-BR', {}, null, { '0025': 'supino reto com barra' })
    expect(matchExercise(benchPress, 'supino')).toBe(true)

    _setLangState('en', null, null, null)
    expect(matchExercise(benchPress, 'supino')).toBe(false)
    expect(matchExercise(benchPress, 'bench')).toBe(true)
  })
})

// Four sled press names came in from the dataset with the degree sign's UTF-8 bytes read as
// cp1251 ("45в°"): they showed that way everywhere, and a search for 45° missed them.
describe('the exercise dataset', () => {
  it('has no names garbled by a wrong text encoding', async () => {
    const { EXDB } = await import('./exercises-data.js')
    const garbled = EXDB.filter(e => /в°|Ã|Â|â€/.test(e.n)).map(e => e.id + ' ' + e.n)
    expect(garbled).toEqual([])
    expect(EXDB.find(e => e.id === '0739').n).toBe('sled 45° leg press')
  })

  it('finds the sled presses by their angle', async () => {
    const { EXDB } = await import('./exercises-data.js')
    const found = EXDB.filter(e => matchExercise(e, '45° leg press')).map(e => e.id)
    expect(found).toEqual(expect.arrayContaining(['0739', '1464', '0740']))
  })
})

describe('exercise state resolution', () => {
  afterEach(() => registerExerciseState({}))

  it('ignores invalid custom entries and clears removed legacy customs', () => {
    const custom = { id: 'legacy-custom', n: 'My lift' }
    expect(() => registerExerciseState({ customEx: [null, undefined, {}, { id: null }, custom] })).not.toThrow()
    expect(EXIDX[custom.id]).toBe(custom)
    expect(isCustomEx(custom)).toBe(true)
    expect(EXIDX.undefined).toBeUndefined()
    for (const customEx of [null, {}, 'invalid']) {
      expect(() => registerExerciseState({ customEx })).not.toThrow()
      expect(EXIDX[custom.id]).toBeUndefined()
      expect(isCustomEx(custom)).toBe(false)
    }
  })

  it('resolves drawing aliases to edited and restored built-ins without listing them twice', () => {
    const [alias, id] = Object.entries(EXALIAS)[0]
    const base = EXIDX[id]
    const state = { customEx: [], exOverrides: { [id]: { n: 'My edited lift' } }, deletedEx: [id] }
    registerExerciseState(state)
    expect(EXIDX[alias].n).toBe('My edited lift')
    expect(EXIDX[alias]).toBe(EXIDX[id])
    expect(Object.keys(EXIDX)).not.toContain(alias)
    expect(allExercises(state).some(e => e.id === id || e.id === alias)).toBe(false)
    registerExerciseState({})
    expect(EXIDX[alias]).toBe(base)
    expect(allExercises({}).filter(e => e.id === id || e.id === alias)).toHaveLength(1)
  })

  it('keeps edited media ahead of figure drawings and uses the new media folders', () => {
    const base = { img: 'male.webp', gif: 'male.mp4', fv: 'female' }
    expect(imgSrc(base, 'female')).toBe('exercise-media/still/female.webp')
    expect(gifSrc(base, 'female')).toBe('exercise-media/clip/female.mp4')
    const local = { img: 'my.webp', gif: 'my.gif' }
    expect(imgSrc({ ...base, ...local, _ov: local }, 'female')).toBe('exercise-media/still/my.webp')
    expect(gifSrc({ ...base, ...local, _ov: local }, 'female')).toBe('exercise-media/clip/my.gif')
    expect(imgSrc({ ...base, img: 'https://example.test/my.webp' }, 'female')).toBe('https://example.test/my.webp')
    expect(gifSrc({ ...base, gif: 'https://example.test/my.mp4' }, 'female')).toBe('https://example.test/my.mp4')
  })

  it('overlays and hides built-ins without changing EXDB', () => {
    const base = EXDB[0]
    const st = { customEx: [], exOverrides: { [base.id]: { n: 'My press', st: ['Set up'] } }, deletedEx: [] }
    expect(effectiveCatalogue(st).find(e => e.id === base.id)).toMatchObject({ n: 'My press', st: ['Set up'] })
    expect(base.n).not.toBe('My press')
    expect(allExercises({ ...st, deletedEx: [base.id] }).some(e => e.id === base.id)).toBe(false)
  })

  it('rebuilds EXIDX from resolved state and preserves absolute media URLs', () => {
    const base = EXDB[0]
    registerExerciseState({ customEx: [], exOverrides: { [base.id]: { n: 'Renamed' } }, deletedEx: [] })
    expect(EXIDX[base.id].n).toBe('Renamed')
    expect(imgSrc({ img: 'https://example.test/image.jpg' })).toBe('https://example.test/image.jpg')
    expect(gifSrc({ gif: 'clip.gif' })).toContain('clip.gif')
  })

  // Hiding a built-in must only affect library/picker/search listing (allExercises' allows()
  // filter) — it must NOT remove the id from EXIDX, or every historical/data lookup that reads
  // EXIDX directly (history rows, PR banners, recovery, muscle balance, Stats...) would silently
  // degrade for a past workout that logged the now-hidden exercise. exOr is kept exercised too
  // as harmless defense-in-depth, but EXIDX itself must resolve the real (possibly overridden)
  // exercise object.
  it('keeps a hidden built-in resolvable in EXIDX with its real name, not removed', () => {
    const base = EXDB[0]
    registerExerciseState({ customEx: [], exOverrides: {}, deletedEx: [base.id] })
    expect(EXIDX[base.id]).toBeDefined()
    expect(EXIDX[base.id].n).toBe(base.n)
    const resolved = exOr(base.id)
    expect(resolved.n).toBe(base.n)
    expect(resolved.n).not.toBe('Unknown exercise')
    expect(resolved.missing).toBeUndefined()
    // Restore so this test's global registerExerciseState call doesn't leak into others.
    registerExerciseState({ customEx: [], exOverrides: {}, deletedEx: [] })
  })
})
