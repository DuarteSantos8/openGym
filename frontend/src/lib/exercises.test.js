import { describe, it, expect } from 'vitest'
import { matchExercise, normalizeStr, imgSrc, gifSrc } from './exercises.js'
import { _setLangState } from './i18n-core.js'

describe('imgSrc / gifSrc', () => {
  it('prefixes the dataset base onto a bundled exercise\'s own filename', () => {
    expect(imgSrc({ img: '0001.jpg' })).toBe('img/0001.jpg')
    expect(gifSrc({ gif: '0001.gif' })).toBe('gif/0001.gif')
  })

  it('passes a custom exercise\'s own data: URL through untouched', () => {
    const img = 'data:image/jpeg;base64,/9j/AAA='
    const gif = 'data:image/gif;base64,R0lGOD='
    expect(imgSrc({ img })).toBe(img)
    expect(gifSrc({ gif })).toBe(gif)
  })
})

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
