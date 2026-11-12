// The link sign in the workout's top bar (docs/dev/DEVICE_LINK_STATUS.md): one calm glyph while the
// links are fine, an orange capsule with a word when one is down. Opens the Devices sheet.
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { useDeviceLink } from './useDeviceLink.js'

// Nothing live to sync in the editor of a saved workout or a backfill, or in the tour's sandbox.
export const showLinkSign = (A, editing, tour) => !(A.backfill || editing) && !tour

const ICON = { ok: 'link', none: 'linkDashed', checking: 'link', warn: 'linkSlash' }

export default function LinkSign() {
  const { overall } = useDeviceLink({ live: true })
  const word = { ok: t('Connected'), none: t('Nothing connected'), checking: t('Checking…'), warn: t('Check link') }[overall]
  const label = t('Devices') + ': ' + word
  const open = () => import('./DevicesSheet.jsx').then(m => m.openDevicesSheet())
  return <button type="button" className={'link-sign ' + overall} aria-label={label} title={label} onClick={open}>
    <span className="link-pill">
      <span className="link-glyph"><Icon name={ICON[overall]} /></span>
      {overall === 'warn' && <span className="link-word">{t('Check link')}</span>}
    </span>
  </button>
}
