// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { detailTags } from './sheets.jsx'
import { exOr } from './lib/exercises.js'

// QA 10-06: the bench press showed "Chest" twice on its detail page, once as the body part and
// once as the main muscle.
describe('the exercise detail tags', () => {
  const labels = id => detailTags(exOr(id)).map(x => x.label.toLowerCase())

  it('say Chest once on a bench press, with the body part first', () => {
    const l = labels('0025')
    expect(l.filter(x => x === 'chest')).toHaveLength(1)
    expect(detailTags(exOr('0025'))[0]).toMatchObject({ acc: true })
    expect(new Set(l).size).toBe(l.length)
  })

  it('never repeat a word across the whole catalogue, and keep at most three helpers', () => {
    for (const id of ['0025', '0030', '1254', '0001', '0043', '0032']) {
      const tags = detailTags(exOr(id))
      const l = tags.map(x => x.label.toLowerCase())
      expect(new Set(l).size, id).toBe(l.length)
      expect(tags.filter(x => !x.icon && !x.acc).length, id).toBeLessThanOrEqual(3)
    }
  })
})
