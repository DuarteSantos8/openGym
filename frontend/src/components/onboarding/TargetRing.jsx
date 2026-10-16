import { t } from '../../lib/i18n.js'
import { useCount } from '../../lib/onboarding/use-count.js'
import { kcalText } from '../../lib/onboarding/use-target.js'
import { cx } from '../../lib/ui-kit.js'

// The live target on About you (§3b): the ring fills a quarter per body answer, the range narrows,
// and with all four in it firms up to the hub's number. Decorative to a screen reader: the caption
// under the scene says the same, once per settled answer. `big`: the sex step's 88px ring, standing
// on the hero floor like every other instrument.
const R = 44
const C = 2 * Math.PI * R

export default function TargetRing({ target, big = false }) {
  const firm = target.exact != null
  const lo = useCount(firm ? target.exact : target.lo, firm ? 640 : 320)
  const hi = useCount(firm ? target.exact : target.hi, firm ? 640 : 320)
  const number = firm ? kcalText(lo)
    : Math.round(lo) === Math.round(hi) ? t('≈ {0}', kcalText(lo))
      : t('≈ {0}–{1}', kcalText(lo), kcalText(hi))
  const unit = firm ? t('kcal a day, your starting target')
    : target.answered === 0 ? t('kcal a day, a typical range')
      : target.answered === 4 ? t('kcal a day, an estimate')
        : t('kcal a day · sharpens with each answer')
  const size = big ? 88 : 40
  const stroke = big ? 9 : 11
  return (
    <div className={cx('ob-tgt', big && 'is-big')} aria-hidden="true">
      <svg className="ob-tgt-ring" viewBox="0 0 100 100" width={size} height={size} focusable="false">
        <circle className="ob-ring-bg" cx="50" cy="50" r={R} strokeWidth={stroke} />
        <circle className="ob-ring-fg" cx="50" cy="50" r={R} strokeWidth={stroke} strokeDasharray={C.toFixed(2)}
          strokeDashoffset={(C * (1 - target.answered / 4)).toFixed(2)} transform="rotate(-90 50 50)" />
      </svg>
      <div className="ob-tgt-t">
        <div className="ob-tgt-n">{number}</div>
        <div className="ob-tgt-u">{unit}</div>
      </div>
    </div>
  )
}
