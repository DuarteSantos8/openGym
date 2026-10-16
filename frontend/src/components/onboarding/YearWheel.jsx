import { useEffect, useRef, useState } from 'react'
import { t } from '../../lib/i18n.js'
import { usePicker } from '../../lib/onboarding/use-picker.js'
import { parseYear } from '../../lib/onboarding/units.js'
import { cx } from '../../lib/ui-kit.js'
import TypeIn from './TypeIn.jsx'

// 3b Born: a year wheel (§3b), greyed until touched. Spin it, arrow through it, or tap the band
// (Enter) to type the year. range: { min, max, start } (lib/onboarding/units.js yearRange).
// onChange(year, final); onBad(text) says why a typed year was not taken as typed.
export default function YearWheel({ range, value, onChange, onBad }) {
  const [touched, setTouched] = useState(value != null)
  const [typing, setTyping] = useState(false)
  const picker = usePicker({
    axis: 'y', min: range.min, max: range.max, step: 1, px: 44, cell: 44, big: 10,
    value, start: range.start,
    onTouch: () => setTouched(true),
    onInput: (v, final) => onChange(v, final),
    onTapCenter: () => setTyping(true),
  })
  const wasTyping = useRef(false)
  useEffect(() => {
    if (wasTyping.current && !typing) picker.box.current?.focus()
    wasTyping.current = typing
  }, [typing, picker.box])
  const years = []
  for (let y = range.min; y <= range.max; y++) years.push(y)
  const done = text => {
    setTyping(false)
    if (text == null) return
    const n = parseYear(text)
    if (n === null) { onBad(t('Type a year, like 1994')); return }
    const v = Math.min(range.max, Math.max(range.min, n))
    if (v !== n) onBad(t('Kept within {0}–{1}', range.min, range.max))
    setTouched(true)
    picker.set(v)
  }
  return (
    <div className={cx('ob-pk', !touched && 'untouched')}>
      <div ref={picker.box} className={cx('ob-wheel', typing && 'typing')} role="slider" tabIndex={0}
        aria-label={t('Year you were born')} aria-orientation="vertical"
        aria-valuemin={range.min} aria-valuemax={range.max} aria-valuenow={picker.value}
        aria-valuetext={touched ? t('Born {0}', picker.value) : t('Born {0}, not set', picker.value)}
        {...picker.handlers}>
        <span className="ob-wh-band" aria-hidden="true" />
        <div className="ob-wh-in" aria-hidden="true">
          <div ref={picker.track} className="ob-wh-track">
            {years.map(y => <div key={y} className={cx('ob-wh-row', y === picker.value && 'on')}>{y}</div>)}
          </div>
        </div>
      </div>
      {/* Beside the slider, over its band: a slider's children are presentational, a field inside
          one is not reachable. */}
      {typing && <TypeIn initial={value == null ? '' : String(value)} label={t('Year you were born')} onDone={done} />}
    </div>
  )
}
