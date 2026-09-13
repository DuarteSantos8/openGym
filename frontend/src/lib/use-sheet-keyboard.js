import { useCallback, useEffect } from 'react'

/* Keyboard-aware sheets. When the mobile keyboard comes up the layout viewport keeps its
   size, only the visual viewport shrinks — so a bottom sheet with a text input near its
   foot ends up half under the keys. index.css reads two custom properties on the sheet
   (--picker-keyboard-bottom / --picker-visual-height) to lift and cap it. SelectSheet in
   components/ui.jsx does exactly this sync inline; the exercise picker, the custom-exercise
   form and the note sheets need the same thing, hence this hook. The logic is deliberately
   duplicated rather than imported so ui.jsx keeps no public surface for it.

   `inputRef` points at the text input (or textarea) whose closest `.sheet` gets the vars.
   `enabled` lets a caller switch the sync off (e.g. a picker without a search box). */
export function useSheetKeyboard(inputRef, enabled = true) {
  const sync = useCallback(() => {
    const input = inputRef.current
    const sheet = input?.closest?.('.sheet')
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    if (!sheet || !viewport) return
    const visualHeight = Math.max(0, viewport.height || window.innerHeight)
    const visualBottom = (viewport.offsetTop || 0) + visualHeight
    const bottomInset = Math.max(0, window.innerHeight - visualBottom)
    sheet.style.setProperty('--picker-keyboard-bottom', `${bottomInset}px`)
    sheet.style.setProperty('--picker-visual-height', `${visualHeight}px`)
  }, [inputRef])

  useEffect(() => {
    if (!enabled) return
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null
    if (!viewport) return
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      // The sheet element outlives this input when the sheet swaps content, so leave it
      // the way we found it rather than pinning a stale keyboard inset on it.
      const sheet = inputRef.current?.closest?.('.sheet')
      sheet?.style.removeProperty('--picker-keyboard-bottom')
      sheet?.style.removeProperty('--picker-visual-height')
    }
  }, [enabled, sync, inputRef])

  // Hand back as onFocus so the first measurement happens as the keyboard opens, before
  // the visualViewport events land (on iOS they can arrive a frame late).
  return sync
}

/* Chip strips scroll sideways, and a filter set from code ("★ Chosen", a reset) can land the
   active chip off-screen. Pull it into view along the strip only. This used to be
   scrollIntoView({block:'nearest'}), which also walks every scrollable ancestor: with the
   strip scrolled above the fold (Library, halfway down the list) a tap on a chip made the
   whole page jump up to show the row — the "swiping the chips scrolls the page" bug. Setting
   the strip's own scrollLeft cannot move anything but the strip.

   `pad` mirrors scroll-padding-inline in index.css so a revealed chip is not glued to the edge. */
export function revealChip(strip, chip, pad = 16) {
  if (!strip || !chip || typeof strip.getBoundingClientRect !== 'function' || typeof chip.getBoundingClientRect !== 'function') return false
  const s = strip.getBoundingClientRect(), c = chip.getBoundingClientRect()
  const width = strip.clientWidth || s.width || 0
  if (!width) return false
  const left = c.left - s.left + (strip.scrollLeft || 0)   // chip's offset inside the strip's content
  const right = left + c.width
  let next = strip.scrollLeft || 0
  if (left - pad < next) next = Math.max(0, left - pad)
  else if (right + pad > next + width) next = right + pad - width
  if (next === (strip.scrollLeft || 0)) return false
  strip.scrollLeft = next
  return true
}

export function useRevealActiveChip(stripRef, active) {
  useEffect(() => {
    const strip = stripRef.current
    const chip = strip?.querySelector?.('.chip.on')
    if (chip) revealChip(strip, chip)
  }, [stripRef, active])
}

/* Props that make a clickable <div> behave like a button for keyboard and screen-reader
   users. Kept as a div because some rows nest a real <Button> (Library), and a button inside
   a button is invalid HTML. Space is swallowed so the page does not scroll under the row. */
export function tappable(onClick) {
  if (!onClick) return {}
  return {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: e => {
      if (e.target !== e.currentTarget) return   // a nested control handles its own keys
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick(e)
      }
    }
  }
}
