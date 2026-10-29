import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { WEB_VIEWPORT, MOBILE_VIEWPORT, mobileViewport, isIosSafari, guardFocusZoom } from './viewport-zoom.js'

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const docWith = content => {
  const attrs = { content }
  const meta = { getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v } }
  return { doc: { querySelector: () => meta }, attrs }
}

// P8 (redesign 1.4.5): pinch zoom in the browser and the installed web app, not in the phone apps
describe('viewport zoom', () => {
  it('lets the web build zoom', () => {
    expect(html).toContain(`<meta name="viewport" content="${WEB_VIEWPORT}">`)
    expect(html).not.toMatch(/user-scalable=no|maximum-scale/)
  })
  it('keeps the Capacitor shells as they were', () => {
    expect(mobileViewport(html)).toContain(`content="${MOBILE_VIEWPORT}"`)
    expect(MOBILE_VIEWPORT).toMatch(/user-scalable=no$/)
  })
  it('stops the focus zoom on iOS only, and never twice', () => {
    const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 }
    const ipad = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }
    const android = { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)', maxTouchPoints: 5 }
    expect(isIosSafari(iphone) && isIosSafari(ipad)).toBe(true)
    expect(isIosSafari(android) || isIosSafari({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 })).toBe(false)
    const a = docWith(WEB_VIEWPORT)
    expect(guardFocusZoom(a.doc, iphone)).toBe(true)
    expect(a.attrs.content).toBe(WEB_VIEWPORT + ',maximum-scale=1')
    expect(guardFocusZoom(a.doc, iphone)).toBe(false)
    const b = docWith(WEB_VIEWPORT)
    expect(guardFocusZoom(b.doc, android)).toBe(false)
    expect(b.attrs.content).toBe(WEB_VIEWPORT)
  })
})
