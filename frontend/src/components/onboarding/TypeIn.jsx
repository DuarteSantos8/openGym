import { useEffect, useRef } from 'react'

// "Tap the number to type": a field in place of the picker's readout. Enter or leaving it commits
// what was typed, Escape keeps the old value. onDone(text) with what was typed, or null for nothing.
export default function TypeIn({ initial, label, inputMode = 'numeric', onDone }) {
  const ref = useRef(null)
  const done = useRef(false)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  const finish = keep => {
    if (done.current) return
    done.current = true
    const raw = ref.current?.value.trim() ?? ''
    onDone(keep && raw ? raw : null)
  }
  return (
    <input ref={ref} className="ob-pk-in" type="text" inputMode={inputMode} enterKeyHint="done" autoComplete="off"
      defaultValue={initial} aria-label={label}
      onKeyDown={e => {
        // The picker under it must not take these as steps.
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); finish(true) }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
      }}
      onBlur={() => finish(true)} />
  )
}
