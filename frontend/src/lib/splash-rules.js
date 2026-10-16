// When the animated splash plays, and for how long. Pure, so the rules are tested without a page.
// The splash is brand, never a gate: it must not keep a ready app waiting beyond MIN_SHOW_MS, and it
// must not stand between a link or a notification and the screen it opens.

// The least time the splash is up once it has played, counted from its mount: long enough for the
// letters (lib/brand-splash.js, about a second) to be seen, short enough to be no wait at all.
export const MIN_SHOW_MS = 1200

// A launch that was asked to open somewhere: a route in the hash (a deep link, a notification tap,
// which opens `#/…`) or a query (a pairing link). A plain cold start has neither ("#", "#/" and an
// empty query are the same as none).
export function isDeepLaunch({ hash = '', search = '' } = {}) {
  const route = hash.replace(/^#\/?/, '')
  return route !== '' || search.replace(/^\?/, '') !== ''
}

// Whether the splash may start at all, from what is known at mount. An app that is already ready
// has nothing to cover.
export function mayPlay({ started, canDraw, reducedMotion, ready, location }) {
  return !started && canDraw && !reducedMotion && !ready && !isDeepLaunch(location)
}

// Whether the splash goes now: the app is ready and it has been up for MIN_SHOW_MS (or was ended
// early by a tap or a key), or the app is ready and the letters have still not loaded, in which
// case there is nothing to show and nothing to wait for.
export function splashAction({ ready, held, drawing }) {
  if (!ready) return 'wait'
  if (!drawing) return 'skip'
  return held ? 'leave' : 'wait'
}
