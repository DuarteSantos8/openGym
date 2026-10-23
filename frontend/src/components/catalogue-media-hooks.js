import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { catalogueMediaSnapshot, getCatalogueMedia, initCatalogueMedia, subscribeCatalogueMedia } from '../lib/catalogue-media.js'

export function useCatalogueMedia(override) {
  const subscribe = useCallback(fn => override ? override.subscribe(fn) : subscribeCatalogueMedia(fn), [override])
  const read = useCallback(() => override ? override.snapshot() : catalogueMediaSnapshot(), [override])
  const snapshot = useSyncExternalStore(subscribe, read, read)
  useEffect(() => { if (!override) initCatalogueMedia().catch(() => {}) }, [override])
  return { service: override || getCatalogueMedia(), snapshot }
}
