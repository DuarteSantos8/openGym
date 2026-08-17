import { useEffect } from 'react'
import { App as CapApp } from '@capacitor/app'
import { useUI } from '../store/useUI.js'

/**
 * Handles the Android hardware/gesture back button for Capacitor apps.
 *
 * Priority:
 *  1. If a sheet/modal is open → close the topmost one
 *  2. If the browser history has entries → navigate back
 *  3. Otherwise → minimize the app
 */
export function handleBack({ canGoBack }) {
  const sheets = useUI.getState().sheets
  if (sheets.length > 0) {
    // Close the topmost sheet that isn't locked
    const topUnlocked = [...sheets].reverse().find(s => !s.locked)
    if (topUnlocked) {
      useUI.getState().closeSheet(topUnlocked.id)
    }
    return
  }

  if (canGoBack) {
    window.history.back()
  } else {
    CapApp.minimizeApp()
  }
}

export function useBackButton() {
  useEffect(() => {
    const handler = CapApp.addListener('backButton', handleBack)
    return () => { handler.then(h => h.remove()) }
  }, [])
}
