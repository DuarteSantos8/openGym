// The sideloaded APK's update: the download and install that Settings → About runs, and the same
// offer made when the app is opened (lib/update-notice.js decides when).
import { useState, forwardRef } from 'react'
import { t } from '../lib/i18n.js'
import { MOBILE, isAndroid } from '../lib/mobile.js'
import { getChannel } from '../lib/channel.js'
import { checkForUpdate, downloadAndInstall, fetchChecksum } from '../lib/update.js'
import { offerNow, readSeen, writeSeen } from '../lib/update-notice.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { confirmSheet } from '../sheets.jsx'

// Download progress sheet — receives a ref callback that exposes a (received, total) setter.
// Uses forwardRef so the caller can push byte counts in without re-rendering what is underneath.
const DownloadProgress = forwardRef(function DownloadProgress(_, ref) {
  const [pct, setPct] = useState(0)
  const [text, setText] = useState(t('Starting download…'))
  // Expose a setter the caller can invoke directly
  if (ref) ref(function update(received, total) {
    if (total > 0) {
      const p = Math.min(100, Math.round((received / total) * 100))
      setPct(p)
      setText(t('{0} %', p))
    } else {
      setText(t('{0} MB', (received / 1_000_000).toFixed(1)))
    }
  })
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <h3>{t('Downloading update…')}</h3>
      <div style={{ margin: '16px 0', height: 6, borderRadius: 3, background: 'var(--fill-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: 'var(--acc)', borderRadius: 3, transition: 'width .2s' }} />
      </div>
      <div className="muted small">{text}</div>
    </div>
  )
})

/** Downloads `info`'s APK with a progress sheet, checks it against the release's checksum and
 *  opens the installer. */
export async function installUpdate(info) {
  // Started by hand (About) or from the offer: either way this version has been offered.
  if (info?.latestVersion) writeSeen(info.latestVersion)
  let closeProgress = null
  let setProgress = null
  useUI.getState().openSheet(close => {
    closeProgress = close
    return <DownloadProgress ref={fn => { setProgress = fn }} />
  }, { locked: true })
  try {
    // The release always publishes the checksum next to the APK. Without it the file is
    // not installed — a sideloaded binary is exactly the thing that should be verified.
    let expectedHash = null
    try { expectedHash = await fetchChecksum(info.hashUrl, info.hashApiUrl) } catch (e) { /* reported below */ }
    if (!/^[0-9a-f]{64}$/i.test(expectedHash || '')) throw new Error(t('Checksum not available, so not installing'))
    await downloadAndInstall(info.apkUrl, expectedHash, (received, total) => {
      if (setProgress) setProgress(received, total)
    }, info.apkApiUrl)
    if (closeProgress) closeProgress()
  } catch (e) {
    if (closeProgress) closeProgress()
    useUI.getState().toast(t('Update failed: {0}', e.message))
  }
}

/** Settings → About's question before an update, also asked when the app opens. */
export function askToUpdate(info, { notNow = false } = {}) {
  confirmSheet({
    title: t('Update to {0}?', info.latestVersion),
    message: t('The latest version will be downloaded and the installer will open.'),
    confirmText: t('Download & Install'),
    ...(notNow ? { cancelText: t('Not now') } : {}),
    onConfirm: () => installUpdate(info),
  })
}

/** When the app opens and each time it comes back to the front: a newer release of the sideloaded
 *  APK, not offered before, asks once (lib/update-notice.js). Other builds never ask: Play and
 *  F-Droid update the app themselves, and iOS and the web have no APK. */
// An answer this old is asked again when the app comes back to the front (GitHub allows 60 an hour).
const RECHECK_MS = 60 * 60000
let started = false
export async function initUpdateNotice() {
  if (!MOBILE || started) return
  started = true
  if (!(await isAndroid()) || (await getChannel()) !== 'sideload') return
  // A workout open, or a sheet up (an update started from About is one): the offer waits.
  const busy = () => !!useStore.getState().S?.active || useUI.getState().sheets.length > 0
  let waiting = false
  const check = async () => {
    if (document.hidden) return
    const info = await checkForUpdate({ maxAge: RECHECK_MS }).catch(() => null)
    const now = offerNow(info, readSeen(), busy())
    waiting = now === 'wait'
    if (now !== 'offer') return
    writeSeen(info.latestVersion)
    askToUpdate(info, { notNow: true })
  }
  // An offer held back is made once the workout is finished or the sheet closed.
  const retry = () => { if (waiting && !busy()) { waiting = false; setTimeout(check, 1000) } }
  useStore.subscribe(retry)
  useUI.subscribe(retry)
  // A moment after start, so the app's own first screen and sheets come first.
  setTimeout(check, 4000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(check, 1000) })
}
