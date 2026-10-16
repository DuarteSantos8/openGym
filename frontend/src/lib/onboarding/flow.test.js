// The onboarding's skip map and navigation rules (ux-onboarding §3b).
import { describe, expect, it } from 'vitest'
import {
  answeredByData, codeOf, detourOf, isFlowPath, missingYou, navOf, nextAfter, nextIsDone, pathOf, planOwed, previousOf, progressMax,
  resumeScreen, screenOf, skipTarget, stepOf, stepsLeft,
} from './flow.js'

describe('steps left (§6), counted as the progress bar counts them', () => {
  it('counts the bar\'s steps the hub still names, from the one on screen', () => {
    expect(stepsLeft(['goal', 'body', 'training', 'plan'], 'goal')).toBe(3)
    // Training and its plan are one step of the bar.
    expect(stepsLeft(['body', 'training', 'plan'], 'height')).toBe(2)
    expect(stepsLeft(['training', 'plan'], 'training')).toBe(1)
    // A step behind the one on screen is not left, whatever an older read said.
    expect(stepsLeft(['goal', 'body', 'training', 'plan'], 'plan')).toBe(1)
    expect(stepsLeft([], 'weight')).toBe(0)
  })

  it('says nothing where the bar is not shown or the hub has not answered', () => {
    expect(stepsLeft(['plan'], 'finish')).toBeNull()
    expect(stepsLeft(['goal'], 'name')).toBeNull()
    expect(stepsLeft(null, 'goal')).toBeNull()
  })
})

const body = (o = {}) => ({ sex: null, birthYear: null, heightCm: null, weightKg: null, ...o })
const full = body({ sex: 'female', birthYear: 1990, heightCm: 168, weightKg: 64 })

describe('paths', () => {
  it('maps every screen to its hash route and back', () => {
    expect(pathOf('invite', 'AB12')).toBe('/join/AB12')
    expect(pathOf('goal')).toBe('/onboarding/goal')
    expect(screenOf('/join/AB12')).toBe('invite')
    expect(screenOf('/onboarding/starter')).toBe('starter')
    expect(screenOf('/onboarding')).toBeNull()
    expect(screenOf('/onboarding/nope')).toBeNull()
    expect(screenOf('/home')).toBeNull()
    expect(codeOf('/join/AB%2012')).toBe('AB 12')
    expect(codeOf('/join')).toBeNull()
    expect(isFlowPath('/onboarding')).toBe(true)
    expect(isFlowPath('/join')).toBe(true)
    expect(isFlowPath('/joinery')).toBe(false)
  })
})

describe('the skip map', () => {
  it('runs invite → name → passkey → goal → the four About-you steps → training', () => {
    const order = ['invite', 'name', 'passkey', 'goal', 'sex', 'born', 'height', 'weight']
    order.forEach((s, i) => expect(nextAfter(s, {})).toBe(i < order.length - 1 ? order[i + 1] : 'training'))
  })

  it('goes from Training to the end on 0 days or a skip, to Plan otherwise', () => {
    expect(nextAfter('training', { answers: { trainingDays: 0 } })).toBe('finish')
    expect(nextAfter('training', { answers: { trainingDays: null } })).toBe('finish')
    expect(nextAfter('training', { answers: { trainingDays: 3 } })).toBe('plan')
    expect(nextAfter('plan', {})).toBe('finish')
    expect(nextAfter('starter', {})).toBe('finish')
  })

  it('skips You to Training, Training and Plan to the end, and nothing else', () => {
    for (const s of ['sex', 'born', 'height', 'weight']) expect(skipTarget(s)).toBe('training')
    expect(skipTarget('training')).toBe('finish')
    expect(skipTarget('plan')).toBe('finish')
    expect(skipTarget('goal')).toBeNull()
    expect(skipTarget('starter')).toBeNull()
  })

  it('skips what the person\'s data answers: a whole step, or a body field it holds', () => {
    const server = { answered: ['goal', 'training', 'plan'], body: ['heightCm'], next: null, remaining: null }
    expect(answeredByData('goal', server)).toBe(true)
    expect(answeredByData('height', server)).toBe(true)
    expect(answeredByData('weight', server)).toBe(false)
    expect(answeredByData('goal', null)).toBe(false)
    expect(nextAfter('passkey', { server })).toBe('sex')
    expect(nextAfter('born', { server })).toBe('weight')
    // Training and Plan are both answered: on to the end.
    expect(nextAfter('weight', { answers: { trainingDays: 3 }, server })).toBe('finish')
    expect(skipTarget('sex', { answers: { trainingDays: 3 }, server })).toBe('finish')
    expect(nextAfter('training', { answers: { trainingDays: 3 }, server: { ...server, answered: ['plan'] } })).toBe('finish')
  })

  it('shows Skip only on You, Training and Plan, and no Back once the passkey exists', () => {
    expect(navOf('goal')).toEqual({ show: true, back: false })
    expect(navOf('sex').skip).toBe(true)
    expect(navOf('plan').skip).toBe(true)
    expect(navOf('starter').skip).toBeUndefined()
    expect(navOf('invite').show).toBe(false)
    expect(navOf('passkey').show).toBe(false)
  })
})

