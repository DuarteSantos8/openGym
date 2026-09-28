// The connection to the server, as the screens show it and act on it: the persistent indicator
// (SyncBanner.jsx), the "Server & sync" block in Settings, and the question a sign-out or a
// disconnect asks when the server has not got everything yet. The store decides the state
// (useStore.js, `sync` — see statusOf there); this file only words it and offers what to do.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtAgo, changeCount } from '../lib/format.js'
import { passkeyLogin, webauthnOK } from '../lib/api.js'
import { MOBILE } from '../lib/mobile.js'
import { syncMedia } from '../lib/media-sync.js'
import { DEMO } from '../lib/demo.js'
import { askAddDeviceData } from '../sheets.jsx'
import { ConnectSheet } from '../views/MobileOnboarding.jsx'
import { passwordOn, openPasswordSignIn } from './PasswordAuth.jsx'
import { Section, Row, Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
// Whether this browser has a way to sign in at all: a passkey, or a password on an instance that
// offers one (#118) — which is also what a browser without passkey support has left.
const pwOn = () => passwordOn(useStore.getState?.()?.config)
const canSignIn = () => webauthnOK() || pwOn()

// "gym.example.com" out of the base URL the store keeps (a subpath stays: it is part of which
// server this is). Anything unparseable is shown as it is.
export const hostOf = base => {
  try { const u = new URL(base); return u.host + u.pathname.replace(/\/$/, '') } catch { return base || '' }
}

// Whether the device says it has a network at all. fetch fails the same way for a phone with no
// network and for a server that is down, or behind a proxy whose error page carries no CORS
// header (the phone app is another origin): only this tells "offline" from "your server".
export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false
// The same, for a screen that has to change its words when the network comes or goes.
export function useOnline() {
  const [online, setOnline] = useState(isOnline)
  useEffect(() => {
    const on = () => setOnline(isOnline())
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])
  return online
}

/* One state of `sync`, in words:
     tone    'ok' | 'wait' | 'off' | 'bad' | 'quiet' — the colour, from fine to deliberate local use
     line    the short status line: Settings, and the toast after "Sync now"
     banner  the sentence the persistent indicator shows, or null when there is nothing to say
     action  what the indicator offers: 'retry' | 'pair' | 'signin' | 'connect' | null
   `mobile` is the build (a phone pairs, a browser signs in); `online` whether the device has a
   network, which decides whether "offline" is the device or the server. Every state that is not
   'ok' says the changes are kept on this device — that is the one thing the person needs to hear
   first. */
export function connectionView(sync, { mobile = MOBILE, online = isOnline() } = {}) {
  if (!sync) return null
  const err = sync.lastError || {}
  // A device that says it has no network is offline whatever the last request found: said the
  // moment it goes, not at the next sync attempt, which may be a poll away. Only the states that
  // claim a working connection give way; a refusal or an error keeps its own words.
  const status = !online && (sync.status === 'ok' || sync.status === 'pending') ? 'offline' : sync.status
  switch (status) {
    case 'ok':
      return { tone: 'ok', icon: 'cloud', line: t('All synced'), banner: null, action: null }
    case 'pending':   // the sentence already says "tap to retry": no second word for it
      return { tone: 'wait', icon: 'reset', line: t('Waiting to sync'), banner: t('Not synced yet — tap to retry.'), action: 'retry', label: null }
    // A sign-in's question about this device's workouts is still open (useStore adoptProfile):
    // nothing syncs until it is answered, and "retry" — Sync now — asks it again.
    case 'held':
      return { tone: 'wait', icon: 'reset', line: t('Waiting for your answer about this device’s workouts'), banner: t('Nothing syncs until you say whether this device’s workouts go into your profile — tap to answer.'), action: 'retry', label: null }
    case 'offline':
      if (online) return {
        tone: 'off', icon: 'cloudSlash', action: 'retry',
        line: err.code === 'timeout' ? t('The server did not answer in time.') : t('The server cannot be reached'),
        banner: sync.pending ? t('Your server cannot be reached — your changes are saved on this device and sync once it answers again.') : t('Your server cannot be reached — showing the last copy synced with it.'),
      }
      return {
        tone: 'off', icon: 'cloudSlash', action: 'retry',
        line: err.code === 'timeout' ? t('The server did not answer in time.') : t('Offline — the server cannot be reached'),
        banner: sync.pending ? t('Offline — your changes are saved on this device and sync when you are back online.') : t('Offline — showing the last copy synced with the server.'),
      }
    case 'error':
      return err.code === 'bad-response'
        ? { tone: 'bad', icon: 'warning', action: 'retry', line: t('Not an openGym answer (HTTP {0})', err.status), banner: t('Your server’s address answered with something other than openGym (HTTP {0}). Your changes are kept here.', err.status) }
        : { tone: 'bad', icon: 'warning', action: 'retry', line: t('Server error (HTTP {0})', err.status), banner: t('Your server answered with an error (HTTP {0}). Your changes are kept here.', err.status) }
    case 'auth':
      if (!mobile) return { tone: 'bad', icon: 'lock', action: 'signin', line: t('The server refuses this browser'), banner: t('Your server no longer accepts this browser. Your changes are kept here.') }
      // A phone an earlier version unpaired kept no address and no token: nothing refuses it,
      // there is simply nothing to ask.
      return err.code === 'not-paired'
        ? { tone: 'bad', icon: 'lock', action: 'pair', line: t('This phone is not connected to a server.'), banner: t('This phone is no longer paired with your server. Your changes are kept here.') }
        : { tone: 'bad', icon: 'lock', action: 'pair', line: t('The server refuses this phone'), banner: t('Your server no longer accepts this phone. Your changes are kept here.') }
    default:   // 'local': no server at all — chosen, so it is said quietly, but it is said
      return mobile
        ? { tone: 'quiet', icon: 'lock', action: 'connect', line: t('On this phone only — not connected to a server'), banner: t('On this phone only — not connected to a server') }
        : { tone: 'quiet', icon: 'lock', action: canSignIn() ? 'signin' : null, line: t('Guest mode — data lives only in this browser.'), banner: t('Guest mode — data lives only in this browser.') }
  }
}

// The word on the indicator's button: the view's own `label` when it has one (null for none),
// else the action's.
export const actionLabel = view => (view.label !== undefined ? view.label : ({ retry: t('Try again'), pair: t('Pair again'), signin: t('Sign in'), connect: t('Connect') })[view.action] || null)

// "Sync now": whatever is waiting goes, the server's copy is checked, and the answer is said.
export async function syncNowWithToast() {
  const sync = await useStore.getState().syncNow()
  const view = connectionView(sync)
  if (view) toast(view.line)
  return sync
}

// A phone whose server refuses it, or that an earlier version unpaired: the connect sheet, with
// the address it had where it still has one. The same account merges what the phone kept.
export function pairAgain() {
  const server = useStore.getState().sync?.server || ''
  ui().openSheet(close => <ConnectSheet close={close} initialUrl={server} again />)
}
export function connectServer() {
  ui().openSheet(close => <ConnectSheet close={close} />)
}

// A browser whose session ended, or a guest: the passkey sign-in, and the same account merges
// what this browser kept (adoptProfile). On an instance with passwords the sign-in sheet comes
// first, with the passkey one tap away on it: which of the two this account has is not
// something this browser can know.
export function signInAgain() {
  if (pwOn()) { openPasswordSignIn(webauthnOK() ? passkeySignIn : undefined); return }
  return passkeySignIn()
}
export async function passkeySignIn() {
  const st = useStore.getState()
  try {
    const u = await passkeyLogin()
    st.setUser(u, { adopt: true })
    await st.adoptProfile(askAddDeviceData)
    toast(t('Welcome back, {0}', u.name))
  } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
}

/* ---------------------------------------------------------- leaving the server ---------------
   Disconnect (phone), Sign out and Sign out everywhere (browser) never wipe changes the server
   has not received (useStore.js). When some are owed, the store refuses and says how many; this
   asks what to do: try again, export a backup, or go ahead anyway — which keeps the changes on
   the device until it reaches this server as this account again. `done(result)` runs once the
   device has actually left. */
const LEAVE = {
  disconnect: { run: (st, o) => st.disconnectServer(o), anyway: () => t('Disconnect anyway') },
  signout: { run: (st, o) => st.signOut(o), anyway: () => t('Sign out anyway') },
  everywhere: { run: (st, o) => st.signOutAll(o), anyway: () => t('Sign out anyway') },
}
async function attempt(kind, opts) {
  try { return await LEAVE[kind].run(useStore.getState(), opts) }
  catch (e) {   // only "sign out everywhere" throws: the other sessions are all still valid
    toast(t('Could not sign out everywhere — you are still signed in.'))
    return null
  }
}
export async function leaveServer(kind, { exportBackup, exportBackupZip, done }) {
  const r = await attempt(kind)
  if (!r) return
  if (r.owed && !r.stashed) {
    ui().openSheet(close => <OwedSheet kind={kind} count={r.count} media={r.media || 0} exportBackup={exportBackup} exportBackupZip={exportBackupZip} done={done} close={close} />, { kind: 'center', locked: true })
    return
  }
  done(r)
}

// `media`: photos or videos of custom exercises the server has not confirmed (useStore
// unsyncedChanges). They are owed like any change, so the sheet names them; while there are any,
// its export writes the backup with them (the plain JSON would leave exactly those out).
export function OwedSheet({ kind, count: count0, media: media0 = 0, exportBackup, exportBackupZip, done, close }) {
  const sync = useStore(s => s.sync)
  const [count, setCount] = useState(count0)
  const [media, setMedia] = useState(media0)
  const [busy, setBusy] = useState(false)
  const [tried, setTried] = useState(false)
  const view = connectionView(sync)
  // Refused because it is paired or signed in to a server that no longer takes it: trying
  // again cannot work, and pairing or signing in again brings the changes to the server.
  const refused = sync?.status === 'auth'
  const finish = r => { close(); done(r) }
  const retry = async () => {
    setBusy(true)
    await useStore.getState().syncNow()
    // Past the refusals too, as the Settings row does: a proxy's limit or the server's caps may
    // have been fixed since, and a file refused for good would otherwise hold this sheet open on
    // every try.
    await syncMedia({ force: true, retryRejected: true })
    const r = await attempt(kind)
    setBusy(false)
    if (!r) return
    if (!r.owed || r.stashed) return finish(r)
    setCount(r.count); setMedia(r.media || 0); setTried(true)
  }
  const anyway = async () => {
    setBusy(true)
    const r = await attempt(kind, { force: true })
    setBusy(false)
    if (!r) return
    if (r.owed && !r.stashed) { toast(t('Could not keep a copy of the changes on this device — nothing was removed.')); return }
    finish(r)
  }
  return <div style={{ textAlign: 'center', padding: '4px 0' }}>
    <h3 style={{ marginBottom: 8 }}>{t('Not everything is on your server yet')}</h3>
    {(count !== 0 || !media) && <div style={{ marginBottom: 6, fontWeight: 600 }}>
      {count > 0 ? t('Not on your server yet: {0}', changeCount(count)) : t('Some changes on this device have not reached your server.')}
    </div>}
    {media > 0 && <div style={{ marginBottom: 6, fontWeight: 600 }}>{t(media === 1 ? '{0} photo or video has not reached your server yet.' : '{0} photos or videos have not reached your server yet.', media)}</div>}
    {(tried || refused) && view && <div className="small" style={{ color: 'var(--red)', marginBottom: 6 }}>{view.line}</div>}
    {/* It names the button below it: Try again, or Pair again / Sign in where the server refuses. */}
    <div className="muted small" style={{ marginBottom: 18, lineHeight: 1.5 }}>
      {refused
        ? (MOBILE
          ? t('Pair again, or export a backup first. Going ahead anyway keeps a copy of these changes on this device until it connects to this server as this account again — then they are added back.')
          : t('Sign in again, or export a backup first. Going ahead anyway keeps a copy of these changes on this device until it connects to this server as this account again — then they are added back.'))
        : t('Try again, or export a backup first. Going ahead anyway keeps a copy of these changes on this device until it connects to this server as this account again — then they are added back.')}
    </div>
    {refused && MOBILE && <><button className="btn primary" disabled={busy} onClick={() => { close(); pairAgain() }}>{t('Pair again')}</button><div style={{ height: 8 }} /></>}
    {refused && !MOBILE && canSignIn() && <><button className="btn primary" disabled={busy} onClick={() => { close(); signInAgain() }}>{pwOn() ? t('Sign in') : t('Sign in with passkey')}</button><div style={{ height: 8 }} /></>}
    {!refused && <><button className="btn primary" disabled={busy} onClick={retry}>{busy ? t('Syncing…') : t('Try again')}</button><div style={{ height: 8 }} /></>}
    {media > 0 && exportBackupZip
      ? <Button icon="download" disabled={busy} onClick={exportBackupZip}>{t('Export with photos & videos (.zip)')}</Button>
      : <Button icon="download" disabled={busy} onClick={exportBackup}>{t('Export backup (JSON)')}</Button>}
    <div style={{ height: 8 }} />
    <button className="btn danger" disabled={busy} onClick={anyway}>{LEAVE[kind].anyway()}</button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </div>
}

/* ---------------------------------------------------------------- Settings ------------------- */
const TINT = { ok: 'var(--green)', wait: 'var(--orange)', off: 'var(--grey)', bad: 'var(--red)', quiet: 'var(--grey)' }

// Settings → "Server & sync", for a device signed in or paired: which server, which account, how
// things stand, since when, what is still waiting, and "Sync now". `children` are the account's
// own rows (the phone's Admin and Disconnect), which belong in the same block.
export function ServerSyncSection({ children }) {
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  useStore(s => s.S)   // the count of waiting changes follows every edit
  useStore(s => s.config)   // whether "Sign in" may offer a password
  const unsynced = useStore(s => s.unsyncedChanges)
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  // "Last synced: 3 minutes ago" goes stale on an open screen; a re-render now and then keeps it true.
  const [, tick] = useState(0)
  useEffect(() => { const iv = setInterval(() => tick(n => n + 1), 30000); return () => clearInterval(iv) }, [])
  if (!user || !sync) return null
  const view = connectionView(sync, { online })
  // While everything is fine, a change still in its short debounce is not news; once anything
  // is wrong, how much is waiting is exactly what the person needs.
  const owed = sync.status !== 'ok' && typeof unsynced === 'function' ? unsynced() : { owed: false }
  const sub = [
    sync.lastSynced ? t('Last synced: {0}', fmtAgo(sync.lastSynced)) : t('Not synced with this server yet'),
    owed.owed && (owed.count > 0 ? t('Not on your server yet: {0}', changeCount(owed.count)) : owed.count == null ? t('Some changes on this device have not reached your server.') : null),
  ].filter(Boolean).join(' · ')
  const now = async () => {
    if (busy) return
    setBusy(true)
    try { await syncNowWithToast() } finally { setBusy(false) }
  }
  return <Section title={t('Server & sync')}>
    {/* No address: a phone an earlier version unpaired. The status row below already says it is
        not connected; this row only says which server, and there is none to name. */}
    <Row icon="globe" iconTint="var(--blue)" title={sync.server ? hostOf(sync.server) : t('Server address unknown')}
      subtitle={t('Signed in as {0}', user.name)} />
    <Row icon={view.icon} iconTint={TINT[view.tone]} title={view.line} subtitle={sub} className="sync-status" />
    <Row icon="reset" iconTint="var(--acc)" title={busy ? t('Syncing…') : t('Sync now')} onClick={now} />
    {sync.status === 'auth' && (MOBILE
      ? <Row icon="link" iconTint="var(--indigo)" title={t('Pair again')} subtitle={t('Your changes are kept here, and merged into your account once it is paired again.')} accessory="chevron" onClick={pairAgain} />
      : canSignIn() && <Row icon="person" iconTint="var(--blue)" title={pwOn() ? t('Sign in') : t('Sign in with passkey')} subtitle={t('Your changes are kept here, and merged into your account once you are signed in again.')} accessory="chevron" onClick={signInAgain} />)}
    {/* another account's, kept when this one signed in over a copy that still owed them */}
    <KeptChangesRows />
    {children}
  </Section>
}

// The changes a forced sign-out or disconnect kept on this device, waiting for their server and
// account — so a device that went ahead anyway still says what it holds and for whom.
export function KeptChangesRows() {
  const kept = useStore(s => s.keptChanges)
  const rev = useStore(s => s.keptRev)
  const user = useStore(s => s.user)
  const [rows, setRows] = useState([])
  // Asked again when the account changes and whenever the kept changes do — the ones handed
  // back on a sign-in go some moments after it.
  useEffect(() => {
    let gone = false
    if (typeof kept === 'function') kept().then(r => { if (!gone) setRows(r || []) }).catch(() => {})
    return () => { gone = true }
  }, [kept, user?.id, rev])
  if (DEMO) return null
  return rows.map(k => <Row key={(k.server || '') + '|' + k.uid} icon="history" iconTint="var(--orange)"
    title={t('Changes kept for {0}', k.name || k.uid)}
    subtitle={(k.server ? hostOf(k.server) + ' · ' : '') + t('Added back when this device connects as that account again.')} />)
}
