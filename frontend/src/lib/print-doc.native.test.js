// #991: on a ROM without a print service, Create PDF killed the whole Android app. The plugin now
// fails the printout instead, and the page says what is missing.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const h = vi.hoisted(() => ({ fail: null, toasts: [] }))
vi.mock('./mobile.js', () => ({
  MOBILE: true,
  printHtml: async () => { if (h.fail) throw Object.assign(new Error('nope'), { code: h.fail }) },
}))
vi.mock('../store/useUI.js', () => ({ useUI: { getState: () => ({ toast: msg => h.toasts.push(msg) }) } }))

const { printDocument } = await import('./print-doc.js')
const settle = () => new Promise(r => setTimeout(r, 20))

describe('printing on the phone (#991)', () => {
  it('says so when the phone has no print service', async () => {
    h.fail = 'no-service'; h.toasts = []
    await printDocument('<p>x</p>', 'Report')
    await settle()
    expect(h.toasts).toEqual(['This phone has no print service. Turn one on in its settings and try again.'])
  })
  it('stays quiet when the sheet was only dismissed or failed otherwise', async () => {
    h.fail = 'failed'; h.toasts = []
    await printDocument('<p>x</p>', 'Report')
    await settle()
    expect(h.toasts).toEqual([])
  })
  it('the plugin catches what used to crash the app', () => {
    const java = readFileSync(new URL('../../android/app/src/main/java/ch/duartesantos/opengym/PrintPlugin.java', import.meta.url), 'utf8')
    expect(java).toMatch(/catch \(ActivityNotFoundException e\)[\s\S]*?"no-service"/)
    expect(java).toMatch(/runOnUiThread\(\(\) -> \{[\s\S]*?try \{[\s\S]*?new WebView\(ctx\)[\s\S]*?catch \(Throwable e\)/)
  })
})
