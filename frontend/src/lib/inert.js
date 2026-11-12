// Several dialogs can make the same element inert (the full rest view, a sheet over it). Counted, so
// the first to close does not un-inert what the other still needs.
// The last release puts back what the element was before the first hold (a swipe preview may have
// made it inert already).
const held = new WeakMap()
export function holdInert(els) {
  els.forEach(e => { const h = held.get(e) || { n: 0, was: e.inert }; h.n++; held.set(e, h); e.inert = true })
  return () => els.forEach(e => { const h = held.get(e); if (!h) return; if (--h.n <= 0) { held.delete(e); e.inert = h.was } })
}

// Everything on the page except `keep` and what must stay reachable (`live`: #modal-root, the toast and
// the announcer, which sit inside #root): the siblings along the way down to them, not their parents.
export function pageBehind(keep, live = '#modal-root,#toast,.toast-live') {
  const out = []
  const walk = n => {
    for (const e of n.children) {
      if (e === keep || e.matches('script,style,link')) continue
      if (e.matches(live)) continue
      if (e.querySelector(live)) walk(e); else out.push(e)
    }
  }
  walk(document.body)
  return out
}
