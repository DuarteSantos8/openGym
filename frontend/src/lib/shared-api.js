// The community library of the server this profile is signed in to (docs/dev/SHARED-LIBRARY-API.md):
// browse what people shared, share one of your own after a consent, take a copy, report. Only a
// signed-in profile on a server whose config carries `shared` (LIBRARY=on) ever gets here, so
// guests and phones on their own never call any of it.
import { api, apiBlob } from './api.js'
import { t } from './i18n.js'

const send = (method, path, body, headers) => api(path, { method, body: JSON.stringify(body || {}), ...(headers ? { headers } : {}) })

/** The `shared` block of /api/config, or null: no block means this server has no library. */
export const libraryOf = config => (config?.shared && Array.isArray(config.shared.types) ? config.shared : null)
export const libraryOn = (config, user) => !!user && !user.guest && !!libraryOf(config)

export function listShared({ type, q, sort = 'new', lang, mine, cursor, ex } = {}) {
  const p = new URLSearchParams()
  if (type) p.set('type', type)
  if (ex) p.set('ex', ex)
  if (q && q.trim()) p.set('q', q.trim())
  if (sort) p.set('sort', sort)
  if (lang) p.set('lang', lang)
  if (mine) p.set('mine', '1')
  if (cursor) p.set('cursor', cursor)
  return api('/api/shared?' + p.toString())
}
export const getShared = id => api('/api/shared/' + encodeURIComponent(id))
export const publishShared = body => send('POST', '/api/shared', body)
export const editShared = (id, rev, body) => send('PATCH', '/api/shared/' + encodeURIComponent(id), { ...body, rev }, { 'If-Match': String(rev) })
export const withdrawShared = id => send('DELETE', '/api/shared/' + encodeURIComponent(id))
export const importShared = id => send('POST', '/api/shared/' + encodeURIComponent(id) + '/import')
export const reportShared = (id, reason, note) => send('POST', '/api/shared/' + encodeURIComponent(id) + '/report', { reason, note })
export const sharedMediaBlob = (hash, size) => apiBlob('/api/shared/media/' + hash, { expectSize: size })

// Admin side.
export const adminShared = ({ status, reported, type } = {}) => {
  const p = new URLSearchParams()
  if (status) p.set('status', status)
  if (reported) p.set('reported', '1')
  if (type) p.set('type', type)
  return api('/api/admin/shared?' + p.toString())
}
export const moderateShared = (id, action, reason) => send('POST', '/api/admin/shared/' + encodeURIComponent(id), { action, reason })
export const banSharing = (uid, banned, reason) => send('POST', '/api/admin/users/' + encodeURIComponent(uid) + '/sharing', { banned, reason })

// The canonical consent text of api/consent.js as a t() key, so it reads in the app's language.
// A server with a newer text shows its own words instead.
export const LIBRARY_CONSENT = 'This is public to everyone on this server: everyone with an account here can see it, try it and copy it. Your name and the date go with it, always. Only share what is yours: something you made, recorded or have the right to pass on. The exercise pictures and animations of the built-in library are licensed and can never be shared. You can stop sharing any time; copies people already took stay with them.'
// Written out inside t() so scripts/check-source-strings.mjs finds it; the test holds the two together.
export const libraryConsentWords = consent => (consent && consent.text && consent.text !== LIBRARY_CONSENT ? consent.text : t('This is public to everyone on this server: everyone with an account here can see it, try it and copy it. Your name and the date go with it, always. Only share what is yours: something you made, recorded or have the right to pass on. The exercise pictures and animations of the built-in library are licensed and can never be shared. You can stop sharing any time; copies people already took stay with them.'))

export const REPORT_REASONS = ['spam', 'offensive', 'not-theirs', 'licensed', 'personal', 'other']
export const reasonLabel = r => ({
  spam: t('Spam'), offensive: t('Rude or not okay'), 'not-theirs': t('Not theirs to share'),
  licensed: t('openGym animation or other licensed stuff'), personal: t('Personal data'), other: t('Something else'),
}[r] || r)

/** A refusal from these routes, in the app's words. */
export function sharedError(e) {
  switch (e?.code) {
    case 'sharing-off': return t('This server has no community library.')
    case 'not-found': return t('That one is not in the community any more.')
    case 'banned': return t('Sharing is paused for your account on this server. Questions? Ask the admin.')
    case 'consent-own': return t('Tick that it is yours to share first.')
    case 'consent-outdated': return t('The sharing text changed. Have a quick read and try again.')
    case 'media-blocked': return t('That file can never be shared here. Pictures and animations from the built-in library are licensed.')
    case 'media-metadata': return t('That file still carries hidden details like a location. Add it again in the app and share the new copy.')
    case 'media-webm': return t('Please share this video as an MP4.')
    case 'media-too-large': return t('Too big to share. Up to {0} MB here.', e?.body?.maxMB ?? e?.maxMB ?? '?')
    case 'media-too-long': return t('Too long to share. Sounds go up to {0} s here.', e?.body?.maxSec ?? e?.maxSec ?? 30)
    case 'media-quota': return t('Your space for photos and videos is full.')
    case 'quota': return t('Your space for shared things is full. Stop sharing something first.')
    case 'too-many': return t('You shared as many of these as this server takes.')
    case 'already-reported': return t('You reported this one already. Thanks.')
    case 'own-item': return t('That one is yours.')
    case 'rate-limited': return t('Easy there. Try again in a few minutes.')
    case 'rev-mismatch': return t('It changed in the meantime. Open it again.')
    case 'withdrawn': return t('That is not shared any more.')
    case 'not-paired': return t('This phone is not connected to a server.')
  }
  return e?.message || t('That did not work. Try again in a moment.')
}
