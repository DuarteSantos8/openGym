import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// One line under the header for a signed-in user whose changes are not on the server: offline,
// or a push the server refused. Guests and the standalone phone build have no server to sync
// with, so it never shows for them. Tapping retries at once instead of waiting for the poll.
export default function SyncBanner() {
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  const pushState = useStore(s => s.pushState)
  const pullState = useStore(s => s.pullState)
  if (!user || !sync) return null
  if (!sync.offline && !sync.pending) return null
  const retry = () => { pushState(); pullState() }
  return <button className={'sync-banner' + (sync.offline ? ' off' : '')} onClick={retry}>
    <Icon name={sync.offline ? 'bellSlash' : 'reset'} />
    <span>{sync.offline
      ? (sync.pending ? t('Offline — your changes are saved on this device and sync when you are back online.') : t('Offline — showing the last copy synced with the server.'))
      : t('Not synced yet — tap to retry.')}</span>
  </button>
}
