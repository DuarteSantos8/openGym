import { describe, it, expect } from 'vitest'
import { EXERCISE_GUIDES, guideFor, guidedIds, ladderFor, isReviewed, problems, GUIDE_LEVELS, PATTERNS } from './exercise-guide.js'
import { EXIDX } from './exercises.js'
import { STARTER_PLANS } from '../../../api/coach/core/starter-plans.js'
import { planFor, everyAnswer } from './planner.js'

const exists = id => !!EXIDX[id]

describe('exercise guides', () => {
  it('have nothing wrong with them', () => {
    expect(problems(exists)).toEqual([])
  })

  it('cover every exercise a starter plan uses', () => {
    const used = new Set()
    for (const plan of Object.values(STARTER_PLANS)) for (const r of plan.routines) for (const line of r[3]) used.add(line[0])
    expect(used.size).toBeGreaterThan(30)
    const missing = [...used].filter(id => !guideFor(id)).map(id => `${id} ${EXIDX[id]?.n}`)
    expect(missing).toEqual([])
  })

  it('so every plan Find my plan can hand out is covered from its first session', () => {
    for (const a of everyAnswer().filter((_, i) => i % 5 === 0)) {
      for (const [, , , list] of planFor(a).routines) for (const line of list) expect(guideFor(line[0]), JSON.stringify(a) + ' ' + line[0]).toBeTruthy()
    }
  })

  it('are all drafts until a named person has read them', () => {
    for (const id of guidedIds()) {
      const g = guideFor(id)
      expect(['draft', 'reviewed']).toContain(g.review)
      if (g.review === 'draft') expect(isReviewed(g)).toBe(false)
    }
    expect(isReviewed({ review: 'reviewed', reviewer: 'A. Person', reviewed: '2026-12-01' })).toBe(true)
    expect(isReviewed({ review: 'reviewed', reviewer: ' ' })).toBe(false)
    expect(isReviewed({ review: 'reviewed' })).toBe(false)
    expect(isReviewed(null)).toBe(false)
  })

  it('point their ladders at real exercises, and never in a circle', () => {
    let rungs = 0
    for (const id of guidedIds()) {
      const { easier, harder } = ladderFor(id, exists)
      for (const x of [easier, harder]) if (x) { rungs++; expect(EXIDX[x], `${id} → ${x}`).toBeTruthy(); expect(x).not.toBe(id) }
    }
    expect(rungs).toBeGreaterThan(30)
  })

  it('give a beginner plan beginner exercises', () => {
    // Someone who has never lifted gets full body in a gym: none of it may be marked advanced.
    for (const [, , , list] of planFor({ experience: 'never', equipment: 'none' }).routines) {
      for (const line of list) expect(guideFor(line[0]).level, line[0]).not.toBe('advanced')
    }
  })

  it('make no promise, no diagnosis, and link nowhere', () => {
    const text = JSON.stringify(EXERCISE_GUIDES).toLowerCase()
    for (const word of ['guarantee', 'cure', 'diagnos', 'injur', 'rehab', 'http', 'www.']) expect(text.includes(word), word).toBe(false)
  })

  it('never use an em dash, like the rest of the app\'s text', () => {
    expect(JSON.stringify(EXERCISE_GUIDES)).not.toMatch(/[—–]/)
  })

  it('know their enums', () => {
    expect(GUIDE_LEVELS).toEqual(['beginner', 'intermediate', 'advanced'])
    expect(PATTERNS.length).toBe(new Set(PATTERNS).size)
  })
})

describe('guideFor and ladderFor', () => {
  it('return nothing for an exercise without a guide', () => {
    expect(guideFor('no-such-id')).toBe(null)
    expect(guideFor(null)).toBe(null)
    expect(guideFor('constructor')).toBe(null)
    expect(ladderFor('no-such-id')).toEqual({ easier: null, harder: null })
  })
  it('accept a number or a string id', () => {
    expect(guideFor(1197)).toBe(guideFor('1197'))
    expect(guideFor('1197').pattern).toBe('squat')
  })
  it('leave out a rung the catalogue no longer has', () => {
    const real = ladderFor('1760', exists)
    expect(real).toEqual({ easier: '1197', harder: '0043' })
    expect(ladderFor('1760', id => id !== '0043')).toEqual({ easier: '1197', harder: null })
  })
})

describe('problems', () => {
  it('reports an exercise the catalogue does not have', () => {
    expect(problems(id => id !== '1197').some(p => p.startsWith('1197: not in the catalogue'))).toBe(true)
    expect(problems(id => id !== '0043').some(p => p.includes('harder is not in the catalogue'))).toBe(true)
  })
})
