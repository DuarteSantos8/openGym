import { useEffect } from 'react'
import { headerProgress } from './headerScroll.js'
import { nextMin } from './tabbar-glass.js'

// Where the page is scrolled to, also while an open sheet pins the body (components/Modals.jsx):
// pinned, window.scrollY reads 0 and the header would act as if the page were back at the top.
export const pageY = () => { const b = document.body.style; return b.position === 'fixed' ? -(parseFloat(b.top) || 0) : window.scrollY }

// Drives the iPhone header (components/ScreenHeader.jsx, Liquid Glass G3) from the window's
// scroll. `gh` holds the fixed layers (.edge, .nav with the .inl small title, and on the workout
// the .pillrow); `lt` is the large title, the page's one h1. Opacities are written straight to the
// elements on a frame, so a scroll never re-renders the screen. Layout is read only when it can
// have changed: a resize (Text size), a title or button group that grew, Reduce Motion flipping.
// Reduce Motion has no transitions of its own to wait for (index.css drops them all).
export function useHeaderScroll(gh, lt) {
  useEffect(() => {
    const g = gh.current, h = lt.current
    if (!g || !h) return undefined
    const edge = g.querySelector('.edge'), inl = g.querySelector('.inl'), nav = g.querySelector('.nav')
    if (!nav) return undefined   // the old header, off the iPhone
    const pill = g.querySelector('.pillrow'), sub = h.nextElementSibling
    const q = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    let T = 0, raf = 0
    const draw = () => {
      raf = 0
      const rm = !!q?.matches
      const p = headerProgress(pageY(), T, rm)
      edge.style.opacity = p.e
      inl.style.opacity = p.t
      inl.style.transform = rm ? 'none' : `translateY(${(1 - p.t) * 6}px)`
      h.style.opacity = p.titleOpacity
      if (sub) sub.style.opacity = p.titleOpacity
    }
    const queue = () => { raf ||= requestAnimationFrame(draw) }
    const measure = () => {
      // the edge's solid part ends under the nav row, or under the pill row on the workout (offsets, so the pill's slide does not count)
      const eb = pill ? pill.offsetTop + pill.offsetHeight + 4 : nav.offsetTop + nav.offsetHeight
      T = h.getBoundingClientRect().bottom + pageY() - eb
      let l = nav.children[0].offsetWidth, r = nav.children[1].offsetWidth
      if (!pill) l = r = Math.max(l, r)   // one button side: the small title is truly centred
      inl.style.setProperty('--il', l + 28 + 'px'); inl.style.setProperty('--ir', r + 28 + 'px')
      if (parseFloat(getComputedStyle(document.documentElement).fontSize) >= 20) g.dataset.ax = ''; else delete g.dataset.ax   // Text size: Larger
      queue()
    }
    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(h); [...nav.children].forEach(c => ro?.observe(c))
    window.addEventListener('scroll', queue, { passive: true })
    window.addEventListener('resize', measure)
    q?.addEventListener?.('change', queue)
    return () => {
      cancelAnimationFrame(raf); ro?.disconnect()
      window.removeEventListener('scroll', queue); window.removeEventListener('resize', measure)
      q?.removeEventListener?.('change', queue)
    }
  }, [gh, lt])
}

// While the page is scrolled down, then until a short scroll up: the workout's pill row folds away
// with it. The same accumulator as the tab bar's (lib/tabbar-glass.js). The state lives in a ref and
// goes straight to the header (class `pc`, pill row inert), so a fold never re-renders the screen.
export function useScrollCollapse(on, hdr) {
  useEffect(() => {
    const g = hdr.current
    if (!on || !g) return undefined
    const pill = g.querySelector('.pillrow')
    const s = { min: false, acc: 0, last: pageY(), quiet: Date.now() + 150 }   // a restored position is not a gesture
    let raf = 0   // one layout read per frame, not per scroll event
    const step = () => {
      raf = 0
      const y = pageY()
      if (Date.now() < s.quiet) { s.last = y; return }
      const r = nextMin({ min: s.min, acc: s.acc, y, last: s.last, scrollMax: document.documentElement.scrollHeight - window.innerHeight })
      s.last = y; s.acc = r.acc
      if (r.min !== s.min) { s.min = r.min; g.classList.toggle('pc', r.min); if (pill) pill.inert = r.min }
    }
    const onScroll = () => { raf ||= requestAnimationFrame(step) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll); g.classList.remove('pc'); if (pill) pill.inert = false }
  }, [on, hdr])
}
