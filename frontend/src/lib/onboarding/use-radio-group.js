import { useCallback } from 'react'

/**
 * A radio group's keyboard: a roving tabindex (the checked radio, or the first), arrow keys move
 * and select. `onPick(value, { viaKey })`: a click (a tap, Enter or Space) is viaKey false, an arrow
 * true, so a screen that moves on after a tap does not move on while someone arrows through.
 */
export function useRadioGroup(values, value, onPick) {
  const tabIndexOf = useCallback(v => ((value != null && values.includes(value) ? value === v : values[0] === v) ? 0 : -1), [values, value])
  const onKeyDown = useCallback(e => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key]
    if (!step) return
    const items = [...e.currentTarget.querySelectorAll('[role="radio"]')]
    const i = items.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    // Right is next in reading order, whichever way the page runs.
    const dir = (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && getComputedStyle(e.currentTarget).direction === 'rtl' ? -step : step
    const n = (i + dir + items.length) % items.length
    items[n].focus()
    onPick(values[n], { viaKey: true })
  }, [values, onPick])
  return { tabIndexOf, onKeyDown }
}
