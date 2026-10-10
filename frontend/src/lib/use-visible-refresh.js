import { useCallback, useEffect, useState } from 'react'

export function useVisibleRefresh(enabled) {
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    if (!enabled) return
    const whenVisible = () => { if (!document.hidden) refresh() }
    const timer = setInterval(whenVisible, 60000)
    window.addEventListener('focus', whenVisible)
    document.addEventListener('visibilitychange', whenVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', whenVisible)
      document.removeEventListener('visibilitychange', whenVisible)
    }
  }, [enabled, refresh])
  return [revision, refresh]
}
