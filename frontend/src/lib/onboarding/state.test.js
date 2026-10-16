// The onboarding's answers and what each action does to them.
import { describe, expect, it } from 'vitest'
import { initialState, loadSaved, planFits, reduce, save } from './state.js'

const units = { weight: 'kg', height: 'cm', source: 'locale' }
const memory = () => {
  const m = new Map()
  return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: k => m.delete(k) }
}

describe('onboarding state', () => {
  it('starts with no answers, a seated day by default and the locale units', () => {
    const s = initialState(units)
    expect(s.answers.goal).toBeNull()
    expect(s.answers.activity).toEqual({ value: 'sitting', source: 'default' })
    expect(s.answers.units).toBe(units)
    expect(s.answers.trainingDays).toBeUndefined()
  })

  it('marks a unit picked by hand as the person\'s', () => {
    const s = reduce(initialState(units), { type: 'unit', kind: 'weight', unit: 'lb' })
    expect(s.answers.units).toEqual({ weight: 'lb', height: 'cm', source: 'user' })
  })

  it('drops a starter plan, and its card, when the number of training days changes, and keeps it when it does not', () => {
    let s = reduce(initialState(units), { type: 'training', days: 3 })
    s = reduce(s, { type: 'plan', plan: { kind: 'starter', templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'gym', experience: 'new' } })
    expect(reduce(s, { type: 'training', days: 3 }).answers.plan).toMatchObject({ kind: 'starter' })
    const changed = reduce(s, { type: 'training', days: 4 })
    expect(changed.answers.plan).toBeNull()
    expect(changed.pick).toBeNull()
  })

  it('fits a plan to the days by one rule, the hub\'s', () => {
    expect([0, 1, 6].map(d => planFits({ kind: 'none' }, d))).toEqual([true, true, true])
    expect([0, null, 1, 6].map(d => planFits({ kind: 'coach' }, d))).toEqual([false, false, true, true])
    expect([2, 3, 4].map(d => planFits({ kind: 'starter', weekdays: [1, 3, 5] }, d))).toEqual([false, true, false])
  })

  it('takes what the person\'s data answers from the hub, under what this tab and the hub hold, and never keeps it across a reload', () => {
    const store = memory()
    let s = reduce(reduce(initialState(units), { type: 'user', uid: 'u1' }), { type: 'body', field: 'sex', value: 'male' })
    s = reduce(s, {
      type: 'hub', answers: {}, next: 'body', remaining: ['body', 'plan'], starterAvailable: false,
      prefill: { answered: ['goal', 'training'], goal: { goal: 'build' }, training: { trainingDays: 3 }, body: { sex: 'female', heightCm: 181 }, sources: {} },
    })
    expect(s.answers).toMatchObject({ goal: 'build', trainingDays: 3, body: { sex: 'male', heightCm: 181 } })
    expect(s.server).toEqual({ answered: ['goal', 'training'], body: ['sex', 'heightCm'], next: 'body', remaining: ['body', 'plan'] })
    expect(s.starterAvailable).toBe(false)
    save(s, store)
    expect(loadSaved('u1', store).server).toBeNull()
  })

  it('clears only a starter that no longer fits the days: an AI coach or no-plan choice stays, as on the hub', () => {
    const coach = { kind: 'coach', experience: null, equipment: 'gym', consentVersion: 'ai-coach-build-v1', consentAt: '2026-10-14T08:00:00.000Z' }
    const starter = { kind: 'starter', templateId: 'full-body', weekdays: [1, 3, 5], equipment: 'gym', experience: 'new' }
    const at3 = plan => reduce(reduce(initialState(units), { type: 'training', days: 3 }), { type: 'plan', plan })
    expect(reduce(at3(coach), { type: 'training', days: 4 }).answers.plan).toEqual(coach)
    expect(reduce(at3(coach), { type: 'training', days: 4 }).pick).toBe('coach')
    expect(reduce(at3({ kind: 'none' }), { type: 'training', days: 5 }).answers.plan).toEqual({ kind: 'none' })
    expect(reduce(at3(starter), { type: 'training', days: 4 }).answers.plan).toBeNull()
    expect(reduce(at3(starter), { type: 'training', days: 3 }).answers.plan).toEqual(starter)
    // No days: nothing to plan around, but "no plan" still stands.
    expect(reduce(at3(coach), { type: 'training', days: 0 }).answers.plan).toBeNull()
    expect(reduce(at3(coach), { type: 'skipTraining' }).answers.plan).toBeNull()
    expect(reduce(at3({ kind: 'none' }), { type: 'skipTraining' }).answers.plan).toEqual({ kind: 'none' })
  })

  it('skips Training as null, with no plan', () => {
    const s = reduce(reduce(initialState(units), { type: 'training', days: 2 }), { type: 'skipTraining' })
    expect(s.answers.trainingDays).toBeNull()
    expect(s.answers.plan).toBeNull()
  })

  it('keeps the steps whose save failed until one succeeds', () => {
    let s = reduce(initialState(units), { type: 'saved', step: 'body', ok: false })
    s = reduce(s, { type: 'saved', step: 'body', ok: false })
    expect(s.unsaved).toEqual(['body'])
    expect(reduce(s, { type: 'saved', step: 'body', ok: true }).unsaved).toEqual([])
  })

  it('fills in from the hub only what this tab does not know', () => {
    let s = reduce(initialState(units), { type: 'body', field: 'sex', value: 'male' })
    s = reduce(s, { type: 'hub', answers: { goal: 'build', body: { sex: 'female', weightKg: 80 }, trainingDays: 3 }, coachAvailable: true })
    expect(s.answers.goal).toBe('build')
    expect(s.answers.body.sex).toBe('male')
    expect(s.answers.body.weightKg).toBe(80)
    expect(s.answers.trainingDays).toBe(3)
    expect(s.coachAvailable).toBe(true)
  })

  it('survives a reload of the tab, an unasked training step included', () => {
    const store = memory()
    const s = reduce(reduce(initialState(units), { type: 'user', uid: 'u1' }), { type: 'goal', goal: 'lose' })
    save(s, store)
    const back = loadSaved('u1', store)
    expect(back.answers.goal).toBe('lose')
    expect(back.answers.trainingDays).toBeUndefined()
    expect(loadSaved('u1', memory())).toBeNull()
  })

  describe('whose it is', () => {
    const coach = { kind: 'coach', experience: null, equipment: 'gym', consentVersion: 'ai-coach-build-v1' }
    const marias = () => {
      let s = reduce(initialState(units), { type: 'invite', code: 'AB12', invite: { status: 'valid', inviterName: 'Andrei', suggestedName: null } })
      s = reduce(s, { type: 'name', name: 'Maria' })
      s = reduce(s, { type: 'user', uid: 'u1' })
      s = reduce(s, { type: 'goal', goal: 'lose' })
      s = reduce(s, { type: 'body', field: 'sex', value: 'female' })
      s = reduce(s, { type: 'body', field: 'birthYear', value: 1990 })
      s = reduce(s, { type: 'training', days: 3 })
      return reduce(s, { type: 'plan', plan: coach })
    }

    it('keeps only the invite and the typed name until there is a person to own the rest', () => {
      const store = memory()
      let s = reduce(initialState(units), { type: 'invite', code: 'AB12', invite: { status: 'valid', inviterName: 'Andrei', suggestedName: 'Maria' } })
      s = reduce(reduce(s, { type: 'name', name: 'Maria' }), { type: 'goal', goal: 'lose' })
      s = reduce(s, { type: 'body', field: 'weightKg', value: 64 })
      save(s, store)
      expect(Object.keys(JSON.parse(store.getItem('gains_onboarding'))).sort()).toEqual(['code', 'invite', 'name', 'uid'])
      const back = loadSaved(null, store)
      expect(back).toMatchObject({ code: 'AB12', name: 'Maria', invite: { status: 'valid' } })
      expect(back.answers.goal).toBeNull()
      expect(back.answers.body.weightKg).toBeNull()
    })

    it('starts over when the invite code changes: nothing kept for the earlier invite is the new one\'s', () => {
      const valid = { status: 'valid', inviterName: 'Andrei', suggestedName: null }
      let s = reduce(initialState(units), { type: 'invite', code: 'OLD1', invite: valid })
      s = reduce(reduce(s, { type: 'name', name: 'Bob' }), { type: 'body', field: 'weightKg', value: 90 })
      const other = reduce(s, { type: 'invite', code: 'NEW2', invite: { ...valid, inviterName: 'Ana' } })
      expect(other.code).toBe('NEW2')
      expect(other.invite.inviterName).toBe('Ana')
      expect(other.name).toBeNull()
      expect(other.answers.body.weightKg).toBeNull()
      expect(other.unsaved).toEqual([])
      // And a landing with no code lets the earlier invite go altogether.
      const none = reduce(s, { type: 'invite', code: null, invite: null })
      expect(none).toMatchObject({ code: null, invite: null, name: null })
    })

    it('keeps the typed name when the same invite is checked again', () => {
      const valid = { status: 'valid', inviterName: 'Andrei', suggestedName: null }
      let s = reduce(reduce(initialState(units), { type: 'invite', code: 'AB12', invite: valid }), { type: 'name', name: 'Maria' })
      s = reduce(s, { type: 'invite', code: 'AB12', invite: { ...valid, inviterName: 'Andrei A.' } })
      expect(s).toMatchObject({ code: 'AB12', name: 'Maria', invite: { inviterName: 'Andrei A.' } })
      // A check that answered nothing new leaves the state as it was.
      expect(reduce(s, { type: 'invite', code: 'AB12', invite: null })).toBe(s)
    })

    it('never reads a copy kept for someone else, or one from before copies named their owner', () => {
      const store = memory()
      save(marias(), store)
      expect(loadSaved('u1', store).answers.goal).toBe('lose')
      expect(loadSaved('u2', store)).toBeNull()
      expect(loadSaved(null, store)).toBeNull()
      store.setItem('gains_onboarding', JSON.stringify({ code: 'AB12', answers: { goal: 'lose', body: { sex: 'female' } } }))
      expect(loadSaved('u1', store)).toBeNull()
      expect(loadSaved(null, store)).toBeNull()
    })

    it('starts over when another person, or no one, is signed in, and keeps what was typed when someone becomes signed in', () => {
      const s = marias()
      for (const uid of ['u2', null]) {
        const other = reduce(s, { type: 'user', uid })
        expect(other.uid).toBe(uid)
        expect(other).toMatchObject({ code: null, invite: null, name: null, unsaved: [] })
        expect(other.answers).toMatchObject({ goal: null, plan: null, body: { sex: null, birthYear: null } })
      }
      expect(reduce(s, { type: 'user', uid: 'u1' })).toBe(s)
      const typed = reduce(reduce(initialState(units), { type: 'name', name: 'Maria' }), { type: 'user', uid: 'u1' })
      expect(typed).toMatchObject({ uid: 'u1', name: 'Maria' })
    })

    it('writes no AI coach plan down, nor the save still owed for it: its consent is this session\'s tap', () => {
      const store = memory()
      const s = reduce(marias(), { type: 'saved', step: 'plan', ok: false })
      expect(s.answers.plan).toEqual(coach)
      expect(s.unsaved).toEqual(['plan'])
      save(s, store)
      expect(store.getItem('gains_onboarding')).not.toMatch(/"kind":"coach"|consentVersion|consent"/)
      const back = loadSaved('u1', store)
      expect(back.answers.plan).toBeNull()
      expect(back.unsaved).toEqual([])
      expect(back.pick).toBeNull()
      // Whatever else is in a copy, a coach plan in it is not read back.
      store.setItem('gains_onboarding', JSON.stringify({ ...JSON.parse(store.getItem('gains_onboarding')), answers: { ...s.answers }, unsaved: ['plan', 'body'], pick: 'coach' }))
      const forged = loadSaved('u1', store)
      expect(forged.answers.plan).toBeNull()
      expect(forged.unsaved).toEqual(['body'])
    })

    it('keeps no copy of a state with nothing in it, and a reset keeps whose it is', () => {
      const store = memory()
      save(marias(), store)
      expect(store.getItem('gains_onboarding')).not.toBeNull()
      const over = reduce(marias(), { type: 'reset' })
      expect(over.uid).toBe('u1')
      save(over, store)
      expect(store.getItem('gains_onboarding')).toBeNull()
    })
  })
})
