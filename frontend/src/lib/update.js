// Update check — compares the installed version (__APP_VERSION__) against
// the latest release on GitHub and optionally downloads + installs the APK.
//
// The GitHub releases API is public, so no token is needed (60 requests an hour per address,
// and the check runs once per app session). GitHub is openGym's home since v1.4.0; the GitLab
// mirror stopped getting releases, so a phone that asked it saw no update.
// On Android (Capacitor) the APK is downloaded natively into the cache directory (an APK with
// the animations is ~300 MB: read into the WebView's memory it ran phones out of it, and
// github.com's download redirect has no CORS headers for a WebView fetch anyway), checked
// against its SHA-256 by the native Install plugin and handed to the system installer.

import { MOBILE } from './mobile.js'
import { APK_VARIANTS, APK_VARIANT } from './apk-variant.js'

const REPO = 'DuarteSantos8/openGym'
const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

/**
 * Compares two semver strings (e.g. "1.2.11" vs "1.3.0").
 * Returns  1 if a > b, -1 if a < b, 0 if equal.
 *
 * Build metadata is dropped first. A version that says which build it came from carries it as
 * semver build metadata ("1.3.8+2026-09-18.2"), and splitting that on "." makes the patch NaN —
 * which read as 0, so a release tagged that way compared as 1.3.0 and a real update went
 * unnoticed. Semver says the metadata plays no part in precedence, so "1.3.7+anything" and
 * "1.3.7" are the same version here. Dropped on both operands, so it holds whichever side
 * carries it.
 */
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('+')[0].split('.').map(Number)
  const pb = b.replace(/^v/, '').split('+')[0].split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff > 0) return 1
    if (diff < 0) return -1
  }
  return 0
}

/**
 * Checks GitHub for a newer version. `releases/latest` is the newest release that is neither a
 * draft nor a pre-release, so a beta never offers itself as an update.
 * Returns { hasUpdate, latestVersion, apkUrl, hashUrl } or throws on network failure.
 *   - hasUpdate: true if the latest release tag is newer than the running build
 *   - latestVersion: the semver string of the latest release (without "v" prefix)
 *   - apkUrl: direct download URL of the first .apk asset, or null
 *   - hashUrl: direct download URL of the .apk.sha256 hash file, or null
 */
// One request per app session: Settings is opened often, GitHub does not need to hear
// about it every time. The promise is cached, a failure is not.
let cached = null
export function resetUpdateCheck() { cached = null }
export async function checkForUpdate() {
  if (!cached) cached = fetchLatest().catch(e => { cached = null; throw e })
  return cached
}
async function fetchLatest() {
  const res = await fetch(LATEST_URL, { headers: { Accept: 'application/vnd.github+json' } })
  // 404: the repository has no published release yet
  if (res.status === 404) return { hasUpdate: false, latestVersion: __APP_VERSION__, apkUrl: null, hashUrl: null }
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const latest = await res.json()
  const latestVersion = String(latest.tag_name || '').replace(/^v/, '')
  if (!latestVersion) return { hasUpdate: false, latestVersion: __APP_VERSION__, apkUrl: null, hashUrl: null }
  const hasUpdate = compareSemver(latestVersion, __APP_VERSION__) > 0
  const { apk, hash } = pickApk(latest.assets || [])
  return { hasUpdate, latestVersion, apkUrl: apk?.browser_download_url || null, hashUrl: hash?.browser_download_url || null }
}

/**
 * Since v1.4.2 a release carries three sideloaded APKs, the same app with different animations
 * built in: Standard (180 px, openGym-<v>.apk), Plus (240 px, openGym-Plus-<v>.apk) and HD
 * (360 px, openGym-HD-<v>.apk). Each installed APK only ever updates to its own kind, so a phone
 * that picked HD keeps HD, and nobody is handed a download twice the size they never asked for.
 * The build says which kind it is (lib/apk-variant.js).
 * The checksum is the one named after the chosen APK, never just the first .sha256 in the list.
 * A release without an APK of this kind: no direct download (the update row then opens the
 * releases page), rather than quietly swapping it for another kind.
 * Phones from before v1.4.2 take the first .apk of the list, and GitHub sorts assets by name:
 * "openGym-1…" comes before "openGym-HD-…" and "openGym-Plus-…", so they land on Standard.
 */
export { APK_VARIANTS, APK_VARIANT }
const tagged = (name, tag) => new RegExp(`(^|[-_.])${tag}([-_.]|$)`, 'i').test(name)
/** Which kind an APK file name is: 'hd', 'plus' or 'standard'. */
export const apkKind = name => tagged(name, 'hd') ? 'hd' : tagged(name, 'plus') ? 'plus' : 'standard'
export function pickApk(assets, variant = APK_VARIANT) {
  const apk = assets.find(a => /\.apk$/i.test(a.name) && apkKind(a.name) === variant) || null
  const hash = apk ? assets.find(a => a.name === `${apk.name}.sha256`) || null : null
  return { apk, hash }
}

