import { describe, expect, it } from 'vitest'
import { CATALOGUE, searchExercises, muscleRole, muscleGroups, muscleHeadLabel } from './exercises.js'

const ex = (id, n, over = {}) => ({ id, n, bp: 'waist', tg: 'abs', eq: 'body weight', sm: [], st: [], ...over })

describe('muscle search tiers', () => {
  const primary = ex('p1', 'Zz slow roll')
  const primaryStretch = ex('p2', 'Zz long hold', { cat: 'stretching' })
  const secondary = ex('s1', 'Barbell squat', { bp: 'upper legs', tg: 'quads', eq: 'barbell', sm: ['abs'] })
  const mention = ex('m1', 'Calf raise', { bp: 'lower legs', tg: 'calves', desc: 'Keep your abs tight.' })

  it('scores primary above secondary above a mere mention', () => {
    expect(muscleRole(primary, ['abs'])).toBe(2)
    expect(muscleRole(secondary, ['abs'])).toBe(1)
    expect(muscleRole(mention, ['abs'])).toBe(0)
  })

  it('lists every primary abs exercise before any secondary one', () => {
    const out = searchExercises([mention, secondary, primaryStretch, primary], 'abs')
    expect(out.map(e => e.id)).toEqual(['p1', 'p2', 's1', 'm1'])
  })

  it('on the real catalogue, no secondary or mention sits above a primary abs exercise', () => {
    const out = searchExercises(CATALOGUE, 'abs')
    const roles = out.map(e => muscleRole(e, ['abs']))
    expect(roles).toEqual([...roles].sort((a, b) => b - a))
    expect(roles[0]).toBe(2)
  })

  it('reads the muscle map primaries and secondaries', () => {
    const mapped = ex('x1', 'Mapped lift', { bp: 'upper legs', tg: 'quads', primaries: ['abs'] })
    const side = ex('x2', 'Side lift', { bp: 'upper legs', tg: 'quads', secondaries: ['abs'] })
    expect(muscleRole(mapped, ['abs'])).toBe(2)
    expect(muscleRole(side, ['abs'])).toBe(1)
  })

  it('adds up several muscles', () => {
    const both = ex('b1', 'Twist', { tg: 'abs', sm: ['obliques'] })
    expect(muscleRole(both, ['abs', 'obliques'])).toBe(3)
  })
})

describe('muscle search headers', () => {
  const main = ex('p1', 'Zz slow roll')
  const also = ex('s1', 'Barbell squat', { bp: 'upper legs', tg: 'quads', eq: 'barbell', sm: ['abs'] })
  const other = ex('m1', 'Calf raise', { bp: 'lower legs', tg: 'calves', desc: 'Keep your abs tight.' })

  it('regroups by bucket and marks the first exercise of each', () => {
    const { list, heads } = muscleGroups([other, also, main], 'abs')
    expect(list.map(e => e.id)).toEqual(['p1', 's1', 'm1'])
    expect([...heads]).toEqual([['p1', 'main'], ['s1', 'also'], ['m1', 'other']])
  })

  it('keeps the incoming order inside a bucket, so favourites stay first', () => {
    const second = ex('p2', 'Another roll')
    expect(muscleGroups([second, main, also], 'abs').list.map(e => e.id)).toEqual(['p2', 'p1', 's1'])
  })

  it('shows no header when only one bucket has results', () => {
    expect(muscleGroups([main, ex('p2', 'Another roll')], 'abs').heads.size).toBe(0)
  })

  it('picks the main muscle from the results when the search is not a muscle search', () => {
    const curl = ex('c1', 'Dumbbell curl', { bp: 'upper arms', tg: 'biceps', eq: 'dumbbell' })
    const curl2 = ex('c2', 'Barbell curl', { bp: 'upper arms', tg: 'biceps', eq: 'barbell' })
    const row = ex('r1', 'Curl grip row', { bp: 'back', tg: 'lats', eq: 'cable', sm: ['biceps'] })
    const press = ex('r2', 'Curl and press', { bp: 'shoulders', tg: 'delts', eq: 'dumbbell' })
    const { list, heads, name } = muscleGroups([press, curl, row, curl2], 'curl')
    expect(name).toBe('biceps')
    expect(list.map(e => e.id)).toEqual(['c1', 'c2', 'r1', 'r2'])
    expect([...heads]).toEqual([['c1', 'main'], ['r1', 'also'], ['r2', 'other']])
  })

  it('reads core and abdominals as abs, and the muscle map names as the targets', () => {
    const squat = ex('q1', 'Squat', { bp: 'upper legs', tg: 'quads', sm: ['core'] })
    expect(muscleRole(squat, ['abs'])).toBe(1)
    const lift = ex('q2', 'Lift', { bp: 'upper legs', tg: 'quads', primaries: ['quadriceps'] })
    const other = ex('q3', 'Other', { bp: 'upper legs', tg: 'quads', sm: ['hamstrings'] })
    expect(muscleGroups([other, lift, ex('q4', 'Quad one', { bp: 'upper legs', tg: 'quads' })], 'zzz').heads.size).toBe(0)
  })

  it('names the muscle for a muscle search from the results, and says nothing for an empty search', () => {
    expect(muscleGroups([main, also, other], 'abs').name).toBe('abs')
    expect(muscleGroups([main, also], '').heads.size).toBe(0)
    expect(muscleGroups([], 'abs').heads.size).toBe(0)
  })

  it('has a label for every bucket', () => {
    expect(['main', 'also', 'other'].map(k => muscleHeadLabel(k, ' Abs '))).toEqual(['Mainly works abs', 'Also works abs', 'Other matches'])
  })
})
