import { t } from '../i18n.js'
import { useUI } from '../../store/useUI.js'

// What a failed write tells the person. The input it came from stays where it was.
export function writeErrorText(e) {
  if (e?.code === 'offline' || e?.code === 'timeout') return t('Not saved: no connection. Try again when you are back online.')
  if (e?.status === 401) return t('Not saved: you are signed out. Sign in and try again.')
  return t('Not saved. Try again.')
}

// What a failed read tells the person.
export function loadErrorText(e) {
  if (e?.code === 'offline' || e?.code === 'timeout') return t('The diary did not load: no connection.')
  if (e?.status === 401) return t('The diary did not load: you are signed out.')
  return t('The diary did not load.')
}

/** The toast after a log, with an Undo that takes it back (and says when that fails). */
export function toastLogged(message, undo) {
  useUI.getState().toast(message, {
    action: t('Undo'),
    onAction: () => { undo().catch(e => useUI.getState().toast(writeErrorText(e))) },
  })
}
