import { describe, expect, it } from 'vitest'
import { answerRuleCoach, RULE_COACH_QUESTIONS } from './rule-coach.js'

const empty = { routines: [], workouts: [], week: {}, dayPlan: {}, bodyweight: [], unit: 'kg', targetW: null }

describe('rule-based Coach', () => {
  it('offers a fixed set of questions, with no free-text prompt', () => {
    expect(RULE_COACH_QUESTIONS.map(q => q.id)).toEqual(['week', 'next', 'strength', 'goal', 'improve'])
  })

  it('returns a useful, honest answer for an empty profile', () => {
    expect(answerRuleCoach(empty, 'week').lines.join(' ')).toContain('No training days are scheduled')
    expect(answerRuleCoach(empty, 'next').lines.join(' ')).toContain('routine')
    expect(answerRuleCoach(empty, 'strength').summary).toContain('needed')
    expect(answerRuleCoach(empty, 'goal').summary).toContain('No target body weight')
    expect(answerRuleCoach(empty, 'improve').lines.join(' ')).toContain('No plan yet')
  })

  it('does not answer unknown question ids', () => {
    expect(answerRuleCoach(empty, 'custom-question')).toBeNull()
  })

  it('uses the actual saved target and weigh-ins', () => {
    const state = {
      ...empty,
      targetW: 80,
      bodyweight: [{ d: '2026-10-01', w: 83 }, { d: '2026-10-08', w: 82.5 }],
    }
    const answer = answerRuleCoach(state, 'goal')
    expect(answer.summary).toContain('82.5')
    expect(answer.summary).toContain('80')
  })
})
