// The AI coach consent text is the hub's (fitness-hub src/onboarding/consent.ts): the app shows
// what it is sent. A translation is keyed by the English text an id names, so it can only ever
// stand for that text: a new text under a new id shows in English until it is translated.
import { afterEach, describe, expect, it } from 'vitest'
import { _setLangState } from '../i18n-core.js'
import { coachConsentCopy } from './consent.js'

const V1 = {
  version: 'ai-coach-build-v1',
  reads: {
    one: 'An AI model reads your goal, your body details and your {0} training day, then drafts a plan. You review it before anything goes on your week.',
    other: 'An AI model reads your goal, your body details and your {0} training days, then drafts a plan. You review it before anything goes on your week.',
  },
  where: 'These answers go to the AI service this Gains server uses. Your food log and your friends are not sent. Tapping Build my plan sends them once.',
}
// The same id's meaning, reworded: what the hub would send under a new id.
const V2 = {
  version: 'ai-coach-build-v2',
  reads: { one: 'An AI model reads your {0} training day.', other: 'An AI model reads your {0} training days.' },
  where: 'These answers go to the AI service, once.',
}
// A pack holding a translation of V1's text, keyed by that English text, as src/locales do.
const PACK = {
  [V1.reads.one]: 'Ein KI-Modell liest deinen {0} Trainingstag.',
  [V1.reads.other]: 'Ein KI-Modell liest deine {0} Trainingstage.',
  [V1.where]: 'Diese Antworten gehen einmal an den KI-Dienst.',
}

afterEach(() => _setLangState('en', {}, null, null))

describe('the AI coach consent', () => {
  it('says the hub’s text, with the form for one training day or more', () => {
    expect(coachConsentCopy(V1, 1).reads).toBe(V1.reads.one.replace('{0}', '1'))
    expect(coachConsentCopy(V1, 3)).toEqual({ reads: V1.reads.other.replace('{0}', '3'), where: V1.where })
    expect(coachConsentCopy(V2, 2)).toEqual({ reads: 'An AI model reads your 2 training days.', where: V2.where })
  })

  it('translates a text only by a translation of that very text, never one under another id', () => {
    _setLangState('de', PACK, null, null, false)
    expect(coachConsentCopy(V1, 1).reads).toBe('Ein KI-Modell liest deinen 1 Trainingstag.')
    expect(coachConsentCopy(V1, 4)).toEqual({ reads: 'Ein KI-Modell liest deine 4 Trainingstage.', where: 'Diese Antworten gehen einmal an den KI-Dienst.' })
    // A new text has no translation yet: the hub's English, not the old text's German.
    expect(coachConsentCopy(V2, 4)).toEqual({ reads: 'An AI model reads your 4 training days.', where: V2.where })
  })
})
