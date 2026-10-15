import { useLayoutEffect, useState } from 'react'
import { trapDialogFocus } from './use-dialog-focus.js'

// What names a sheet: its header, as every sheet builds it (SheetHeader's <h3>, or a hand-written
// <h3>/<h2>/<h1>), the first one in the sheet.
const HEADING = 'h1, h2, h3, [role="heading"]'
const OWN_FOCUS = '[data-own-dialog-focus]'
let titles = 0

// A sheet a person opens (Modals.jsx) as a dialog: `role="dialog"` and `aria-modal`, named by its
// header, with the focus handling of lib/use-dialog-focus.js (moved in on open and kept there, the
// page behind inert, back on the opener when it closes). `el` is the sheet's own element.
//
// A sheet whose content is already a dialog (a photo viewer) keeps its own role and name, and gets
// the focus handling on that element. Only content that carries `data-own-dialog-focus` (the +
// sheet, components/PlusSheet.jsx, which runs the same trap itself) is left entirely alone: two
// traps would fight.
//
// Focus goes to the sheet itself, not to its first control: many sheets open on a text field (the
// food search, a weight) and a phone raises its keyboard for a focused field. A sheet that
// focuses a field of its own on open keeps it.
export function useSheetDialog(ref) {
  // Asked while rendering, before the sheet is in the page: a field inside that focuses itself
  // as it mounts would otherwise be taken for what opened the sheet.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement))
  useLayoutEffect(() => {
    const sheet = ref.current
    if (!sheet || sheet.querySelector(OWN_FOCUS)) return
    // Content that is already a dialog (a photo viewer) keeps its role and name and is the
    // element focus is moved into and trapped in; it only gets the rest of the handling.
    const own = sheet.querySelector('[role="dialog"]')
    const el = own ?? sheet
    let watch = null
    if (!own) {
      el.setAttribute('role', 'dialog')
      el.setAttribute('aria-modal', 'true')

      // Named by the header: aria-labelledby points at the heading itself, so a title that changes
      // is the name that changes. A header that arrives after the first paint (a sheet that loads
      // its content) names it when it does.
      let named = null
      const name = () => {
        if (named && el.contains(named)) return
        named = el.querySelector(HEADING)
        if (!named) { el.removeAttribute('aria-labelledby'); return }
        if (!named.id) named.id = `sheet-title-${++titles}`
        el.setAttribute('aria-labelledby', named.id)
      }
      name()
      watch = typeof MutationObserver === 'function' ? new MutationObserver(name) : null
      watch?.observe(el, { childList: true, subtree: true })
    }

    const release = trapDialogFocus(el, { enter: 'dialog', opener })
    return () => {
      watch?.disconnect()
      release()
    }
  }, [])
}
