import { describe, expect, it } from 'vitest'
import { changeTitle } from './coach.js'

// "Drop {0}" labels a drop set's sub-row ("Drop 1", lighter weight right after the set), sitting
// next to the ✕ that removes it. It once also titled the Coach's "remove this exercise" change,
// and most packs had translated it as that ("1 streichen"), which read as a second delete button.
const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
// The verbs the remove-meaning translations used, per pack. None may come back in the drop label.
const removeWords = {
  de: /streich|entfern/i, es: /quitar/i, fr: /retirer/i, it: /togli/i, pt: /retirar|tirar|remover/i,
  pl: /usuń/i, tr: /çıkar/i, ru: /убрать/i, uk: /прибрати/i, hi: /हटा/, ko: /제외|제거|빼기/, zh: /移除/, 'zh-TW': /移除/,
}

describe('the drop-set sub-row label', () => {
  it('is a drop set in every pack, never a word for remove', () => {
    for (const [path, pack] of Object.entries(packs)) {
      const lang = path.match(/([\w-]+)\.js$/)[1]
      const v = pack['Drop {0}']
      if (v == null) continue   // pt-BR inherits pt
      expect(v, lang).not.toBe(pack['Remove {0}'])
      if (removeWords[lang]) expect(v, lang).not.toMatch(removeWords[lang])
    }
  })

  it('is not what the Coach titles an exercise it takes out', () => {
    expect(changeTitle({ type: 'remove-exercise', target: { exId: 'bench' } }, {})).toMatch(/^Remove /)
  })
})
