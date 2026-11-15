import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { RTL_LANGS } from './i18n-core.js'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]

function firstPaint(state, language) {
  const documentElement = { lang: 'en', dir: 'ltr' }
  runInNewContext(script, {
    localStorage: { getItem: () => JSON.stringify(state) },
    navigator: { language },
    document: { documentElement },
    window: { addEventListener() {} },
    setTimeout() {},
  })
  return documentElement
}

describe('direction before the app loads', () => {
  it.each([...RTL_LANGS])('%s is RTL for a saved profile and for a new browser', lang => {
    expect(firstPaint({ lang }, 'en-US')).toEqual({ lang, dir: 'rtl' })
    expect(firstPaint({}, `${lang}-IR`)).toEqual({ lang, dir: 'rtl' })
  })

  it('keeps an explicit English choice on a Persian browser', () => {
    expect(firstPaint({ lang: 'en' }, 'fa-IR')).toEqual({ lang: 'en', dir: 'ltr' })
  })

  it('uses LTR for other browsers', () => {
    expect(firstPaint({}, 'de-DE')).toEqual({ lang: 'en', dir: 'ltr' })
  })
})
