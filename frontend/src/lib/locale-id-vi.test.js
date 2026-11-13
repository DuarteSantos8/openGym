// QA2 1.4.5: Indonesian and Vietnamese came in as community languages and left some everyday
// words in English (equipment, badges, "Per gym", the machines' family names). These are the
// ones that read as plain words and must be translated; brand names, units and gym jargon that
// people there say in English anyway (AMRAP, Superset, Leg press) may stay.
import { describe, it, expect } from 'vitest'
import id from '../locales/id.js'
import vi from '../locales/vi.js'

const ID = ['body weight', 'leverage machine', 'resistance band', 'stability ball', 'smith machine', 'pull-up bar', 'dumbbell',
  'Early bird', 'Night owl', 'Weekend warrior', 'Source code', 'Signing secret', 'Per gym', 'Trainer', 'Trainer & gym',
  'Streak', 'Default', 'Edit', 'API key', 'Bodyweight', 'Full Body', 'Upper / Lower', 'Spreadsheet', '+ Mini-set', 'Mini-set {0}']
const VI = ['Circuit', 'Pace', '+ Mini-set', 'Mini-set {0}', 'leverage machine', 'stability ball', 'Early bird', 'Night owl',
  'Weekend warrior', 'Source code', 'Signing secret', 'Per gym']

describe('id and vi say the everyday words in their own language', () => {
  it.each([['id', id, ID], ['vi', vi, VI]])('%s', (_, pack, keys) => {
    for (const k of keys) {
      expect(pack[k], k).toBeTruthy()
      expect(pack[k], k).not.toBe(k)
      expect(pack[k], k).not.toContain('—')
    }
  })
})
