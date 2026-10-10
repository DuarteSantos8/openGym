import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { useStore } from './store/useStore.js'
import { startMediaSync } from './lib/media-sync.js'
import { startNativeKeyboard } from './lib/native-keyboard.js'
import './styles/tokens.css'
import './index.css'
// The redesign layer last: glass.css owns the tab bar's floating-pill geometry and the glass
// surfaces, which have to win over index.css's original full-bleed rules.
import './styles/glass.css'

// App.jsx restores per-route scroll itself; the browser's own attempt races it.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// The photos and videos of custom exercises, in every build (the phone and the demo included):
// uploads of what the server lacks, the local clean-up, and the plan's files kept offline.
startMediaSync(useStore)

// Android 15 does not resize the page for the soft keyboard; the app says how much it covers and
// this keeps the focused field above it. Idle everywhere else.
startNativeKeyboard()

// Not in the mobile build: the native shell already serves everything from disk.
if (!MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {})
  // The plan's exercise media, kept by the worker for a workout opened without a network (#281).
  // It only fetches ahead while the page runs as the installed app; a tab keeps what it has shown.
  import('./lib/media-prefetch.js').then(m => m.startMediaPrefetch(useStore)).catch(() => {})
}
