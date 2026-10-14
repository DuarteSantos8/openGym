import { t } from '../lib/i18n.js'

const g = v => Math.round((v || 0) * 10) / 10

// Protein · carbs · fat in grams, always in that order with the macro colours (index.css
// --macro-*), always labelled.
export default function MacroLine({ p, c, f }) {
  return <span className="macro-line small">
    <span><i className="mdot p" aria-hidden="true" />{t('Protein')} {g(p)} g</span>
    <span><i className="mdot c" aria-hidden="true" />{t('Carbs')} {g(c)} g</span>
    <span><i className="mdot f" aria-hidden="true" />{t('Fat')} {g(f)} g</span>
  </span>
}
