// The "New in x.y.z" sheet (lib/whats-new.js): once after an update, from Home, and again any
// time from Settings → About.
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { notesFor, latestNoted, takeWhatsNew, takeUpdateNudge } from '../lib/whats-new.js'
import { MOBILE } from '../lib/mobile.js'
import { DEMO } from '../lib/demo.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

function WhatsNewSheet({ version, rows, close }) {
  return <>
    <h3 style={{ marginBottom: 10 }}>{t('New in {0}', version)}</h3>
    <div className="list menu-list">
      {rows.map((r, i) => <div key={i} className="item menu-item" style={{ cursor: 'default' }}>
        <span className="lrow-i"><Icon name={r.icon} /></span>
        <div className="grow"><div className="tt" style={{ whiteSpace: 'normal' }}>{r.text}</div></div>
      </div>)}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', marginTop: 14 }}>
      <Button variant="primary" onClick={close}>{t('Nice!')}</Button>
    </div>
  </>
}

/** Opens the sheet for `version` (by default this one, or the last that had notes). */
export function openWhatsNew(version = latestNoted(__APP_VERSION__)) {
  const rows = notesFor(version)
  if (!rows) return false
  const v = String(version).replace(/^v/, '').split('+')[0]
  useUI.getState().openSheet(close => <WhatsNewSheet version={v} rows={rows} close={close} />)
  return true
}

let looked = false
/**
 * Home's one look per app start: What's new after an update, else, on the APK that installs its
 * own updates, a word that a newer version is out. Never in the demo or during a workout.
 */
export async function lookOnStart(S, goAbout) {
  if (looked || DEMO) return
  looked = true
  if (S?.active) return
  if (takeWhatsNew(S, __APP_VERSION__)) { openWhatsNew(); return }
  if (!MOBILE) return
  try {
    const { getChannel } = await import('../lib/channel.js')
    if (await getChannel() !== 'sideload') return
    const { checkForUpdate } = await import('../lib/update.js')
    const info = await checkForUpdate()
    if (!info?.hasUpdate || !takeUpdateNudge(info.latestVersion, __APP_VERSION__)) return
    useUI.getState().toast(t('openGym {0} is out', info.latestVersion), { action: t('Update'), onAction: goAbout, ms: 8000 })
  } catch { /* offline: next start */ }
}
export const _resetLookForTests = () => { looked = false }
