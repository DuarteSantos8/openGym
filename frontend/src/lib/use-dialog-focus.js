import { useEffect } from 'react'
import { isSwitching } from './use-tab-nav.js'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
// What sits behind a sheet and must be out of reach while it is open.
const BACKGROUND = ['app', 'tabbar', 'timer']

// Sheets stack (a row opens the next sheet over the first) and need not close in the order they
// opened, so the page behind is held by a count: it goes inert with the first dialog and comes
// back with the last. Something else's inert (App.jsx holds #app while a tab switch walks the
// history) was not ours to set, so it is not ours to lift.
const holds = new Map()
function hold(id) {
  const n = document.getElementById(id)
  if (!n) return false
  const count = holds.get(id)
  if (count) { holds.set(id, count + 1); return true }
  if (n.hasAttribute('inert')) return false
  n.setAttribute('inert', '')
  holds.set(id, 1)
  return true
}
function release(id) {
  const count = holds.get(id)
  if (!count) return
  if (count > 1) { holds.set(id, count - 1); return }
  holds.delete(id)
  const n = document.getElementById(id)
  // A sheet that closes into a tab switch (a row opening another tab's page) leaves the page
  // inert: the switch holds it (App.jsx inert={switching}) and lets it go when it is done.
  if (n && !(id === 'app' && isSwitching())) n.removeAttribute('inert')
}

// The opener of the dialog that closed last, for a dialog that opens in the same tick.
let replaced = null

// A modal dialog's focus, for `el`: moved into it when it opens, kept inside it with Tab and
// Shift+Tab, the page behind it made inert, and handed back to what opened it when it closes,
// unless another sheet took its place (a row opening the next sheet), which then owns the focus.
// A sheet closing over one that stays (a stacked one) gives the focus back to the control in the
// first that opened it.
//
// `enter` says where focus goes on open: 'first' control (a small dialog of buttons), or
// 'dialog' itself (el, made focusable): the way into a sheet whose first control is a text field,
// where a phone would raise its keyboard just because a sheet opened. Focus already inside el
// (a field the sheet focused for itself) is left where it is. `opener` is what had the focus
// before the dialog was drawn, for a caller that asked before a field inside could take it.
// Returns the cleanup.
export function trapDialogFocus(el, { enter = 'first', opener: asked = document.activeElement } = {}) {
  // A sheet opened by a row of the sheet it replaces (`close(); nextSheet()` in one tap) was
  // "opened" by a control that left the page with that sheet: it inherits the opener of the dialog
  // it replaced, so closing the chain ends on what started it.
  const opener = asked?.isConnected || !replaced?.opener?.isConnected ? asked : replaced.opener
  const held = BACKGROUND.filter(hold)
  const controls = () => [...el.querySelectorAll(FOCUSABLE)]
  const inside = document.activeElement && el.contains(document.activeElement)
  if (!inside) {
    if (enter === 'dialog') {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus?.({ preventScroll: true })
    } else controls()[0]?.focus?.()
  }
  const onKey = e => {
    if (e.key !== 'Tab') return
    const all = controls()
    // Nothing to land on: the dialog itself is the one place focus may be.
    if (!all.length) { e.preventDefault(); el.focus?.({ preventScroll: true }); return }
    const first = all[0], last = all[all.length - 1]
    const at = document.activeElement
    if (e.shiftKey && (at === first || at === el)) { e.preventDefault(); last.focus?.() }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus?.() }
  }
  el.addEventListener('keydown', onKey)
  return () => {
    el.removeEventListener('keydown', onKey)
    held.forEach(release)
    // The next dialog, mounted in this same tick, reads this to inherit the opener; the entry
    // is dropped once the tick is over so a later, unrelated dialog never sees it.
    const entry = { opener }
    replaced = entry
    setTimeout(() => { if (replaced === entry) replaced = null }, 0)
    // Back to the opener, unless a sheet that does not hold it has taken over: one still up that
    // contains the opener is where it was opened from, and gets it back. Decided once the commit
    // that closed this dialog is done, not in the cleanup: a layout effect's cleanup runs before
    // React takes the dialog's own markup out of the page, so it would still count itself, and a
    // sheet that replaces this one is only in the page after it. A sheet that replaces this one
    // has moved the focus into itself by then, and is left alone. preventScroll: the page behind
    // is put back where it was by Modals, and a focus must not move it first.
    queueMicrotask(() => {
      const open = [...document.querySelectorAll('.sheet, .center, [role="dialog"]')].filter(d => d !== el && !el.contains(d))
      if (opener?.isConnected && (!open.length || open.some(d => d.contains(opener)))) opener.focus?.({ preventScroll: true })
    })
  }
}

export function useDialogFocus(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    return trapDialogFocus(el)
  }, [])
}
