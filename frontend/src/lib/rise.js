import { flushSync } from 'react-dom'

// Goes to `path` as one view transition: the live bar grows into the workout screen, and the
// workout's chevron folds it back (index.css names the two ends only while data-rise is set, so
// no two elements ever share the name). No support or reduced motion: a plain route change.
// The router's own `viewTransition` option is not used: this app runs a HashRouter, and only
// the data routers (RouterProvider) honour it.
export function riseTo (navigate, path) {
  const root = document.documentElement
  if (!document.startViewTransition || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return navigate(path)
  root.dataset.rise = path === '/workout' ? 'rise' : 'fold'
  const vt = document.startViewTransition(() => flushSync(() => navigate(path)))
  Promise.resolve(vt?.finished).finally(() => { delete root.dataset.rise })
}
