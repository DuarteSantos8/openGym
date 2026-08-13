// Device-link URL is origin + ?link=TOKEN. HashRouter never sees that query, so we read
// window.location.search directly rather than the router.

export function linkTokenFromSearch(search) {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('link') || ''
}

export function stripLinkFromUrl() {
  if (typeof window === 'undefined') return
  const u = new URL(window.location.href)
  if (!u.searchParams.has('link')) return
  u.searchParams.delete('link')
  const q = u.searchParams.toString()
  history.replaceState({}, '', u.pathname + (q ? '?' + q : '') + u.hash)
}
