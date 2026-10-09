import { describe, expect, it } from 'vitest'

const programmeKeys = [
  'Programme mode', 'Create and run multi-week programmes. Saved Programme data remains when this is off.',
  'Programmes', 'Active programmes', 'Ready programmes', 'No ready programmes', 'New programme',
  'Programme name', 'Number of weeks', 'Save programme', '{0} weeks', 'Progression: {0}',
  'Week {0} of {1}', 'Current week', 'Today', 'Session', 'Edit programme',
  'Complete programme early?', 'Complete early',
  'Build a reusable training cycle', 'Programme colour', 'No colour', 'Start with',
  'Lime', 'Sky', 'Orange', 'Gold', 'Violet', 'Pink', 'Teal',
  'My current week', 'Blank programme', 'Clone',
  'Copies this week’s routines into each programme week. You can edit the templates later.',
  'Creates empty weeks. Add sessions when you are ready.',
  'Clones the selected programme with fresh session identities.',
  'Week templates', 'sessions', 'Week {0} mode', 'Normal', 'Deload',
  'Rest weeks keep their sessions but do not schedule workouts.',
  'Deload weeks keep configured loads and pause automatic progression.',
  'Copy week', 'Copy', 'Copy this week to any selected destination weeks.',
  'Day sessions', '{0} sessions', 'Rest day', 'Select routine', 'Edit routine',
  'Remove session', 'Add session', 'New routine', 'Set rest day', 'Rest week',
  'Back to programme',
]
const packs = import.meta.glob('./locales/*.js', { eager: true, import: 'default' })
const placeholders = value => {
  if (value && typeof value === 'object') return [...new Set(Object.values(value).flatMap(placeholders))].sort()
  return [...String(value).matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
}

describe('Programme locale parity', () => {
  it('covers every current non-English pack', () => { expect(Object.keys(packs)).toHaveLength(17) })
  it.each(Object.entries(packs))('%s contains every Programme key with matching placeholders', (_path, dictionary) => {
    expect(programmeKeys.filter(key => !dictionary[key])).toEqual([])
    for (const key of programmeKeys) {
      expect(placeholders(dictionary[key]), key).toEqual(placeholders(key))
      // Shared words such as "Normal" or "Session" can be valid translations;
      // English Programme sentences were placeholders, not finished locale copy.
      if (key.split(/\s+/).length >= 4) expect(dictionary[key], key).not.toBe(key)
    }
  })
})
