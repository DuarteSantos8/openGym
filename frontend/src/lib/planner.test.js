import { describe, it, expect } from 'vitest'
import { planFor, cleanAnswers, levelFor, sessionMinutes, everyAnswer, GOALS, EQUIPMENT, EXPERIENCE, DAYS, MINUTES, LIMITS, DEFAULT_ANSWERS } from './planner.js'
import { STARTER_PLANS } from '../../../api/coach/core/starter-plans.js'
import { buildPlanFrom } from './starter.js'
import { EXIDX } from './exercises.js'

const base = { goal: 'general', days: 3, minutes: 45, equipment: 'gym', experience: 'never', limits: [] }

describe('cleanAnswers', () => {
  it('falls back to the defaults for anything that is not an option', () => {
    expect(cleanAnswers(null)).toEqual({ ...DEFAULT_ANSWERS, limits: [] })
    expect(cleanAnswers({ goal: 'abs', days: 9, minutes: 5, equipment: 'yacht', experience: 'pro', limits: 'knees' }))
      .toEqual({ ...DEFAULT_ANSWERS, limits: [] })
  })
  it('keeps valid answers, numbers given as text included, and only known limitations', () => {
    expect(cleanAnswers({ goal: 'muscle', days: '4', minutes: '30', equipment: 'bands', experience: 'some', limits: ['back', 'hair', 'knees'] }))
      .toEqual({ goal: 'muscle', days: 4, minutes: 30, equipment: 'bands', experience: 'some', limits: ['knees', 'back'] })
  })
})

