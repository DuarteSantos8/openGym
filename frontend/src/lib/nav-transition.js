export function navigateWithTransition(navigate, to, opts) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || !document.startViewTransition) {
    navigate(to, opts)
    return
  }
  document.startViewTransition(() => {
    navigate(to, opts)
  })
}
