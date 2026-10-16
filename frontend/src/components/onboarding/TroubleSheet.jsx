import { copyText } from '../../lib/clipboard.js'
import { t } from '../../lib/i18n.js'
import { pathOf } from '../../lib/onboarding/flow.js'
import { useUI } from '../../store/useUI.js'
import { SheetActions, SheetHeader } from '../sheet-layout.jsx'
import { Button } from '../ui.jsx'

// "Having trouble?" after a passkey prompt was cancelled or could not open: what a passkey needs,
// and the link to open in a real browser (an in-app browser cannot save one): the phone's own,
// Chrome on Android and Safari on iOS (an iPad says Macintosh, with touch).
function copyLabel() {
  const ua = navigator.userAgent
  if (/Android/.test(ua)) return t('Copy link to open in Chrome')
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return t('Copy link to open in Safari')
  return t('Copy link to open in your browser')
}

// The invite's own link, the one the inviter sent: the hub's /join/<code> page opens it in the app.
// The address on screen is the name step, which has no code in it: opened elsewhere it would be
// the same invite landing nowhere. Without a code (opened by hand), the address is all there is.
export default function TroubleSheet({ close, code }) {
  const copy = async () => {
    const link = code ? `${window.location.origin}${pathOf('invite', code)}` : window.location.href
    const ok = await copyText(link).then(() => true, () => false)
    close()
    useUI.getState().toast(ok ? t('Link copied') : t('Could not copy the link'))
  }
  return <>
    <SheetHeader title={t('Having trouble?')} />
    <p className="ob-sheet-p">{t('Passkeys need Safari or Chrome, with Face ID, Touch ID or a screen lock turned on. Some apps open links in their own browser, which can’t save one.')}</p>
    <SheetActions>
      <Button variant="primary" onClick={copy}>{copyLabel()}</Button>
      <Button onClick={close}>{t('Close')}</Button>
    </SheetActions>
  </>
}