describe('planFor', () => {
  it('gives the same plan for the same answers, every time', () => {
    for (const a of everyAnswer().filter((_, i) => i % 7 === 0)) expect(planFor(a)).toEqual(planFor({ ...a }))
  })

  it('covers every combination of answers with a usable plan', () => {
    const all = everyAnswer()
    expect(all.length).toBe(GOALS.length * DAYS.length * MINUTES.length * EQUIPMENT.length * EXPERIENCE.length)
    for (const a of all) {
      const p = planFor(a)
      const label = JSON.stringify(a)
      expect(STARTER_PLANS[p.planId], label).toBeTruthy()
      expect(p.days, label).toBeLessThanOrEqual(a.days)
      expect(p.weekdays.length, label).toBe(p.days)
      expect(p.schedule.length, label).toBe(p.days)
      expect(new Set(p.weekdays).size, label).toBe(p.days)
      const keys = new Set(p.routines.map(r => r[0]))
      for (const [day, key] of p.schedule) {
        expect(day >= 0 && day <= 6, label).toBe(true)
        expect(keys.has(key), label).toBe(true)
      }
      for (const [, , , list] of p.routines) {
        expect(list.length, label).toBeGreaterThanOrEqual(1)
        for (const line of list) {
          expect(EXIDX[line[0]], label + ' ' + line[0]).toBeTruthy()
          expect(line[1] >= 1 && line[1] <= 5, label).toBe(true)
          expect(line[2] > 0, label).toBe(true)
        }
      }
      expect(p.why.length, label).toBeGreaterThanOrEqual(2)
    }
  })

  it('never uses equipment the answer did not offer', () => {
    const want = { dumbbells: 'dumbbells', bands: 'bands', none: 'home-bw', hotel: 'hotel' }
    for (const a of everyAnswer()) {
      const p = planFor(a)
      if (a.equipment === 'gym') expect(['full-body', 'upper-lower', 'ppl', '5x5']).toContain(p.planId)
      else expect(p.planId).toBe(want[a.equipment])
    }
  })

  it('starts someone who never lifted on full body, three days at most, at a beginner dose', () => {
    for (const days of DAYS) for (const goal of GOALS) {
      const p = planFor({ ...base, days, goal })
      expect(p.planId).toBe('full-body')
      expect(p.level).toBe('beginner')
      expect(p.days).toBe(Math.min(days, 3))
      expect(p.dose.sets).toBeLessThanOrEqual(3)
      expect(p.dose.reps).toBeGreaterThanOrEqual(8)
      expect(p.dose.reps).toBeLessThanOrEqual(12)
    }
    expect(planFor({ ...base, days: 5 }).why).toContain('days-capped')
    expect(planFor({ ...base, days: 3 }).why).not.toContain('days-capped')
  })

  it('applies the dose to every repetition exercise and keeps a hold in seconds', () => {
    const p = planFor({ ...base, equipment: 'none', goal: 'general', minutes: 60 })
    expect(p.planId).toBe('home-bw')
    const lines = p.routines.flatMap(r => r[3])
    for (const line of lines.filter(l => l[3] !== 'time')) expect(line.slice(1, 3)).toEqual([p.dose.sets, p.dose.reps])
    const hold = lines.find(l => l[3] === 'time')
    expect(hold).toBeTruthy()
    expect(hold[1]).toBe(p.dose.sets)
    expect(hold[2]).toBeGreaterThanOrEqual(30)
  })

  it('fills the week by taking the sessions in turns', () => {
    const p = planFor({ ...base, equipment: 'none', days: 3 })
    expect(p.schedule.map(s => s[1])).toEqual(['home-a', 'home-b', 'home-a'])
    expect(p.weekdays).toEqual([1, 3, 5])
    expect(planFor({ ...base, days: 2 }).schedule).toEqual([[1, 'fb-a'], [4, 'fb-b']])
    expect(planFor({ ...base, days: 2 }).routines.map(r => r[0])).toEqual(['fb-a', 'fb-b'])
  })

  it('leaves the plan as written for someone who trains regularly', () => {
    const p = planFor({ ...base, experience: 'regular', goal: 'muscle', days: 4, minutes: 60 })
    expect(p.planId).toBe('upper-lower')
    expect(p.level).toBe('intermediate')
    expect(p.dose).toBe(null)
    const written = STARTER_PLANS['upper-lower'].routines.find(r => r[0] === 'lower-a')[3]
    expect(p.routines.find(r => r[0] === 'lower-a')[3]).toEqual(written)
  })

  it('picks the plan by days and goal once there is experience', () => {
    const reg = { ...base, experience: 'regular', minutes: 60 }
    expect(planFor({ ...reg, goal: 'strength', days: 3 }).planId).toBe('5x5')
    expect(planFor({ ...reg, goal: 'strength', days: 3, minutes: 45 }).planId).toBe('full-body')
    expect(planFor({ ...reg, goal: 'muscle', days: 5 }).planId).toBe('ppl')
    expect(planFor({ ...reg, goal: 'muscle', days: 5 }).schedule.map(s => s[1])).toEqual(['push', 'pull', 'legs', 'push', 'pull'])
    expect(planFor({ ...reg, goal: 'general', days: 3 }).planId).toBe('full-body')
    const some = planFor({ ...base, experience: 'some', days: 5 })
    expect(some.planId).toBe('upper-lower')
    expect(some.days).toBe(4)
    expect(some.level).toBe('beginner')
  })

  it('trims a session to the minutes, from the end, and says so', () => {
    const long = planFor({ ...base, minutes: 60 })
    const short = planFor({ ...base, minutes: 20 })
    expect(long.why).not.toContain('trimmed')
    expect(short.why).toContain('trimmed')
    for (const [key, , , list] of short.routines) {
      const full = long.routines.find(r => r[0] === key)[3]
      expect(list.length).toBeGreaterThanOrEqual(3)
      expect(list).toEqual(full.slice(0, list.length))
    }
    expect(short.minutes).toBeLessThanOrEqual(22)
  })

  it('stays within a few minutes of what was asked wherever three exercises can fit', () => {
    for (const a of everyAnswer()) {
      const p = planFor(a)
      const shortest = Math.min(...p.routines.map(r => r[3].length))
      if (shortest > 3) expect(p.minutes, JSON.stringify(a)).toBeLessThanOrEqual(a.minutes + 2)
    }
  })

  it('only ever gets gentler with a limitation ticked, and never recommends heavy fives', () => {
    for (const limit of LIMITS) for (const a of everyAnswer().filter((_, i) => i % 11 === 0)) {
      const plain = planFor(a), careful = planFor({ ...a, limits: [limit] })
      expect(careful.caution).toBe(true)
      expect(careful.why).toContain('caution')
      expect(careful.planId).not.toBe('5x5')
      expect(careful.dose.sets).toBeLessThanOrEqual(2)
      expect(careful.dose.reps).toBeGreaterThanOrEqual(12)
      expect(careful.days).toBe(plain.days)
    }
    expect(planFor(base).caution).toBe(false)
  })

  it('asks for a professional first only for the two answers that call for one', () => {
    expect(planFor({ ...base, limits: ['knees', 'back', 'shoulders'] }).askFirst).toBe(false)
    expect(planFor({ ...base, limits: ['pregnancy'] }).askFirst).toBe(true)
    expect(planFor({ ...base, limits: ['clinician'] }).askFirst).toBe(true)
  })

  it('explains itself with reasons it acted on', () => {
    expect(planFor(base).why).toEqual(['plan-full-body', 'goal-general'])
    expect(planFor({ ...base, equipment: 'bands', goal: 'fatloss' }).why).toEqual(['equipment', 'goal-fatloss'])
    // the goal's own reason is left out when the gentle dose replaced the goal's
    expect(planFor({ ...base, days: 5, minutes: 20, limits: ['back'] }).why).toEqual(['plan-full-body', 'days-capped', 'trimmed', 'caution'])
    expect(planFor({ ...base, goal: 'muscle', limits: ['knees'] }).why).toEqual(['plan-full-body', 'caution'])
  })

  it('maps the experience answer to a level', () => {
    expect(levelFor('never')).toBe('beginner')
    expect(levelFor('some')).toBe('beginner')
    expect(levelFor('regular')).toBe('intermediate')
  })
})

describe('sessionMinutes', () => {
  it('counts sets, rests, moving between exercises and a warm-up', () => {
    // 5 min warm-up + 2 × (2 sets × (40 s + 60 s) + 60 s) = 300 + 520 s
    expect(sessionMinutes([['0043', 2, 12], ['0025', 2, 12]], 60)).toBe(Math.round(820 / 60))
    // a hold counts its own seconds
    expect(sessionMinutes([['0463', 3, 40, 'time']], 60)).toBe(Math.round((300 + 3 * 100 + 60) / 60))
  })
})

describe('with the starter builder', () => {
  it('turns every plan into routines on its weekdays', () => {
    for (const a of everyAnswer().filter((_, i) => i % 13 === 0)) {
      const p = planFor(a)
      const built = buildPlanFrom(p)
      expect(built.routines.length).toBe(p.routines.length)
      expect(built.schedule.map(s => s.day)).toEqual(p.weekdays)
      const ids = new Set(built.routines.map(r => r.id))
      for (const s of built.schedule) expect(ids.has(s.routineId)).toBe(true)
      for (const r of built.routines) for (const e of r.ex) expect(e.sets).toBeGreaterThan(0)
    }
  })
  it('refuses what is not a plan', () => {
    expect(buildPlanFrom(null)).toBe(null)
    expect(buildPlanFrom({ routines: [] })).toBe(null)
  })
})
