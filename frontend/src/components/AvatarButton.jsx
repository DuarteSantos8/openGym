import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'

// The way into Profile (the settings pages), on every tab's root. Its dot is the app's one sync
// indicator: a sync that is stuck while the connection banner is switched off (#369, #330).
export default function AvatarButton() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const trouble = useConnectionTrouble()
  const initial = (user?.name || '').trim().slice(0, 1).toUpperCase()
  return (
    <button className="avatar-btn" onClick={() => nav('/me')}
      aria-label={trouble ? t('Profile') + ', ' + t('Connection problem') : t('Profile')}>
      <span className="avatar-c">{initial || <Icon name="person" />}</span>
      {trouble && <span className="tab-dot" aria-hidden="true" />}
    </button>
  )
}
