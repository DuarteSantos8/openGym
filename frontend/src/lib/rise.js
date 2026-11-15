// Goes to `path` as one view transition: the live bar grows into the workout screen, and the
// workout's chevron folds it back (index.css names the two ends only while data-rise is set, so
// no two elements ever share the name). No support or reduced motion: a plain route change.
// The router's own `viewTransition` option is not used: this app runs a HashRouter, and only
// the data routers (RouterProvider) honour it.

// HashRouter renders inside React.startTransition, so the browser must be held until the new
// page is really drawn: the hash matches, then two frames. Never longer than 500 ms.
const rendered = path => new Promise(resolve => {
  const end = Date.now() + 500
  const frame = fn => requestAnimationFrame(fn)
  const wait = () => {
    if (location.hash.slice(1) !== path && Date.now() < end) return frame(wait)
    frame(() => frame(resolve))
  }
  wait()
})

export function riseTo (navigate, path) {
  const root = document.documentElement
  if (!document.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return navigate(path)
  const clear = () => { delete root.dataset.rise }
  root.dataset.rise = path === '/workout' ? 'rise' : 'fold'
  try {
    const vt = document.startViewTransition(() => { navigate(path); return rendered(path) })
    Promise.resolve(vt?.finished).then(clear, clear)
  } catch {
    clear()
    navigate(path)
  }
}
