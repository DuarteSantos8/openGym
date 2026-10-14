// What a route change does to the page's scroll position (App.jsx). Pure, so the table is testable.
//   'top'     a forward navigation, or a fresh load: start at the top, now
//   'keep'    a POP that stays on the route: a sheet's history entry unwinding (Modals.jsx, #63)
//   'restore' back to a page, or into another tab (lib/use-tab-nav.js): where it was left
export function scrollAction({ first, samePath, navType, tabSwitch }) {
  if (first) return 'top'
  if (tabSwitch) return samePath ? 'keep' : 'restore'
  if (navType !== 'POP') return 'top'
  return samePath ? 'keep' : 'restore'
}
