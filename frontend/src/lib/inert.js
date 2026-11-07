// Several dialogs can make the same element inert (the full rest view, a sheet over it). Counted, so
// the first to close does not un-inert what the other still needs.
const held = new WeakMap()
export function holdInert(els) {
  els.forEach(e => { held.set(e, (held.get(e) || 0) + 1); e.inert = true })
  return () => els.forEach(e => { const n = held.get(e) - 1; held.set(e, n); if (n <= 0) e.inert = false })
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
