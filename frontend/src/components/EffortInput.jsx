import ScrubbyInput from './ScrubbyInput.jsx'
import Icon from './Icon.jsx'
import { stepEffort } from '../lib/history.js'
import { effortColor } from '../lib/effort.js'
import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// One rating surface owns the tint, including during a local scrub preview. The inner
// value never adds a background over the row's tint. Focus uses the same rule without +/-.
const tint = (kind, value) => {
  const color = effortColor(value == null ? null : kind === 'rpe' ? 10 - value : value)
  return color ? { color, borderColor: color, background: `color-mix(in srgb, ${color} 20%, var(--surface-2))` } : undefined
}

export default function EffortInput({ kind, value, label, onChange, onOpen, scrubby, steppers = true, focus = false, disabled = false }) {
  const group = !focus && value != null
  // Keep the gesture span mounted when a rating is created or cleared. Only the frame's
  // styling changes; replacing its DOM parent would detach the native gesture listeners.
  const frame = (shown, control, active) => <div className={group ? 'stp effcell-stp' + (steppers ? '' : ' plain') + (active ? ' adjusting' : '') : 'effort-empty-shell'}
    style={group ? tint(kind, shown) : undefined}>
    {group && steppers && <button aria-label={t('Decrease')} onClick={() => onChange(stepEffort(kind, value, -1))}><Icon name="minus" /></button>}
    {control}
    {group && steppers && <button aria-label={t('Increase')} onClick={() => onChange(stepEffort(kind, value, 1))}><Icon name="plus" /></button>}
  </div>
  return <ScrubbyInput {...scrubby} enabled={!!scrubby?.enabled && !disabled} value={value}
    next={(v, dir) => stepEffort(kind, v, dir)} onCommit={onChange} frame={frame}>
    {shown => <button className={group ? 'val' : 'effcell' + (focus ? ' focus-effort' : '') + (shown == null ? ' is-empty' : '')}
      style={group ? undefined : tint(kind, shown)} aria-label={label} disabled={disabled} onClick={onOpen}>
      {shown == null ? label : fmtNum(shown)}
    </button>}
  </ScrubbyInput>
}
