// @vitest-environment happy-dom
// The best match names what kind of thing it is. 'Food' is Home's header for the diary (Питание,
// 饮食, 飲食 where a language keeps a word for the section), so a single food item has its own key.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import BestMatch from './BestMatch.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const packs = import.meta.glob('../../locales/*.js', { eager: true })
const locale = code => packs[`../../locales/${code}.js`].default

let host, root
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

describe('the best match of a food', () => {
  it('says "Food item", not the diary section\'s "Food"', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const r = { type: 'food', id: 4, key: 'food:4', title: 'Rolled oats', ranges: [], subtitle: '', media: { kind: 'glyph', glyph: 'apple' }, value: 370, unit: 'kcal' }
    await act(async () => root.render(<BestMatch r={r} onOpen={() => {}} />))
    expect(host.querySelector('.sr-eyebrow').textContent).toBe('Food item')
  })
})

describe('the locales', () => {
  const codes = Object.keys(packs).map(p => p.match(/([^/]+)\.js$/)[1])

  it('translate the food item in all 18, as a word of its own', () => {
    expect(codes).toHaveLength(18)
    for (const code of codes) {
      const pack = locale(code)
      expect(pack['Food item'], code).toBeTruthy()
      expect(pack['Food item'], code).not.toBe(pack['Food'])
    }
  })

  it('keep Home\'s header wording where the search had changed it', () => {
    expect(locale('ru')['Food']).toBe('Питание')
    expect(locale('zh')['Food']).toBe('饮食')
    expect(locale('zh-TW')['Food']).toBe('飲食')
  })
})
