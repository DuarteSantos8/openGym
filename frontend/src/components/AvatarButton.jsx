import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { oneOf } from '../lib/ui-kit.js'
import { useHubStatusRefresh, useHubTrouble } from '../lib/nutrition/sync.js'
import Icon from './Icon.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'

// The way into Profile (the settings pages), at the end of every tab root's header. Its dot is
// the app's one sync indicator: a sync that is stuck while the connection banner is switched off
// (#369, #330), or the hub's Gains ↔ NutriTrace sync needing the person (an error, a held
// delete, suspended).
// mode="close": the same button in the same spot closes the search overlay while it is open
// (`onClose`); the dot waits until it is closed again.
export default function AvatarButton({ mode = 'profile', onClose }) {
  oneOf('AvatarButton', 'mode', mode, ['profile', 'close'])
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const connection = useConnectionTrouble()
  const hub = useHubTrouble()
  useHubStatusRefresh()
  if (mode === 'close') {
    return (
      <button type="button" className="avatar-btn close" onClick={onClose} aria-label={t('Close search')}>
        <span className="avatar-c"><Icon name="xmark" /></span>
      </button>
    )
  }
  const initial = (user?.name || '').trim().slice(0, 1).toUpperCase()
  const label = connection ? t('Profile') + ', ' + t('Connection problem')
    : hub ? t('Profile') + ', ' + t('Nutrition sync needs attention') : t('Profile')
  return (
    <button type="button" className="avatar-btn" onClick={() => nav('/me')} aria-label={label}>
      <span className="avatar-c">{initial || <Icon name="person" />}</span>
      {(connection || hub) && <span className="tab-dot" aria-hidden="true" />}
    </button>
  )
}
