import { describe, it, expect } from 'vitest'
import { LEVELS, isLevel, experienceOf, levelModules, applyExperience, simpleWorkout, stepUpSuggestion, STEP_UP } from './experience.js'
import { MODULE, isOn } from './modules.js'

describe('experience levels', () => {
  it('knows its three levels and nothing else', () => {
    expect(LEVELS).toEqual(['beginner', 'intermediate', 'advanced'])
    expect(isLevel('beginner')).toBe(true)
    expect(isLevel('expert')).toBe(false)
    expect(isLevel(undefined)).toBe(false)
  })

  it('reads no level from a profile that never chose', () => {
    expect(experienceOf({})).toBe(null)
    expect(experienceOf(null)).toBe(null)
    expect(experienceOf({ experience: 'guru' })).toBe(null)
    expect(experienceOf({ experience: 'advanced' })).toBe('advanced')
  })

  it('only ever names modules that exist', () => {
    for (const level of LEVELS) for (const id of Object.keys(levelModules(level))) expect(MODULE[id], id).toBeTruthy()
    expect(levelModules('nope')).toBe(null)
  })

  it('never touches a module that is connected to something or holds data', () => {
    const untouched = ['watch', 'health', 'body', 'coach', 'integrations', 'community', 'nutrition', 'checkin', 'motivation', 'seasonal', 'bodyfocus']
    for (const level of LEVELS) for (const id of untouched) expect(id in levelModules(level), `${level}/${id}`).toBe(false)
  })

  it('shows more with every level, never less', () => {
    const count = level => Object.values(levelModules(level)).filter(Boolean).length
    expect(count('beginner')).toBeLessThan(count('intermediate'))
    expect(count('intermediate')).toBeLessThan(count('advanced'))
    for (const [id, on] of Object.entries(levelModules('intermediate'))) if (on) expect(levelModules('advanced')[id]).toBe(true)
  })

  it('writes the level and its modules, keeping every other module choice', () => {
    const s = { modules: { nutrition: true, watch: false } }
    expect(applyExperience(s, 'beginner')).toBe(true)
    expect(s.experience).toBe('beginner')
    expect(s.modules).toEqual({ nutrition: true, watch: false, effort: false, plates: false, strength: false, videos: false })
    expect(isOn(s, 'effort')).toBe(false)
    expect(isOn(s, 'body')).toBe(true)
    applyExperience(s, 'advanced')
    expect(isOn(s, 'effort')).toBe(true)
    expect(isOn(s, 'videos')).toBe(true)
    expect(s.modules.nutrition).toBe(true)
    expect(s.modules.watch).toBe(false)
  })

  it('changes nothing for an unknown level', () => {
    const s = { modules: { effort: true } }
    expect(applyExperience(s, 'wizard')).toBe(false)
    expect(s).toEqual({ modules: { effort: true } })
  })

  it('copes with a profile that has no modules map yet', () => {
    const s = {}
    applyExperience(s, 'intermediate')
    expect(s.modules.effort).toBe(true)
    const broken = { modules: ['oops'] }
    applyExperience(broken, 'beginner')
    expect(broken.modules.effort).toBe(false)
  })

  it('keeps the workout simple for a Beginner only', () => {
    expect(simpleWorkout({ experience: 'beginner' })).toBe(true)
    expect(simpleWorkout({ experience: 'intermediate' })).toBe(false)
    expect(simpleWorkout({})).toBe(false)
  })

  describe('stepUpSuggestion', () => {
    const days = (n, start = '2026-01-05', gap = 3) => Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.parse(start + 'T00:00:00Z') + i * gap * 86400e3)
      return { d: d.toISOString().slice(0, 10) }
    })

    it('waits for both enough sessions and enough weeks', () => {
      const few = { experience: 'beginner', workouts: days(STEP_UP.workouts - 1) }
      expect(stepUpSuggestion(few, '2026-06-01')).toBe(null)
      const fast = { experience: 'beginner', workouts: days(STEP_UP.workouts, '2026-01-05', 1) }
      expect(stepUpSuggestion(fast, '2026-01-20')).toBe(null)
      expect(stepUpSuggestion(fast, '2026-02-16')).toBe('intermediate')
    })

    it('is only for a Beginner', () => {
      const w = days(40)
      expect(stepUpSuggestion({ experience: 'intermediate', workouts: w }, '2026-12-01')).toBe(null)
      expect(stepUpSuggestion({ workouts: w }, '2026-12-01')).toBe(null)
    })

    it('ignores entries without a usable date', () => {
      const w = [...days(11), { d: 'soon' }, null, {}]
      expect(stepUpSuggestion({ experience: 'beginner', workouts: w }, '2026-12-01')).toBe(null)
    })
  })
})
