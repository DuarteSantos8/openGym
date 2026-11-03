// "Lost access?" on the sign-in screen (#584): what to do when no device signs you in any more.
// In order of how often each one is the answer: a synced passkey, another device that is still
// signed in, a recovery code from the server's admin, and for whoever runs the server, the
// server's own command. "I have a code" opens the same redemption a device link has
// (Passkeys.jsx): a recovery code is redeemed exactly like one. The phone app cannot make a
// passkey for the server, so there the code goes into a browser first and the app is paired again.
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { openDeviceLinkRedeem } from './Passkeys.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

const STEPS = () => [
  ['fingerprint', t('Your passkey may be synced'), t('Passkeys kept in iCloud Keychain, Google Password Manager or a password manager are on your other devices too. Try “Sign in with passkey” there.')],
  ['qr', t('Another device still signed in?'), t('On that one, open Settings → Account → Add another device, then enter its code here with “I have a code”.')],
  ['person', t('Ask your admin'), t('Whoever runs your openGym server can make you a recovery code in the admin dashboard. Enter it with “I have a code”, and this device gets a new passkey.')],
  ['wrench', t('Running the server yourself?'), t('Get a recovery code for any profile, the owner’s too, on the server: docker compose exec api node recover.js "Your name"')],
]

export function LostAccessSheet({ close }) {
  return <>
    <h3>{t('Lost access?')}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>{t('No panic: your training is safe on the server. One of these gets you back in.')}</div>
    <div style={{ display: 'grid', gap: 14, marginBottom: 18 }}>
      {STEPS().map(([icon, title, body]) => <div key={title} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--acc)', fontSize: 20, marginTop: 1 }}><Icon name={icon} /></span>
        <div><div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div><div className="small muted" style={{ lineHeight: 1.45, overflowWrap: 'anywhere' }}>{body}</div></div>
      </div>)}
    </div>
    {MOBILE
      ? <div className="small dim" style={{ marginBottom: 14, lineHeight: 1.45 }}>{t('In this app: enter the code on your openGym site in a browser, then pair the app again from Settings → Account there.')}</div>
      : <><Button variant="primary" icon="qr" onClick={() => { close(); openDeviceLinkRedeem() }}>{t('I have a code')}</Button><div style={{ height: 8 }} /></>}
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}

export const openLostAccess = () => useUI.getState().openSheet(close => <LostAccessSheet close={close} />)
