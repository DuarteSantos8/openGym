// Pinch zoom (redesign 1.4.5, P8).
//
// The browser and the installed web app let people zoom: index.html no longer says
// user-scalable=no (WCAG 1.4.4, and a page you cannot zoom is a page some people cannot read).
// The Capacitor apps keep the old viewport, set at build time by the flavor plugin in
// vite.config.js (mobileViewport below), so nothing changes inside the phone apps: there a pinch
// on a set row is a mistake far more often than a wish. Double-tap zoom on the steppers stays
// off everywhere through `touch-action: manipulation` on the body.
//
// One iOS habit remains on the web: Safari zooms the whole page into any text field set under
// 16 px when it takes focus, and leaves it zoomed. maximum-scale=1 stops that focus zoom, and
// since iOS 10 Safari ignores it for a pinch, so on iOS the web build adds it and people can
// still pinch. Elsewhere (Android Chrome honours maximum-scale) it is left out.

export const WEB_VIEWPORT = 'width=device-width,initial-scale=1,viewport-fit=cover'
export const MOBILE_VIEWPORT = WEB_VIEWPORT + ',user-scalable=no'

/** index.html for a Capacitor build: the web viewport with zooming switched off again. */
export function mobileViewport(html) {
  return html.replace(`content="${WEB_VIEWPORT}"`, `content="${MOBILE_VIEWPORT}"`)
}

/** iPhone and iPad Safari, iPadOS included (it reports itself as a Mac with touch). */
export function isIosSafari(nav = globalThis.navigator) {
  if (!nav) return false
  const ua = nav.userAgent || ''
  return /iP(hone|od|ad)/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1)
}

/** On iOS web, add maximum-scale=1 to the viewport so a focused field never zooms the page. */
export function guardFocusZoom(doc = globalThis.document, nav = globalThis.navigator) {
  if (!doc || !isIosSafari(nav)) return false
  const meta = doc.querySelector('meta[name="viewport"]')
  const c = meta?.getAttribute('content') || ''
  if (!meta || /user-scalable=no|maximum-scale/.test(c)) return false
  meta.setAttribute('content', c + ',maximum-scale=1')
  return true
}
