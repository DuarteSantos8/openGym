import { useSyncExternalStore } from 'react'
import { dynamicSnapshot, subscribeDynamic } from './dynamic-color.js'

/** { palette, chosen }: the wallpaper's palette on this phone (or null) and whether it is used. */
export function useDynamicColor() {
  return useSyncExternalStore(subscribeDynamic, dynamicSnapshot, dynamicSnapshot)
}
