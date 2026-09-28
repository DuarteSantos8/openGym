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
 * Its own module, not api.js, because the store needs it too (the server a signed-in browser
 * syncs with) and many tests replace api.js wholesale.
 */
export function appBase(loc = typeof location !== 'undefined' ? location : null) {
  const path = (loc && loc.pathname) || '/'
  return path.slice(0, path.lastIndexOf('/') + 1) || '/'
}
