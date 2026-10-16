import { useEffect, useMemo, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { usePicker } from '../../lib/onboarding/use-picker.js'
import { cx } from '../../lib/ui-kit.js'
import Icon from '../Icon.jsx'
import TypeIn from './TypeIn.jsx'

// Height and weight (§3b 3c, 3d): the number over a ruler, a unit chip beside it, and the ruler
// itself under a fixed needle. Greyed until touched; tapping the number types it instead. One path
// holds every tick; the labels are HTML.
//
// scale: a unit's ruler from lib/onboarding/units.js. value: in that unit, or null (not set yet; the
// ruler rests on scale.start). onChange(value, final). unit: { text, label, onSwitch } for the chip.
// typed: { label, inputMode, initial(value) → text, parse(text) → number|null, bad, kept } for tap
// to type, where `bad` and `kept` are what onBad(text) says (a toast) for a number it cannot read
// or one it brought within the ruler's range.
function ticks(scale) {
  const n = Math.round((scale.max - scale.min) / scale.step)
  const multiple = (v, m) => Math.abs(v / m - Math.round(v / m)) < 1e-6
  let d = ''
  const labels = []
  for (let k = 0; k <= n; k++) {
    const v = Number((scale.min + k * scale.step).toFixed(3))
    const major = multiple(v, scale.major)
    if (!major && !multiple(v, scale.minor)) continue
    const x = k * scale.px
    d += `M${x} 0v${major ? 22 : 12}`
    if (multiple(v, scale.every)) labels.push({ x, text: scale.label(v) })
  }
  return { d, labels, width: n * scale.px }
}

export default function RulerPicker({ scale, value, label, onChange, unit, typed, onBad }) {
  const [touched, setTouched] = useState(value != null)
  const [typing, setTyping] = useState(false)
  // Back on the number once the field closes, where the person was.
  const numRef = useRef(null)
  const wasTyping = useRef(false)
  useEffect(() => {
    if (wasTyping.current && !typing) numRef.current?.focus()
    wasTyping.current = typing
  }, [typing])
  const marks = useMemo(() => ticks(scale), [scale])
  const picker = usePicker({
    axis: 'x', min: scale.min, max: scale.max, step: scale.step, px: scale.px, big: scale.big,
    value, start: scale.start,
    onTouch: () => setTouched(true),
    onInput: (v, final) => onChange(v, final),
  })
  const shown = picker.value
  const [num, small] = scale.read(shown)
  const say = scale.say(shown)
  const commitTyped = text => {
    setTyping(false)
    if (text == null) return
    const n = typed.parse(text)
    if (n === null || !Number.isFinite(n)) { onBad(typed.bad); return }
    const v = Math.min(scale.max, Math.max(scale.min, n))
    if (v !== n) onBad(typed.kept)
    setTouched(true)
    picker.set(v)
  }
  return (
    <div className={cx('ob-pk', !touched && 'untouched')}>
      <div className="ob-pk-read">
        {typing
          ? <TypeIn initial={value == null ? '' : typed.initial(shown)} label={typed.label} inputMode={typed.inputMode} onDone={commitTyped} />
          : <button ref={numRef} type="button" className="ob-pk-num" onClick={() => setTyping(true)}
            aria-label={touched ? t('{0}: {1}. Tap to type it', label, say) : t('{0}: {1}, not set. Tap to type it', label, say)}>
            <span className="ob-pk-v">{num}</span>{small && <small>{small}</small>}
          </button>}
        <button type="button" className="ob-uchip" onClick={unit.onSwitch} aria-label={unit.label}>
          <span>{unit.text}</span><Icon name="chevronsUpDown" />
        </button>
      </div>
      <div ref={picker.box} className="ob-ruler" role="slider" tabIndex={0} aria-label={label}
        aria-valuemin={scale.min} aria-valuemax={scale.max} aria-valuenow={shown} aria-valuetext={say}
        {...picker.handlers}>
        <div className="ob-rul-in" aria-hidden="true">
          <div ref={picker.track} className="ob-rul-track" style={{ '--w': marks.width }}>
            <svg width={marks.width + 4} height="24" viewBox={`-2 -1 ${marks.width + 4} 24`} aria-hidden="true" focusable="false"><path d={marks.d} /></svg>
            {marks.labels.map(l => <span key={l.x} className="ob-rul-lbl" style={{ '--x': l.x }}>{l.text}</span>)}
          </div>
        </div>
        <span className="ob-rul-needle" aria-hidden="true" />
      </div>
    </div>
  )
}
