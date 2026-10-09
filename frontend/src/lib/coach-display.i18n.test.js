import { afterEach, describe, expect, it } from 'vitest'
import zhNames from '../exercise-names/zh.js'
import deNames from '../exercise-names/de.js'
import { EXIDX } from './exercises.js'
import { _setLangState } from './i18n-core.js'
import { capWords } from './format.js'
import { exName, exTitle, changeValues } from './coach.js'

afterEach(() => _setLangState('en', {}, null, null))

describe('localized Coach exercise display', () => {
  it('uses the Chinese catalogue name for cards and titles', () => {
    _setLangState('zh', {}, null, zhNames, false)
    expect(exName('3214')).toBe(zhNames['3214'])
    expect(exTitle('3214')).toBe(zhNames['3214'])
  })

  it('respects the English-only exercise-name setting', () => {
    _setLangState('zh', {}, null, zhNames, false, true)
    expect(exName('3214')).toBe(EXIDX['3214'].n)
    expect(exTitle('3214')).toBe(capWords(EXIDX['3214'].n))
  })

  it('keeps the casing carried by a German name pack', () => {
    _setLangState('de', {}, null, deNames, false)
    expect(exTitle('1003')).toBe(deNames['1003'])
  })

  it('translates both sides of a swap without changing its canonical payload', () => {
    _setLangState('zh', {}, null, zhNames, false)
    const change = {
      type: 'swap-exercise', target: { exId: '3214' },
      before: EXIDX['3214'].n, after: { id: '0025', name: EXIDX['0025'].n },
    }
    const original = JSON.stringify(change)
    expect(changeValues(change, {})).toEqual({ before: zhNames['3214'], after: zhNames['0025'] })
    expect(JSON.stringify(change)).toBe(original)
  })

  it('preserves a swap name that cannot be resolved to its target catalogue entry', () => {
    _setLangState('zh', {}, null, zhNames, false)
    const change = {
      type: 'swap-exercise', target: { exId: 'unknown' },
      before: 'My original exercise', after: { id: '0025' },
    }
    expect(changeValues(change, {}).before).toBe('My original exercise')
    expect(changeValues({ ...change, target: { exId: '3214' } }, {}).before).toBe('My original exercise')
  })
})
