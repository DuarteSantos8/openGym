/* Where this copy of the app is served from, e.g. "/" or "/myGym/" (issue #238).
 *
 * The app routes behind the hash and its assets are relative (vite `base: './'`), so the only
 * thing that assumed the site root was the API call. A reverse proxy that puts openGym under a
 * subpath — and strips that prefix before the container sees it, which is what Caddy's
 * `handle_path` and its equivalents do — got `/api/...` at the proxy's own root, where there is
 * nothing to answer it.
 *
 * `location.pathname` is the base because the router never leaves it: every screen is a hash,
 * and a path that is not a file is sent back to the app's root before React boots
 * (web/nginx.conf.template). Anything after the last slash is therefore index.html or a stale
 * deep link, and is dropped.
 *
 * Runs of slashes collapse to one; backslashes go with them, although an http(s) location never
 * has one (the parser has already made it a slash). nginx merges slashes and resolves an encoded
 * "..%2F" before it looks for a file, so it serves the real app at
 * https://gym.example//evil.example/..%2F/, scripts and all. Taken as-is, that path starts with
 * "//", which is a URL to another host, and every API call, the passkey sign-in included, went
 * to evil.example. A base that starts with exactly one slash can only ever name a path on this
 * origin. The URL parser gets the last word all the same: a base it would still read as another
 * host is refused rather than used.
 *
 * Its own module, not api.js, because the store needs it too (the server a signed-in browser
 * syncs with) and many tests replace api.js wholesale.
 */
const PROBE = 'http://base.invalid'
export function appBase(loc = typeof location !== 'undefined' ? location : null) {
  const path = ((loc && loc.pathname) || '/').replace(/[\\/]+/g, '/')
  const base = path.slice(0, path.lastIndexOf('/') + 1) || '/'
  if (new URL(base, PROBE).origin !== PROBE) throw new Error('Refusing an API base that points at another site: ' + JSON.stringify(base))
  return base
}
