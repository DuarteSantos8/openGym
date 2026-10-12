import { describe, expect, it } from 'vitest'
import { EXDB, EXALIAS } from './exercises-data.js'
import { EXIDX, exOr, figureOf, imgSrc, gifSrc } from './exercises.js'

// The male/female choice for the exercise drawings is a picture and nothing else: ids, history
// and plans never change with it, on any device and in any app version.
describe('exercise drawings: male or female', () => {
  const twin = EXDB.find(e => e.fv && EXALIAS[e.fv])        // male exercise with a hidden female drawing
  const pair = EXDB.find(e => e.mv)                         // v1.3 female exercise whose male twin is its own exercise
  const single = EXDB.find(e => !e.fv && !e.mv)

  it('follows the body diagram until it is set, then the setting', () => {
    expect(figureOf({})).toBe('male')
    expect(figureOf({ body: 'female' })).toBe('female')
    expect(figureOf({ body: 'female', exFigure: 'male' })).toBe('male')
    expect(figureOf({ body: 'male', exFigure: 'female' })).toBe('female')
    expect(figureOf({ exFigure: 'nonsense' })).toBe('male')
  })

  it('swaps only the picture, both ways', () => {
    expect(gifSrc(twin, 'female')).toContain(twin.fv + '.mp4')
    expect(imgSrc(twin, 'female')).toContain(twin.fv + '.webp')
    expect(gifSrc(twin, 'male')).toContain(twin.id + '.mp4')
    expect(gifSrc(pair, 'male')).toContain(pair.mv + '.mp4')
    expect(gifSrc(pair, 'female')).toContain(pair.id + '.mp4')
  })

  it('keeps the one drawing of an exercise drawn once, whatever the setting', () => {
    expect(gifSrc(single, 'female')).toBe(gifSrc(single, 'male'))
  })

  it('resolves a drawing id to the exercise it draws, never to "Unknown exercise"', () => {
    expect(EXIDX[twin.fv]).toBe(EXIDX[twin.id])
    expect(exOr(twin.fv).missing).toBeUndefined()
    expect(exOr(twin.fv).id).toBe(twin.id)
  })

  it('never lists a drawing id as an exercise of its own', () => {
    expect(Object.keys(EXIDX)).not.toContain(twin.fv)
    expect(Object.values(EXIDX).filter(e => e.id === twin.id)).toHaveLength(1)
    for (const id of Object.keys(EXALIAS)) expect(EXDB.some(e => e.id === id), id).toBe(false)
  })
})
