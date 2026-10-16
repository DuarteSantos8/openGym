// While the search is open the page behind it is out of reach (fitness-eval ux-search.md §6): the
// overlay is not a modal dialog, so it is the page that is made inert, not the overlay that traps.
// What stays live is the header (the pill and the avatar's ×), the overlay with its results, the
// sheets (#modal-root: one opened over the overlay is a dialog of its own) and the toast's text;
// everything else in the document is held, whatever it is and whenever it mounts: the rest of
// #app, the tab bar, the live dock or rest timer, the sync banner.
//
// The hold is a state worked out from the document, not an action taken at one moment: the
// header is a child of #app (layout.jsx), so #app itself cannot be inert, it is everything beside
// the header's way up that is, level by level; and the document changes under it (#app is keyed
// on the route and remounts on every navigation, a view renders its header or a block under it
// once its data lands, the timer mounts when a rest starts, the banner when the connection
// drops). So it is worked out again on every change to the tree, and the release lifts exactly
// what this set.
//
// Somebody else's `inert` is left alone and left held when this lets go: App.jsx holds #app while
// a tab switch walks the history, and a sheet holds #app, #tabbar and #timer through
// use-dialog-focus. #app is held here only while it has no header (a result's page, in the
// commit before the tab root it goes back to replaces it).

// Left live, whole: a held element's subtree is held with it (inert is inherited downward).
const LIVE = '#app .tab-hdr, #gains-search, #modal-root, #toast'
// A toast's text is a live region, which must keep announcing; its action is a control.
const CONTROLS = '#toast button'
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'NOSCRIPT', 'TEMPLATE'])
// A change inside these is the overlay's or a sheet's own, and holds nothing back.
const OWN = '#gains-search, #modal-root'

/** What is to be held now: every element beside a live one's way up to <body>, and the controls
 *  of the toast. */
function toHold(doc) {
  const live = new Set(doc.querySelectorAll(LIVE))
  const way = new Set()
  for (const el of live) for (let n = el.parentElement; n; n = n.parentElement) way.add(n)
  const held = new Set(doc.querySelectorAll(CONTROLS))
  const walk = parent => {
    for (const el of parent.children) {
      if (live.has(el) || SKIP.has(el.tagName)) continue
      if (way.has(el)) walk(el)
      else held.add(el)
    }
  }
  walk(doc.body)
  return held
}

/** Holds the page still until the release. `refresh` works the hold out again (the observer does
 *  it on every change; a caller that knows the tree just changed can ask for it now). */
export function holdPage() {
  const doc = globalThis.document
  const mine = new Set()
  const refresh = () => {
    const want = toHold(doc)
    for (const el of mine) {
      if (want.has(el) && el.isConnected) continue
      el.removeAttribute('inert')
      mine.delete(el)
    }
    for (const el of want) {
      // Only when missing: setting it again would be a mutation, which would wake the observer.
      if (el.hasAttribute('inert')) continue
      el.setAttribute('inert', '')
      mine.add(el)
    }
  }
  refresh()

  // The attribute too: a sheet closing lifts the inert it held on the tab bar, which the search
  // had skipped for being held already.
  const watch = new MutationObserver(records => {
    if (records.every(r => r.target.nodeType === 1 && r.target.closest(OWN))) return
    refresh()
  })
  watch.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] })

  return {
    refresh,
    release: () => {
      watch.disconnect()
      mine.forEach(el => el.removeAttribute('inert'))
      mine.clear()
    },
  }
}
