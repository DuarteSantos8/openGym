// The Devices sheet (docs/dev/DEVICE_LINK_STATUS.md). A stub for now: the link sign opens it.
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'

export function openDevicesSheet() {
  useUI.getState().openSheet(() => <div><h3>{t('Devices')}</h3></div>)
}
