import { afterEach, expect, it, vi } from 'vitest'

vi.mock('./mobile.js', () => ({ MOBILE: true, printHtml: vi.fn(() => Promise.resolve()) }))
import { printHtml } from './mobile.js'
import { printDocument, printShell } from './print-doc.js'
import { _setLangState } from './i18n-core.js'
import fa from '../locales/fa.js'

afterEach(() => { _setLangState('en', {}, null, null); vi.clearAllMocks() })

it('embeds the real Vazirmatn WOFF2 in Persian native print documents', async () => {
  _setLangState('fa', fa, null, null)
  const html = printShell({ title: 'برنامه تمرینی', body: '<p>62.5 kg</p>' })
  await printDocument(html, 'Persian plan')
  const [printed, name] = printHtml.mock.calls[0]
  expect(name).toBe('Persian plan')
  expect(printed).toContain('data:font/woff2;base64,d09GMg')
  expect(printed).toContain('font-family:Vazirmatn,sans-serif')
  expect(printed).toContain('62.5 kg')
  expect(printed).not.toMatch(/src:url\("(?:https?:|capacitor:|file:)/)
})

it.each(['en', 'ar'])('keeps the existing fonts in %s printouts', async lang => {
  _setLangState(lang, {}, null, null)
  const html = printShell({ title: 'Plan', body: '<p>62.5 kg</p>' })
  await printDocument(html, 'Plan')
  expect(printHtml.mock.calls[0][0]).toBe(html)
})
