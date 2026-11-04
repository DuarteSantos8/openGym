import { cloneElement, useId } from 'react'
import { useScrubbyInput } from '../lib/use-scrubby-input.js'
import { t } from '../lib/i18n.js'

// Render props keep NumberField's typing and effort buttons' picker behavior intact.
export default function ScrubbyInput({ children, numeric = false, frame, ...options }) {
  const scrub = useScrubbyInput(options)
  const descriptionId = useId()
  const child = children(scrub.value)
  const description = options.enabled ? t('Long-press and drag workout values to adjust them.') : undefined
  const control = <span ref={scrub.ref} className={'scrubby-shell' + (options.enabled ? ' scrubby' + (numeric ? ' scrubby-number' : '') : '') + (scrub.active ? ' scrubbing' : '')}>
    {options.enabled ? cloneElement(child, { 'aria-describedby': [child.props['aria-describedby'], descriptionId].filter(Boolean).join(' ') }) : child}
    {options.enabled && numeric && <span className="scrubby-hit" aria-hidden="true" />}
    {options.enabled && <span id={descriptionId} hidden>{description}</span>}
  </span>
  return frame ? frame(scrub.value, control, scrub.active) : control
}
