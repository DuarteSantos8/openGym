import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { cx, oneOf } from '../lib/ui-kit.js'
import { useHubStatusRefresh, useHubTrouble } from '../lib/nutrition/sync.js'
import Icon from './Icon.jsx'
import { useConnectionTrouble } from './SyncBanner.jsx'

// The swap's animation loads with the search chunk; until then the content swaps in place.
const IconSwap = lazy(() => import('./search/header-motion.jsx').then(m => ({ default: m.IconSwap })))

// The way into Profile (the settings pages), at the end of every tab root's header. Its dot is
// the app's one sync indicator: a sync that is stuck while the connection banner is switched off
// (#369, #330), or the hub's Gains ↔ NutriTrace sync needing the person (an error, a held
// delete, suspended).
// mode="close": the same button in the same spot closes the search overlay while it is open
// (`onClose`): only its content turns into the ×, the chrome never moves, and the dot waits
// until it is closed again (ui-search.md §2, §10.3).
export default function AvatarButton({ mode = 'profile', onClose }) {
  oneOf('AvatarButton', 'mode', mode, ['profile', 'close'])
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const connection = useConnectionTrouble()
  const hub = useHubTrouble()
  useHubStatusRefresh()
  const close = mode === 'close'
  const initial = (user?.name || '').trim().slice(0, 1).toUpperCase()
  const label = close ? t('Close search')
    : connection ? t('Profile') + ', ' + t('Connection problem')
    : hub ? t('Profile') + ', ' + t('Nutrition sync needs attention') : t('Profile')
  const content = close ? <Icon name="xmark" /> : initial || <Icon name="person" />
  return (
    <button type="button" className={cx('avatar-btn', close && 'close')} onClick={close ? onClose : () => nav('/me')} aria-label={label}>
      <Suspense fallback={<span className="avatar-c">{content}</span>}>
        <IconSwap swapKey={mode}>{content}</IconSwap>
      </Suspense>
      {(connection || hub) && <span className={cx('tab-dot', close && 'off')} aria-hidden="true" />}
    </button>
  )
}
