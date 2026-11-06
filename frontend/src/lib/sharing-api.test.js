import { describe, it, expect } from 'vitest'
import { levelsFor, summarize, logLine, sharingError, consentWords, TRAINER_CONSENT, sharingOn } from './sharing-api.js'
import { CONSENT_TEXTS } from '../../../api/consent.js'

describe('sharing helpers', () => {
  it('offers only the levels a category can reach, and the lead row only See', () => {
    expect(levelsFor('workouts')).toEqual(['off', 'view', 'suggest', 'apply'])
    expect(levelsFor('photos')).toEqual(['off', 'view'])
    expect(levelsFor('plans', 'view')).toEqual(['off', 'view'])
  })
  it('summarizes what one side sees and may do', () => {
    const s = { metrics: 'view', workouts: 'view', plans: 'suggest', bodyweight: 'apply' }
    expect(summarize(s, 'view', true)).toBe('Key numbers, Workouts, Plans & routines, Body weight')
    expect(summarize(s, 'suggest')).toBe('Plans & routines')
    expect(summarize(s, 'apply')).toBe('Body weight')
  })
  it('reads every log event as a sentence, a deleted trainer as a former one', () => {
    expect(logLine({ ev: 'grant.create', peer: { kind: 'trainer', name: 'Marco' } })).toBe('You connected Marco')
    expect(logLine({ ev: 'grant.accept', actor: { kind: 'trainer', name: '' } })).toBe('A former trainer said yes')
    expect(logLine({ ev: 'token.create', peer: { kind: 'token', name: 'Claude' } })).toBe('You made the token Claude')
    expect(logLine({ ev: 'token.write', actor: { kind: 'token', name: 'Claude' }, cat: 'plans' })).toBe('The token Claude changed Plans & routines')
    expect(logLine({ ev: 'token.end', peer: { kind: 'token', name: 'Claude' } })).toBe('The token Claude was revoked')
    expect(logLine({ ev: 'grant.end', actor: { kind: 'self', name: 'Lea' }, peer: { kind: 'gym', name: 'FitBox' } })).toBe('You ended the connection with FitBox')
    expect(logLine({ ev: 'grant.end', actor: { kind: 'trainer', name: 'Marco' } })).toBe('Marco ended the connection')
    expect(logLine({ ev: 'access', actor: { kind: 'trainer', name: 'Marco' }, cat: 'workouts' })).toBe('Marco looked at Workouts')
    expect(logLine({ ev: 'data.admin-view' })).toBe('An admin opened your training data')
  })
  it('words the refusals', () => {
    expect(sharingError({ data: { code: 'code-invalid' } })).toMatch(/wrong, used up or expired/)
    expect(sharingError({ data: { code: 'code-paused' } })).toMatch(/few minutes/)
    expect(sharingError({ message: 'boom' })).toBe('boom')
  })
  it('the app’s copy of the consent text is the server’s, so it can be translated', () => {
    expect(TRAINER_CONSENT).toBe(CONSENT_TEXTS.trainer.text)
    expect(consentWords({ text: 'A newer text' })).toBe('A newer text')
    expect(sharingOn({ trainers: { on: true } })).toBe(true)
    expect(sharingOn({})).toBe(false)
  })
})
