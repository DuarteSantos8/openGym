// The boot screen in index.html: markup and CSS only, so the web image's CSP needs no new hash.
// It goes the moment the app can draw, or on a script error before that, so it never lifts forever.
export function hideBoot() {
  const b = document.getElementById('boot')
  if (!b || b.className) return
  b.className = 'out'
  setTimeout(() => b.remove(), 260)
}
