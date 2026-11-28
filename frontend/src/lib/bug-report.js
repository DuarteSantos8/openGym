// Settings → About → Report a problem (#1482): GitHub's bug form, opened with the app version and
// the device already filled in, the two fields people most often leave blank or guess. The app
// sends nothing itself: it only opens a link, and the reporter sees and can change every word
// before posting. Nothing from the profile goes into it, only what the browser tells any website.
// The repository the reports go to: a fork's own, the way lib/update.js picks where updates come
// from (VITE_UPDATE_REPO). Read here rather than imported, so this stays a leaf module.
const reportRepo = (env = import.meta.env || {}) => env.VITE_UPDATE_REPO || 'DuarteSantos8/openGym'

/** "Android 16" / "iOS 26.1" / "Windows" ..., read from a user agent string, or ''. */
export function osOf(ua = '') {
  const s = String(ua)
  let m
  if ((m = s.match(/Android (\d+(?:\.\d+)?)/))) return 'Android ' + m[1]
  if ((m = s.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/))) return (/iPad/.test(s) ? 'iPadOS ' : 'iOS ') + m[1] + '.' + m[2]
  if (/Windows/.test(s)) return 'Windows'
  if (/Mac OS X|Macintosh/.test(s)) return 'macOS'
  if (/CrOS/.test(s)) return 'ChromeOS'
  if (/Linux/.test(s)) return 'Linux'
  return ''
}

/** "Chrome 141" / "Firefox 133" / "Safari 18.1" / "Edge 141", or ''. */
export function browserOf(ua = '') {
  const s = String(ua)
  let m
  if ((m = s.match(/Edg(?:e|A|iOS)?\/(\d+)/))) return 'Edge ' + m[1]
  if ((m = s.match(/(?:Firefox|FxiOS)\/(\d+)/))) return 'Firefox ' + m[1]
  if ((m = s.match(/(?:Chrome|CriOS)\/(\d+)/))) return 'Chrome ' + m[1]
  if ((m = s.match(/Version\/(\d+(?:\.\d+)?).*Safari/))) return 'Safari ' + m[1]
  return ''
}

/**
 * The line for the form's "Device, OS & browser": the phone app says so (its web view is not a
 * browser anyone chose), the web app names the browser.
 */
export function environmentOf(ua, { app = false } = {}) {
  const os = osOf(ua)
  if (app) return ['openGym app', os].filter(Boolean).join(' on ')
  return [browserOf(ua), os].filter(Boolean).join(' on ')
}

/** The issue form's address, with version and environment filled in. */
export function bugReportUrl({ version, environment, repo = reportRepo() }) {
  const q = new URLSearchParams({ template: 'bug_report.yml' })
  if (version) q.set('version', String(version).slice(0, 120))
  if (environment) q.set('environment', String(environment).slice(0, 200))
  return `https://github.com/${repo}/issues/new?${q}`
}
