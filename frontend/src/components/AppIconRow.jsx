import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { appIconState, setAppIcon } from '../lib/app-icon.js'
import { APP_ICON_VARIANTS } from '../lib/app-icon-variants.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'

/* Settings → Look & Home → App icon: the icon on this iPhone's home screen. The phone keeps the
   choice (lib/app-icon.js), so it is asked here and never synced. In a browser, on Android (1.4.3
   has no plugin there) or on a phone that cannot switch icons, the row is not there at all. */
export default function AppIconRow() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    appIconState().then(s => { if (live) setState(s) })
    return () => { live = false }
  }, [])
  if (!state) return null

  const pick = async id => {
    if (busy || id === state.name) return
    setBusy(true)
    try {
      // iOS confirms with its own alert, nothing to add here.
      const r = await setAppIcon(id)
      setState({ name: r.name })
    } catch (e) {
      useUI.getState().toast(t('The icon could not be changed.'))
    } finally { setBusy(false) }
  }
  const current = APP_ICON_VARIANTS.find(v => v.id === state.name) || APP_ICON_VARIANTS[0]

  return <div className="lrow app-icon-row" style={{ flexWrap: 'wrap', rowGap: 12, paddingBottom: 14 }}>
    <span className="lrow-i" style={{ '--tint': 'var(--indigo)' }}><Icon name="grid" /></span>
    <span className="lrow-m">
      <span className="lrow-t">{t('App icon')}</span>
      <span className="lrow-s">{t('Just for this phone. Some home screens take a moment to catch up.')}</span>
    </span>
    <span className="lrow-v">{t(current.name)}</span>
    <div className="app-icons" role="radiogroup" aria-label={t('App icon')}>
      {APP_ICON_VARIANTS.map(v => (
        <button key={v.id} type="button" role="radio" aria-checked={v.id === state.name} disabled={busy}
          className={'app-icon' + (v.id === state.name ? ' on' : '')} onClick={() => pick(v.id)} aria-label={t(v.name)}>
          <img src={`app-icons/${v.id}.png`} alt="" width="56" height="56" draggable="false" />
        </button>
      ))}
    </div>
  </div>
}
