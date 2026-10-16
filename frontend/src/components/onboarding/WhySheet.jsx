import { t } from '../../lib/i18n.js'
import { SheetActions, SheetHeader } from '../sheet-layout.jsx'
import { Button } from '../ui.jsx'

// 3a's "Why we ask": what the sex answer is for, and who sees it.
export default function WhySheet({ close }) {
  return <>
    <SheetHeader title={t('Why we ask')} />
    <p className="ob-sheet-p">{t('Bodies at rest burn energy at slightly different rates, and the standard formula has a different constant for each. “Prefer not to say” uses the average of the two.')}</p>
    <p className="ob-sheet-p">{t('It only sets your starting target. Nobody else sees it.')}</p>
    <SheetActions>
      <Button variant="primary" onClick={close}>{t('Got it')}</Button>
    </SheetActions>
  </>
}