/**
 * The SHA-256 the release publishes next to its APK, as 64 hex characters, or null. In the app it
 * comes down natively like the APK itself (github.com answers a WebView fetch without CORS).
 */
export async function fetchChecksum(hashUrl) {
  if (!hashUrl) return null
  let text
  if (MOBILE) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    await Filesystem.downloadFile({ url: hashUrl, path: 'opengym-update.apk.sha256', directory: Directory.Cache })
    text = (await Filesystem.readFile({ path: 'opengym-update.apk.sha256', directory: Directory.Cache, encoding: Encoding.UTF8 })).data
  } else {
    const res = await fetch(hashUrl)
    if (!res.ok) return null
    text = await res.text()
  }
  const hex = String(text).trim().split(/\s/)[0]
  return /^[0-9a-f]{64}$/i.test(hex) ? hex.toLowerCase() : null
}

/**
 * Computes the SHA-256 hash of an ArrayBuffer using the Web Crypto API.
 * Returns the hex-encoded digest string.
 */
export async function sha256(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const UPDATE_FILE = 'opengym-update.apk'

/**
 * Resolves once openGym is the app in front. The package installer is an activity, and Android
 * (10 and later) does not let an app start one from the background: it refuses without a word.
 * The APK is 300 to 760 MB, plenty of time to switch to another app while it comes down, and then
 * the download finished, the installer never opened and the progress sheet just closed. So the
 * installer waits for the person to come back. `app` is @capacitor/app (injected in tests).
 */
export async function whenInForeground(app) {
  const App = app || (await import('@capacitor/app')).App
  try { if ((await App.getState())?.isActive !== false) return } catch { return }
  await new Promise(resolve => {
    let handle = null, done = false
    const finish = () => { if (done) return; done = true; Promise.resolve(handle).then(h => h?.remove?.()).catch(() => {}); resolve() }
    // The listener first, then a second look: the app may have come back in between.
    handle = Promise.resolve(App.addListener('appStateChange', st => { if (st?.isActive) finish() })).catch(() => { finish(); return null })
    Promise.resolve(App.getState()).then(st => { if (st?.isActive) finish() }).catch(() => {})
  })
}

const installPlugin = async () => {
  const { registerPlugin } = await import('@capacitor/core')
  // Handed out inside an object: a plugin proxy answers `then`, and a promise resolved with
  // the bare proxy never settles (#42).
  return { Install: registerPlugin('Install') }
}

/**
 * Downloads the APK from `url` into the cache directory, natively and straight to disk, and
 * hands it to the Install plugin, which checks it against `expectedHash` before the installer
 * opens. Only works on the MOBILE (Capacitor) build with Android.
 *
 * An APK that already came down and matches the hash (the installer did not show the last time,
 * or was dismissed) is installed again without downloading it twice. One that does not match is
 * deleted by the plugin and downloaded afresh.
 *
 * @param {string} url - Direct download URL for the APK
 * @param {string} expectedHash - Expected SHA-256 hex string (from the .sha256 asset)
 * @param {function|null} onProgress - Called with (received, total) bytes during download, or null
 */
export async function downloadAndInstall(url, expectedHash, onProgress = null) {
  if (!MOBILE) {
    window.open(RELEASES_PAGE, '_blank', 'noopener')
    return
  }
  if (!/^[0-9a-f]{64}$/i.test(expectedHash || '')) throw new Error('no checksum to verify the download against')
  const sha256 = expectedHash.toLowerCase()
  const { Install } = await installPlugin()
  // The Install plugin streams the file through SHA-256 natively (300 MB never enter the
  // WebView) and refuses a mismatch, or a missing file, before the installer opens.
  try {
    await Install.installApk({ fileName: UPDATE_FILE, sha256 })
    return
  } catch { /* nothing usable in the cache yet: download it */ }
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const listener = onProgress
    ? await Filesystem.addListener('progress', p => onProgress(p.bytes, p.contentLength))
    : null
  try {
    await Filesystem.downloadFile({ url, path: UPDATE_FILE, directory: Directory.Cache, progress: !!onProgress })
  } finally {
    await listener?.remove()
  }
  await whenInForeground()
  await Install.installApk({ fileName: UPDATE_FILE, sha256 })
}

/**
 * Deletes a downloaded update once there is nothing newer to install: the APK stays in the cache
 * after the update went in (the new app keeps the old cache), 300 to 760 MB of it.
 */
export async function forgetDownloadedUpdate() {
  if (!MOBILE) return
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.deleteFile({ path: UPDATE_FILE, directory: Directory.Cache })
  } catch { /* none there */ }
}
