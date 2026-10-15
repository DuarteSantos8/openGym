import { useCallback, useRef } from 'react'

/* Long lists that page with a "Show more" button (the Library, the exercise picker, the muscle
   explorer) load their next page by themselves: the button fires once it comes within about a
   screen of the viewport, so scrolling through the catalogue never stops at it. Inside a sheet
   the sheet's own scroll clips the button, so there it fires as the button scrolls into view.

   Returns a callback ref for the button. The button itself stays: for a keyboard, a screen reader
   or a browser without IntersectionObserver it is still the way on. `onMore` may change on every
   render; the latest one is called. */
export function useAutoMore(onMore) {
  const more = useRef(onMore)
  more.current = onMore
  const observer = useRef(null)
  return useCallback(el => {
    observer.current?.disconnect()
    observer.current = null
    if (!el || typeof IntersectionObserver !== 'function') return
    observer.current = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) more.current()
    }, { rootMargin: '0px 0px 100% 0px' })
    observer.current.observe(el)
  }, [])
}
