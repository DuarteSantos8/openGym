// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api.js'

// main.jsx registers the service worker on https only, so on any other origin there is no
// worker and `navigator.serviceWorker.ready` never settles — the toggle looked usable and hung.
const secureOrigin = () => typeof location === 'undefined' || location.protocol === 'https:'
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && secureOrigin()
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported')

const urlBase64ToUint8Array = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}
const bytesToUrlBase64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// One token per browser profile, made up here and never shown: it tells the server which of
// the account's subscriptions belong to this device, so a rest-timer alert goes to the phone
// that started the rest and not to every tab of the account. Nothing identifying in it.
const DEVICE_KEY = 'gym_device'
export function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY)
    if (!id) {
      id = (crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('')).replace(/-/g, '')
      localStorage.setItem(DEVICE_KEY, id)
    }
    return id
  } catch { return undefined }
}

// The worker is registered at boot; on https it is there within a moment, but a promise that
// never settles must not hang a settings screen or the boot path — give it a bounded wait.
const readyWorker = (ms = 8000) => Promise.race([
  navigator.serviceWorker.ready,
  new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker not ready')), ms))
])

const register = sub => api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON(), deviceId: deviceId() }) })

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications permission was not granted')
  const reg = await readyWorker()
  const { key } = await api('/api/push/public-key')
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  await register(subscription)
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await readyWorker()
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
}

/* Brings the server's copy of this browser's subscription back in line with the browser's.
   Called once per signed-in boot and when Settings opens. The browser keeps its subscription
   through anything that happens on the server — a row pruned after a dead send, a rebuilt
   db.json, a regenerated VAPID key — and the toggle used to read "on" from the browser's side
   while nothing was ever going to arrive. Resolves to whether the server now holds it:
   - no permission or no subscription here → false, nothing to do;
   - the server already has this endpoint → true, no write;
   - the server lost it → re-registered, true;
   - the server's key changed → the old subscription is useless; unsubscribe, subscribe against
     the new key, register, true.
   Network failures propagate — the caller decides what "unknown" means for it. */
export async function syncPushSubscription() {
  if (!pushSupported() || Notification.permission !== 'granted') return false
  const reg = await readyWorker()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) return false
  const { key } = await api('/api/push/public-key')
  const mine = sub.options?.applicationServerKey
  if (mine && key && bytesToUrlBase64(mine) !== key.replace(/=+$/, '')) {
    await sub.unsubscribe().catch(() => {})
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
    await register(sub)
    return true
  }
  const { subscribed } = await api('/api/push/status?endpoint=' + encodeURIComponent(sub.endpoint))
  if (!subscribed) await register(sub)
  return true
}

export const sendTestPush = () => api('/api/push/test', { method: 'POST', body: '{}' })
