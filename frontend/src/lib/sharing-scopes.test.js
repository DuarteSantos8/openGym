import { describe, it, expect } from 'vitest'
import * as web from './sharing-scopes.js'
import * as api from '../../../api/trainers/scopes.js'

// Code that exists twice on purpose (CLAUDE.md): the app's copy of the scope catalog must give
// the same answers as the server's, or the consent screen would offer levels the server refuses.
describe('sharing-scopes parity with api/trainers/scopes.js', () => {
  it('has the same constants', () => {
    for (const k of ['LEVELS', 'CATEGORIES', 'CATEGORY_IDS', 'TRAINER_DEFAULTS', 'LEAD_MODES']) expect(web[k], k).toEqual(api[k])
  })
  it('cleans and derives the same way', () => {
    const inputs = [{}, { workouts: 'apply', photos: 'apply', evil: 'x' }, web.TRAINER_DEFAULTS, { plans: 'suggest', notes: 'view' }, null]
    for (const a of inputs) {
      for (const cap of ['view', 'apply']) expect(web.cleanScopes(a, cap)).toEqual(api.cleanScopes(a, cap))
      for (const mode of web.LEAD_MODES) for (const b of inputs) expect(web.leadScopes(mode, a, b)).toEqual(api.leadScopes(mode, a, b))
      expect(web.sharesNothing(a)).toBe(api.sharesNothing(a))
    }
    expect(web.leadModeOf('x')).toBe(api.leadModeOf('x'))
  })
})
