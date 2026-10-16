import { t, tn } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { navOf, progressOf, stepOf, stepsLeft } from '../../lib/onboarding/flow.js'
import { cx } from '../../lib/ui-kit.js'
import Icon from '../Icon.jsx'

// The onboarding's one header row: back, the 3-segment progress (Goal · You · Training; You fills
// in quarters and the bar never shrinks) with "N steps left" under it, and Skip. What it shows on each screen is the flow's
// (lib/onboarding/flow.js navOf), never the screen's. Hidden, it keeps its height.
const progressText = screen => ({
  goal: t('Goal'), sex: t('You, 1 of 4'), born: t('You, 2 of 4'), height: t('You, 3 of 4'), weight: t('You, 4 of 4'),
  training: t('Training'), plan: t('Training, plan'), starter: t('Training, plan'),
}[screen])

export default function OnboardingNav({ ref }) {
  const { screen, state, back, skip } = useOnboarding()
  const meta = navOf(screen)
  const want = progressOf(screen)
  const step = stepOf(screen)
  const left = meta.show ? stepsLeft(state.server?.remaining, screen) : null
  return (
    <nav ref={ref} className={cx('ob-nav', !meta.show && 'gone')} aria-label={t('Onboarding')} aria-hidden={!meta.show || undefined}>
      <button type="button" className="ob-nbtn" aria-label={t('Back')} onClick={back} disabled={!meta.show || !meta.back}>
        <Icon name="chevronLeft" />
      </button>
      <div className="ob-mid">
        <div className={cx('ob-prog', !want && 'off')} role="progressbar" aria-hidden={!want || undefined}
          aria-valuemin={1} aria-valuemax={3} aria-valuenow={step || 1}
          aria-valuetext={want ? t('Step {0} of 3: {1}', step, progressText(screen)) : undefined}>
          {state.progress.map((fill, i) => <span key={i}><i style={{ '--fill': fill }} /></span>)}
        </div>
        {/* Always in the tree, so the count is announced when it changes, politely. */}
        <span className="ob-left" aria-live="polite">{left ? tn('{0} step left', '{0} steps left', left) : ''}</span>
      </div>
      {meta.show && meta.skip
        ? <button type="button" className="ob-nend" onClick={() => skip(screen)}>{t('Skip')}</button>
        : <span aria-hidden="true" />}
    </nav>
  )
}
