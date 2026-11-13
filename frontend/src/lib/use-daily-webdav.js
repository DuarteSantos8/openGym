// The daily WebDAV backup (#582), started by the app shell (App.jsx): a little after start, when
// the app comes back to the screen, and every hour while it stays open. lib/webdav-run.js runBackup
// does nothing unless this device set a folder up and the last good backup is old enough.
import { useEffect } from 'react'
import { runBackup } from './webdav-run.js'

export function useDailyWebdav(enabled) {
  useEffect(() => {
    if (!enabled) return
    const go = () => { if (typeof document === 'undefined' || !document.hidden) runBackup().catch(() => {}) }
    const first = setTimeout(go, 15000)
    const every = setInterval(go, 3600000)
    const vis = () => { if (!document.hidden) go() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearTimeout(first); clearInterval(every); document.removeEventListener('visibilitychange', vis) }
  }, [enabled])
}
