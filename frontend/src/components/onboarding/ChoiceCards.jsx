import { cx } from '../../lib/ui-kit.js'
import { useRadioGroup } from '../../lib/onboarding/use-radio-group.js'
import Icon from '../Icon.jsx'

// The onboarding's big answer cards (ux-onboarding §8 "choice cards", prototype v4 ccHtml): a
// radio group, a glyph, a title and a line under it, the check disc at the end. Pressing previews
// the answer in the scene (onPreview), letting go commits it, sliding off puts the committed one
// back. `slim` is the sex step's shorter card.
export default function ChoiceCards({ labelledBy, options, value, onPick, onPreview, slim = false }) {
  const values = options.map(o => o.value)
  const { tabIndexOf, onKeyDown } = useRadioGroup(values, value, onPick)
  const press = (e, v) => { e.currentTarget.classList.add('pressed'); onPreview?.(v) }
  const lift = (e, revert) => { e.currentTarget.classList.remove('pressed'); if (revert) onPreview?.(value) }
  return (
    <div className="ob-ccs" role="radiogroup" aria-labelledby={labelledBy} onKeyDown={onKeyDown}>
      {options.map(o => (
        <button key={o.value} type="button" role="radio" className={cx('ob-cc', slim && 'slim')}
          aria-checked={value === o.value} tabIndex={tabIndexOf(o.value)}
          onClick={() => onPick(o.value, { viaKey: false })}
          onPointerDown={e => press(e, o.value)} onPointerUp={e => lift(e, false)}
          onPointerLeave={e => lift(e, true)} onPointerCancel={e => lift(e, true)}>
          {o.icon && <span className="ob-cc-g"><Icon name={o.icon} /></span>}
          <span className="ob-cc-m">
            <span className="ob-cc-t">{o.title}</span>
            {o.sub && <span className="ob-cc-s">{o.sub}</span>}
          </span>
          <span className="ob-cc-ind"><Icon name="check" /></span>
        </button>
      ))}
    </div>
  )
}
