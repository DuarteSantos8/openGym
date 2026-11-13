// The React side of lib/build-caps.js: true in openGym Offline. It is decided before the first
// render, so this mostly reads a constant; the subscription covers a slow native answer.
import { useSyncExternalStore } from 'react'
import { offlineBuild, subscribeBuildCaps } from './build-caps.js'

export const useOfflineBuild = () => useSyncExternalStore(subscribeBuildCaps, offlineBuild, offlineBuild)
