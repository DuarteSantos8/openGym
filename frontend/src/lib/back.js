// Android system back (the gesture and the hardware/nav button are the same event).
//
// Capacitor's BridgeActivity does not handle back at all — without a JS listener the
// activity simply finishes, so a back swipe quit the app from anywhere, whatever the
// WebView history said. That made the sheet history entries from #63 dead weight in the
// packaged app: they only ever worked in a browser tab, where the browser walks history
// itself.
//
// Once a `backButton` listener exists, the plugin stops falling through to finish() —
// back can then ONLY leave the app through App.exitApp(), which is why the last step is
// an explicit press-again-to-exit rather than a silent no-op.
import { MOBILE } from './mobile.js'
import { useUI } from '../store/useUI.js'
import { t } from './i18n.js'

// How long a first back press stays armed as "press again to exit" (the toast shows 2.2s).
export const EXIT_WINDOW = 2000

// What a back press means, given what is on screen. Pure, so the table below is testable.
export function decideBack({ top, pathname, canGoBack, exitArmed }) {
  if (top) return top.locked ? 'ignore' : 'sheet'   // a locked sheet swallows back on purpose
  // A root tab must not replay older tabs or abandoned detail pages before it can exit.
  const atRoot = pathname === '/' || /^\/(home|plan|stats|library)\/?$/i.test(pathname)
  if (canGoBack && !atRoot) return 'history'
  return exitArmed ? 'exit' : 'arm-exit'
}

export function makeBackHandler({ getSheets, getLocation = () => ({}), closeSheet, toast, goBack, exit, now = Date.now }) {
  let armedAt = -Infinity, armedKey
  return (ev = {}) => {
    const sheets = getSheets()
    const { pathname, key } = getLocation()
    const action = decideBack({
      top: sheets[sheets.length - 1],
      pathname,
      canGoBack: !!ev.canGoBack,
      // A tab switch, even away and back, cancels the warning from the previous entry.
      exitArmed: key === armedKey && now() - armedAt < EXIT_WINDOW,
    })
    if (action !== 'arm-exit') armedAt = -Infinity
    if (action === 'sheet') closeSheet(sheets[sheets.length - 1].id)
    else if (action === 'history') goBack()
    else if (action === 'arm-exit') { armedAt = now(); armedKey = key; toast(t('Press back again to exit')) }
    else if (action === 'exit') exit()
    return action
  }
}

// Registers the listener for the native shell. No-op in web builds, where the browser
// (or the PWA shell) walks history on its own and there is no plugin to talk to.
export async function initBackButton() {
  if (!MOBILE) return () => {}
  try {
    const { App } = await import('@capacitor/app')
    const handler = makeBackHandler({
      getSheets: () => useUI.getState().sheets,
      getLocation: () => ({
        pathname: window.location.hash.slice(1).split('?')[0] || '/',
        key: window.history.state?.key ?? window.location.hash,
      }),
      closeSheet: id => useUI.getState().closeSheet(id),
      toast: msg => useUI.getState().toast(msg),
      goBack: () => window.history.back(),
      exit: () => App.exitApp(),
    })
    const sub = await App.addListener('backButton', handler)
    return () => sub.remove()
  } catch (e) {
    return () => {}   // no plugin (older install): leave back to the default behaviour
  }
}
