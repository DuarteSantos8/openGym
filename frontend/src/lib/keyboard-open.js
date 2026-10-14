// Whether the on-screen keyboard is up, as a class on <body> (`kb-open`): the bar and the live dock
// hide under it rather than ride up on it and cover the field being typed in. A phone's keyboard
// opens for exactly the fields below, so focus says it; a desktop's keyboard is not on screen,
// so with a fine pointer nothing changes. Android 15's own report (native-keyboard.js) counts too.
const TYPES = new Set(['text', 'search', 'email', 'number', 'tel', 'url', 'password', ''])

export function opensKeyboard(el) {
  if (!el || el.disabled || el.readOnly) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && TYPES.has(String(el.getAttribute('type') || '').toLowerCase())
}

export function installKeyboardClass(win = window) {
  const coarse = win.matchMedia?.('(pointer: coarse)')
  if (!coarse?.matches) return () => {}
  const body = win.document.body
  const sync = () => body.classList.toggle('kb-open', opensKeyboard(win.document.activeElement))
  // focusout fires before the next field's focusin: wait for focus to settle before deciding.
  const later = () => win.setTimeout(sync, 0)
  win.addEventListener('focusin', sync)
  win.addEventListener('focusout', later)
  return () => {
    win.removeEventListener('focusin', sync)
    win.removeEventListener('focusout', later)
    body.classList.remove('kb-open')
  }
}
