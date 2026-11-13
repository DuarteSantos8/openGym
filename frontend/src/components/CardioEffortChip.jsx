// How hard a cardio set felt, right on the row (QOL Q5): "Rate it" until rated, then "RPE 7"
// tinted like every other effort value. It used to live only in the set menu, where nobody found
// it. The caller opens the picker, so this stays a plain button with no sheet of its own.
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { effortColor } from '../lib/effort.js'
import Icon from './Icon.jsx'

export default function CardioEffortChip({ value, onOpen, disabled = false }) {
  const rated = value != null
  const tint = rated ? effortColor(10 - value) : null
  return <button type="button" className={'cardio-eff' + (rated ? ' on' : '')} disabled={disabled}
    style={tint ? { '--eff': tint } : undefined}
    aria-label={rated ? t('How hard it felt: RPE {0}', fmtNum(value)) : t('Rate how hard it felt')}
    onClick={onOpen}>
    <Icon name="gauge" />{rated ? t('RPE {0}', fmtNum(value)) : t('Rate it')}
  </button>
}
