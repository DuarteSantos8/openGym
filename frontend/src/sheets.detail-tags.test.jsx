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

  it('sums to 100 with largest-remainder allocation (six equal primaries)', () => {
    const ex = { eq: 'barbell', bp: 'full body', primaries: ['trapezius', 'deltoids', 'chest', 'abs', 'biceps', 'triceps'] }
    const tags = detailTags(ex)
    const nums = tags.flatMap(x => x.other ? x.other.map(o => parseInt(o.pct)) : [parseInt(x.label.match(/(\d+)%/)?.[1] || '0')]).filter(n => n > 0)
    expect(nums.reduce((s, n) => s + n, 0)).toBe(100)
    // No 6x17=102 anymore: four get 17, two get 16.
    expect([...nums].sort((a, b) => b - a)).toEqual([17, 17, 17, 17, 16, 16])
  })

  it('shows fallback muscles for a custom exercise with only a body part', () => {
    const tags = detailTags({ eq: 'custom', bp: 'upper legs' })
    const l = tags.map(x => x.label.toLowerCase())
    expect(l.join(' ')).toContain('quads')
    const nums = tags.map(x => parseInt(x.label.match(/(\d+)%/)?.[1] || '0')).filter(n => n > 0)
    expect(nums.reduce((s, n) => s + n, 0)).toBe(100)
  })

  it('folds the body-part muscle into its tag instead of counting it twice', () => {
    const ex = { eq: 'barbell', bp: 'chest', primaries: ['trapezius', 'deltoids', 'chest', 'abs'] }
    const tags = detailTags(ex)
    const l = tags.map(x => x.label.toLowerCase())
    expect(l.filter(x => x.startsWith('chest')).length).toBe(1)
    const nums = tags.map(x => parseInt(x.label.match(/(\d+)%/)?.[1] || '0')).filter(n => n > 0)
    expect(nums.reduce((s, n) => s + n, 0)).toBe(100)
  })
})