describe('the detour from the end', () => {
  it('visits only the missing body steps, then returns to the end', () => {
    const answers = { body: body({ sex: 'male', heightCm: 180 }) }
    const detour = detourOf(answers)
    expect(detour).toEqual(['born', 'weight'])
    expect(nextAfter('born', { answers, detour })).toBe('weight')
    expect(nextAfter('weight', { answers, detour })).toBe('finish')
    expect(nextIsDone('weight', detour)).toBe(true)
    expect(nextIsDone('born', detour)).toBe(false)
    // Skip on a detour goes back to the end, not on to Training.
    expect(skipTarget('born', { detour })).toBe('finish')
  })

  it('has nothing to visit with all four answers in', () => {
    expect(detourOf({ body: full })).toEqual([])
    expect(missingYou({ body: full })).toEqual([])
  })
})

describe('progress', () => {
  it('fills You in quarters and never shrinks going back', () => {
    let max = [0, 0, 0]
    for (const s of ['goal', 'sex', 'born']) max = progressMax(max, s)
    expect(max).toEqual([1, 0.5, 0])
    expect(progressMax(max, 'sex')).toEqual([1, 0.5, 0])
    expect(progressMax(max, 'training')).toEqual([1, 1, 1])
    expect(progressMax(max, 'finish')).toBe(max)
    expect([stepOf('goal'), stepOf('weight'), stepOf('plan'), stepOf('name')]).toEqual([1, 2, 3, null])
  })
})

describe('resuming', () => {
  it('starts at the first unanswered step', () => {
    expect(resumeScreen({ goal: null, body: body() })).toBe('goal')
    expect(resumeScreen({ goal: 'lose', body: body({ sex: 'female' }) })).toBe('born')
    expect(resumeScreen({ goal: 'lose', body: full })).toBe('training')
    expect(resumeScreen({ goal: 'lose', body: full, trainingDays: 3 })).toBe('plan')
    expect(resumeScreen({ goal: 'lose', body: full, trainingDays: 0 })).toBe('finish')
    expect(resumeScreen({ goal: 'lose', body: full, trainingDays: 3, plan: { kind: 'none' } })).toBe('finish')
  })

  it('does not ask a skipped step again', () => {
    expect(resumeScreen({ goal: 'keep', body: body() }, { skippedYou: true })).toBe('training')
    expect(resumeScreen({ goal: 'keep', body: full, trainingDays: null })).toBe('finish')
  })

  it('goes where the hub says, past what the person\'s data answers', () => {
    const server = (next, answered = [], fields = []) => ({ next, answered, body: fields, remaining: [] })
    expect(resumeScreen({ goal: null, body: body() }, { server: server('summary', ['goal', 'body', 'training', 'plan']) })).toBe('finish')
    expect(resumeScreen({ goal: 'keep', body: body() }, { server: server('body', [], ['sex', 'birthYear']) })).toBe('height')
    expect(resumeScreen({ goal: 'keep', body: full, trainingDays: 3 }, { server: server('plan') })).toBe('plan')
    // A profile with routines: the Plan step is not asked, whatever the days.
    expect(resumeScreen({ goal: 'keep', body: full, trainingDays: 3 }, { server: { ...server(null, ['plan']), next: null } })).toBe('finish')
    // All four answered here, not yet taken by the hub: on as this tab knows.
    expect(resumeScreen({ goal: 'keep', body: full }, { server: server('body') })).toBe('training')
  })

  it('owes the Plan step to training days with no plan chosen, unless the data makes the step moot', () => {
    expect(planOwed({ goal: 'keep', body: full, trainingDays: 3, plan: null })).toBe(true)
    expect(planOwed({ trainingDays: 3, plan: { kind: 'coach' } })).toBe(false)
    expect(planOwed({ trainingDays: 3, plan: { kind: 'none' } })).toBe(false)
    // No days (0 or skipped, or not asked): nothing to plan.
    expect([0, null, undefined].map(trainingDays => planOwed({ trainingDays, plan: null }))).toEqual([false, false, false])
    // The profile already has routines.
    expect(planOwed({ trainingDays: 3, plan: null }, { answered: ['plan'], body: [], next: null, remaining: null })).toBe(false)
    expect(planOwed({ trainingDays: 3, plan: null }, { answered: ['goal'], body: [], next: null, remaining: null })).toBe(true)
  })

  it('walks a cold Back to the step before', () => {
    expect(previousOf('born')).toBe('sex')
    expect(previousOf('finish', { answers: { trainingDays: 2 } })).toBe('plan')
    expect(previousOf('finish', { answers: { trainingDays: 0 } })).toBe('training')
    expect(previousOf('goal')).toBeNull()
  })
})
