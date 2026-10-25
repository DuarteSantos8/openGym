import { afterEach, describe, expect, it } from 'vitest'
import { _setLangState, derivePack, t } from './i18n-core.js'

const keys = [
  'preset.manual.desc',
  'preset.linear.desc',
  'preset.greyskull.desc',
  'preset.double.desc',
  'preset.double_controlled.name',
  'preset.double_controlled.desc',
  'preset.triple.desc',
  'preset.hold_seconds.desc',
  'preset.bodyweight_ladder.desc',
  'preset.pyramid_reps.name',
  'preset.pyramid_reps.desc',
  'preset.pyramid.desc',
  'preset.five_three_one.desc',
  'preset.top_set_backoff.desc',
  'preset.accumulation_intensification.desc',
  'preset.density.desc',
  'preset.undulating.name',
  'preset.undulating.desc',
  'progression.completion.help',
  'progression.rir.floorHelp',
  'progression.rir.ignoredHelp',
  'progression.rir.scheduleHelp',
  'progression.cycle.repeat',
  'progression.cycle.help',
  'progression.successes.label',
  'progression.reviewAfter.label',
  'progression.reviewAfter.help',
  'progression.reviewTrainingMax',
  'Phase {0} of {1}',
  'Variation: {0}',
  'progression.wave.volume',
  'progression.wave.intermediate',
  'progression.wave.strength',
  'progression.wave.percent',
  'progression.rir.doubleHelp',
  'progression.rir.manualHelp',
]
const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
const marks = value => [...value.matchAll(/\{\d+\}/g)].map(match => match[0]).sort()
const english = Object.fromEntries(keys.map(key => [key, t(key)]))

afterEach(() => _setLangState('en', {}, null, null))

describe('progression explanations', () => {
  it('resolves every stable key to readable English and interpolates the phase', () => {
    _setLangState('en', {}, null, null)
    for (const key of keys.filter(key => key.includes('.'))) expect(t(key), key).not.toBe(key)
    expect(t('Phase {0} of {1}', 2, 4)).toBe('Phase 2 of 4')
    expect(t('Variation: {0}', 'Push-up')).toBe('Variation: Push-up')
  })

  for (const [file, pack] of Object.entries(packs)) {
    it(`translates all explanations and preserves placeholders in ${file}`, () => {
      for (const key of keys) {
        expect(typeof pack[key], key).toBe('string')
        expect(pack[key].trim(), key).not.toBe('')
        expect(pack[key], key).not.toBe(english[key])
        expect(marks(pack[key]), key).toEqual(marks(english[key]))
      }
    })
  }

  it('derives all progression explanations in Swiss German', () => {
    const swiss = derivePack('de-CH', packs['../locales/de.js'])
    for (const key of keys) {
      expect(swiss[key], key).not.toMatch(/ß/)
      expect(marks(swiss[key]), key).toEqual(marks(english[key]))
    }
  })
})
