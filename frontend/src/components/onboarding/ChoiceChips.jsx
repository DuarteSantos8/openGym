import { useRadioGroup } from '../../lib/onboarding/use-radio-group.js'

// A row of single-choice chips for the sheets (experience, equipment): a radio group named by the
// label above it. `value` may be null (nothing picked: an optional question).
export default function ChoiceChips({ label, options, value, onPick }) {
  const values = options.map(o => o.value)
  const { tabIndexOf, onKeyDown } = useRadioGroup(values, value, v => onPick(v))
  return <>
    <div className="ob-slbl" aria-hidden="true">{label}</div>
    <div className="ob-chips" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" className="ob-chip" aria-checked={value === o.value}
          tabIndex={tabIndexOf(o.value)} onClick={() => onPick(o.value)}>{o.label}</button>
      ))}
    </div>
  </>
}
