// Lets non-component modules (sheet flows) navigate. App registers the router's navigate.
let _nav = () => {}
export const setNav = fn => { _nav = fn }
// `opts` goes to the router as is ({ replace: true }).
export const nav = (to, opts) => (opts ? _nav(to, opts) : _nav(to))

// Every open sheet sits on a history entry of its own (Modals.jsx), and closing it walks back
// only while the page is still where the sheet opened. A sheet that closes and moves to another
// page at once left that entry behind: back from the new page landed on it, the same page with
// no sheet, and the next back seemed to do nothing. The new page takes the sheet's entry instead.
export const onSheetEntry = () => {
  try { return !!globalThis.history?.state?.openGymSheet } catch { return false }
}

// How many sheet entries Modals.jsx still holds as live — more than the sheets open means one is
// closing right now and its entry is about to be walked off. Fewer (none, after a reload with a
// sheet's entry on top) means an entry nobody will walk off.
let liveSheetEntries = 0
export const noteSheetEntries = n => { liveSheetEntries = n }
export const sheetEntriesLive = () => liveSheetEntries

export function closeThenNav(close, to) {
  const replace = onSheetEntry()
  close()
  nav(to, replace ? { replace: true } : undefined)
}

// Into the workout screen: from the routine chooser (already #/train/workout) or from a sheet's
// entry, the session takes that entry, so one back leaves it rather than landing on itself.
export function navToWorkout() {
  const here = String(globalThis.location?.hash || '').startsWith('#/train/workout')
  nav('/train/workout', here || onSheetEntry() ? { replace: true } : undefined)
}
