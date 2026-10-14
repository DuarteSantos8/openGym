import { useEffect } from 'react'
import { isSwitching } from './use-tab-nav.js'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
// What sits behind a sheet and must be out of reach while it is open.
const BACKGROUND = ['app', 'tabbar', 'timer']

// A modal dialog's focus: moved onto its first control when it opens, kept inside it with Tab and
// Shift+Tab, the page behind it made inert, and handed back to what opened it when it closes —
// unless another sheet took its place (a row opening the next sheet), which then owns the focus.
export function useDialogFocus(ref) {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const opener = document.activeElement
    const made = BACKGROUND.map(id => document.getElementById(id)).filter(n => n && !n.hasAttribute('inert'))
    made.forEach(n => n.setAttribute('inert', ''))
    const controls = () => [...el.querySelectorAll(FOCUSABLE)]
    controls()[0]?.focus()
    const onKey = e => {
      if (e.key !== 'Tab') return
      const all = controls()
      if (!all.length) return
      const first = all[0], last = all[all.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      // A sheet that closes into a tab switch (a row opening another tab's page) leaves the page
      // inert: the switch holds it (App.jsx inert={switching}) and lets it go when it is done.
      made.forEach(n => { if (!(n.id === 'app' && isSwitching())) n.removeAttribute('inert') })
      if (opener?.isConnected && !document.querySelector('.sheet')) opener.focus?.()
    }
  }, [])
}
