// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { detailTags } from './sheets.jsx'
import { exOr } from './lib/exercises.js'

// QA 10-06: the bench press showed "Chest" twice on its detail page, once as the body part and
// once as the main muscle. Order (user): equipment first, then the body part and the muscles.
describe('the exercise detail tags', () => {
  const tagsOf = id => detailTags(exOr(id))
  const labels = id => tagsOf(id).map(x => x.label.toLowerCase())

  it('lead with the equipment, then say Chest once as the body part (acc)', () => {
    const tags = tagsOf('0025')
    expect(tags[0]).toMatchObject({ icon: 'kettlebell', label: 'barbell' })
    expect(tags[1]).toMatchObject({ acc: true })
    expect(labels('0025').filter(x => x === 'chest 56%')).toHaveLength(1)
    expect(new Set(labels('0025')).size).toBe(tags.length)
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
