// More than one passkey on a profile, and the one-time code that adds one on another device
// (#95). Settings → Account lists the passkeys and offers both ways to add one; the sign-in screen
// — or the link in the code's QR, opened on the other device — redeems a code. The rules are the
// server's (api/passkeys-store.js, api/device-link.js and the passkeys block in api/server.js):
// what needs proof, the last way in, how long a code lives. This only words them.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { dateLocale } from '../lib/i18n-core.js'
import { api, webauthnOK, createPasskey } from '../lib/api.js'
import { MOBILE } from '../lib/mobile.js'
import { copyText } from '../lib/clipboard.js'
import { deviceLinkUrl, deviceLabel } from '../lib/device-link.js'
import { askAddDeviceData } from '../sheets.jsx'
import { passwordError, notReached, useAgainOnceReached, ProveOwner } from './PasswordAuth.jsx'
import QrCanvas from './QrCanvas.jsx'
import { Row, Button } from './ui.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const errStyle = { color: 'var(--red)', marginTop: 10 }
// A passkey prompt the person closed is their answer, not an error worth a line in red.
const dismissed = e => e?.name === 'NotAllowedError' || e?.name === 'AbortError'
// How long a code lives (api/device-link.js DEVICE_LINK_TTL_MS), for the sentence that says so.
const LINK_MINUTES = 10
// The server keeps a creation challenge five minutes; one older than four is asked for again
// rather than risked on a prompt that then fails.
const CHALLENGE_FRESH_MS = 4 * 60000

// The year only when it is not this one, so "Added … · Last used …" fits on one line.
const when = iso => {
  const d = new Date(iso)
  const year = d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}
  try { return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', ...year }) }
  catch { return '' }
}
const label = (p, i) => p.name || t('Passkey {0}', i + 1)
// "Added 3 Sep 2026 · Last used 22 Sep 2026" — a passkey from before either was recorded has none.
const meta = p => [p.created && t('Added {0}', when(p.created)), p.lastUsed && t('Last used {0}', when(p.lastUsed))].filter(Boolean).join(' · ')

// The server's refusal in the UI language. The proof codes are the password sheet's; the rest
// are this feature's own (api/openapi.yaml, tag passkeys).
export function passkeyError(e) {
  // The authenticator already holds one of this profile's passkeys (excludeCredentials).
  if (e?.name === 'InvalidStateError') return t('This device already has a passkey for this profile.')
  switch (e?.data?.code) {
    case 'last-way-in': return t('It is your only way in, so it cannot be removed until there is another.')
    case 'passkey-limit': return t('This profile already has as many passkeys as it can hold.')
    case 'credential-exists': return t('This passkey already belongs to a profile.')
    case 'link-invalid': return t('That code is wrong, used or expired — make a new one on your other device.')
  }
  return passwordError(e)
}

// GET /api/account/passkeys: { passkeys, password, identity, lastWayIn }, or null until it
// answers — and for as long as the answer is not a list, which is what a server from before #95
// gives, so Settings on such a server simply has no passkey rows.
const listOf = r => (Array.isArray(r?.passkeys) ? r : null)
export function usePasskeys(on) {
  const [st, setSt] = useState(null)
  const [unreached, setUnreached] = useState(false)
  const load = () => api('/api/account/passkeys').then(r => { setSt(listOf(r)); setUnreached(false) }).catch(e => setUnreached(notReached(e)))
  useEffect(() => { if (on) load() }, [on])
  useAgainOnceReached(on && unreached, load)
  return { st, load, set: setSt }
}

// The same read, taken once rather than kept live — what reopenAfterProof (components/Identity.jsx)
// needs to reopen a sheet after a provider round trip; usePasskeys above is for a screen that stays
// mounted and wants the answer kept current.
export const passkeysState = () => api('/api/account/passkeys').then(listOf)

// Reopens the sheet a passkey- or device-link change was pending for while the browser was away
// confirming with the provider — already past its proof step, since the round trip is what proved
// it. Answers false for an act outside this module's own three, or a remembered passkey no longer
// on the list (removed, from another device, while this one was away): there is nothing sensible
// left to reopen either way.
export function resumePasskeyProof(act, draft, { st, changed }) {
  const done = () => changed?.()
  if (act === 'passkey-add') {
    ui().openSheet(c => <AddPasskeySheet state={st} close={c} done={done} initialName={draft?.name} resume />)
    return true
  }
  if (act === 'passkey-remove') {
    const i = st.passkeys.findIndex(p => p.id === draft?.id)
    if (i < 0) return false
    ui().openSheet(c => <RemovePasskeySheet passkey={st.passkeys[i]} title={label(st.passkeys[i], i)} state={st} close={c} done={done} resume />)
    return true
  }
  if (act === 'device-link') {
    ui().openSheet(c => <DeviceLinkSheet close={c} resume />)
    return true
  }
  return false
}

/* ------------------------------------------------------------------- Settings -------------
   Settings → Account: the passkeys, and a code for another device. `changed` tells Settings to
   read the list again, and the password row with it — whether a password may be removed depends
   on how many passkeys there are. */
export function PasskeysRow({ state, changed }) {
  if (!state) return null
  const n = state.passkeys.length
  return <Row icon="lock" iconTint="var(--acc)" title={t('Passkeys')} accessory="chevron"
    subtitle={n === 0 ? t('None yet — add one to sign in without your password.') : n === 1 ? t('1 passkey') : t('{0} passkeys', n)}
    onClick={() => ui().openSheet(close => <PasskeysSheet close={close} changed={changed} />)} />
}

export function DeviceLinkRow({ state }) {
  if (!state) return null
  return <Row icon="qr" iconTint="var(--blue)" title={t('Add another device')} accessory="chevron"
    subtitle={t('A one-time code lets your phone or another computer sign in with a passkey of its own.')}
    onClick={() => ui().openSheet(close => <DeviceLinkSheet close={close} />)} />
}

export function PasskeysSheet({ close, changed }) {
  const { st, set } = usePasskeys(true)
  const done = r => { set(listOf(r) || st); changed?.() }
  if (!st) return <><h3>{t('Passkeys')}</h3><div className="muted small">…</div></>
  const edit = (p, i) => ui().openSheet(c => <PasskeySheet passkey={p} title={label(p, i)} state={st} close={c} done={done} />)
  const add = () => ui().openSheet(c => <AddPasskeySheet state={st} close={c} done={done} />)
  return <>
    <h3>{t('Passkeys')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Each one signs in to this profile from the device or password manager that keeps it. Tap one to rename or remove it.')}
    </div>
    {st.passkeys.length > 0 && <div className="sect-b">
      {st.passkeys.map((p, i) => <Row key={p.id} icon="lock" iconTint="var(--grey)" title={label(p, i)} subtitle={meta(p) || null}
        accessory="chevron" onClick={() => edit(p, i)} />)}
    </div>}
    {st.passkeys.length === 1 && st.lastWayIn && <div className="dim small" style={{ marginTop: 8 }}>
      {t('It is your only way in, so it cannot be removed until there is another.')}</div>}
    <div style={{ height: 14 }} />
    {webauthnOK() ? <><Button variant="primary" icon="plus" onClick={add}>{t('Add a passkey')}</Button><div style={{ height: 8 }} /></>
      // On the phone, webauthnOK() is false for this reason alone - say so with the way that does
      // work instead of leaving the row to look like it simply has nothing more to offer.
      : MOBILE && <div className="dim small" style={{ marginBottom: 8 }}>{t('Add passkeys from a browser, or with a code for another device.')}</div>}
    <Button onClick={close}>{t('Done')}</Button>
  </>
}

// One passkey: its name, and removing it (RemovePasskeySheet).
function PasskeySheet({ passkey, title, state, close, done }) {
  const [name, setName] = useState(passkey.name || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const save = async ev => {
    ev.preventDefault()
    if (busy) return
    setBusy(true); setErr(null)
    try { done(await post('/api/account/passkeys/rename', { id: passkey.id, name })); close() }
    catch (e) { setErr(passkeyError(e)) }
    finally { setBusy(false) }
  }
  const remove = () => ui().openSheet(c => <RemovePasskeySheet passkey={passkey} title={title} state={state} close={c} done={r => { done(r); close() }} />)
  const info = meta(passkey)
  return <>
    <h3>{title}</h3>
    {info && <div className="muted small" style={{ marginBottom: 14 }}>{info}</div>}
    <form onSubmit={save} noValidate>
      <input className="input" placeholder={t('Name, e.g. Work laptop')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
      {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary" disabled={busy}>{t('Save')}</Button>
    </form>
    <div style={{ height: 8 }} />
    {state.lastWayIn
      ? <div className="dim small">{t('It is your only way in, so it cannot be removed until there is another.')}</div>
      : <button type="button" className="btn danger" disabled={busy} onClick={remove}>{t('Remove passkey')}</button>}
  </>
}

/* Removing one asks for the proof adding one does (proveOwner in api/server.js): a copied
   session must not choose which of the owner's passkeys is left. The proof is the confirmation,
   so it is asked on the sheet that says what removing means; any passkey of the profile may give
   it, this one included. Removing does not end a session the passkey opened — sessions are not
   tied to one (api/server.js) — which the sheet says, with the way to do that. */
export function RemovePasskeySheet({ passkey, title, state, close, done, resume = false }) {
  const remove = async proof => {
    const r = await api('/api/account/passkeys?id=' + encodeURIComponent(passkey.id), { method: 'DELETE', body: JSON.stringify(proof) })
    close(); done(r)
    toast(t('Passkey removed'))
  }
  return <>
    <h3>{t('Remove this passkey?')}</h3>
    <div className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{title}</div>
    <div className="muted small" style={{ marginBottom: 6 }}>
      {t('It can no longer sign in to this profile. A device already signed in with it stays signed in — use Sign out everywhere if it was lost.')}
    </div>
    <div className="dim small" style={{ marginBottom: 14 }}>{t('First confirm that it is you.')}</div>
    <ProveOwner passkey password={state.password} identity={!!state.identity?.usable} act="passkey-remove" draft={{ id: passkey.id }} resume={resume} explain={passkeyError} danger submitText={t('Remove')} onProof={remove} />
    <div style={{ height: 8 }} />
    <Button type="button" variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* Adding one from Settings: the proof first, then the passkey prompt — two taps rather than one,
   because each prompt wants a tap of its own (Safari refuses a second prompt opened from the same
   one), and a password, where that is the proof, is typed before either. What it is for: a
   security key, a password manager, a phone through the browser's own QR prompt. Another device
   that can open openGym itself is easier with a code (DeviceLinkSheet). */
export function AddPasskeySheet({ state, close, done, initialName = '', resume = false }) {
  // Blank to start with: what gets added here is rarely this browser (a key, a phone, a manager).
  const [name, setName] = useState(initialName)
  const [ready, setReady] = useState(null)   // { cid, options } once the proof went through
  // A resumed sheet carries one proof made at the provider, spent by the first answer; a retry
  // after the server spent the challenge asks for a fresh proof instead of sending it again.
  const [resumed, setResumed] = useState(resume)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const create = async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const credential = await createPasskey(ready.options)
      done(await post('/api/account/passkeys/verify', { cid: ready.cid, credential, name }))
      close()
      toast(t('Passkey added'))
    } catch (e) {
      if (dismissed(e)) return
      setErr(passkeyError(e))
      // The server spent the challenge on that answer: a retry starts from the proof again.
      if (e?.status) setReady(null)
    } finally { setBusy(false) }
  }
  return <>
    <h3>{t('Add a passkey')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{ready
      ? t('Confirmed. Now create the new passkey — your browser asks where to keep it.')
      : t('For this device, a security key, a password manager, or your phone through the browser’s own QR code. First confirm that it is you.')}</div>
    <input className="input" placeholder={t('Name, e.g. Work laptop')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 12 }} />
    {ready ? <Button variant="primary" icon="plus" disabled={busy} onClick={create}>{t('Create passkey')}</Button>
      : <ProveOwner passkey={state.passkeys.length > 0} password={state.password} identity={!!state.identity?.usable}
        act="passkey-add" draft={{ name }} resume={resumed} explain={passkeyError}
        onProof={async proof => { setResumed(false); setReady(await post('/api/account/passkeys/options', proof)) }} />}
    {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
  </>
}

/* A code for another device: after the same proof, the code itself, a QR code of the link that
   carries it, and a way to copy that link. The other device either scans it or types the code on
   its sign-in screen. When it expires the sheet says so and offers a new one. */
export function DeviceLinkSheet({ close, resume = false }) {
  const { st } = usePasskeys(true)
  const sync = useStore(s => s.sync)
  const [link, setLink] = useState(null)   // { code, expires }
  // The proof a provider round trip left behind is good for the first code only: "Make a new
  // code" asks for a fresh proof instead of sending a spent one again.
  const [resumed, setResumed] = useState(resume)
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    if (!link) return
    setExpired(false)
    const timer = setTimeout(() => setExpired(true), Math.max(0, link.expires - Date.now()))
    return () => clearTimeout(timer)
  }, [link])
  // On the phone the WebView's own origin is Capacitor's local asset server, never a reachable
  // address - the code is only ever worth anything at the paired server itself.
  const url = link ? deviceLinkUrl(link.code, MOBILE ? { origin: sync?.server, pathname: '/' } : window.location) : ''
  const copy = async () => { if (await copyText(url)) toast(t('Copied')) }
  return <>
    <h3>{t('Add another device')}</h3>
    {!st ? <div className="muted small">…</div> : !link ? <>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('You get a code that lets your phone or another computer create a passkey for this profile. First confirm that it is you.')}
      </div>
      <ProveOwner passkey={st.passkeys.length > 0} password={st.password} identity={!!st.identity?.usable}
        act="device-link" resume={resumed} explain={passkeyError}
        onProof={async proof => { setResumed(false); setLink(await post('/api/account/device-link', proof)) }} />
    </> : expired ? <>
      <div className="muted small" style={{ marginBottom: 14 }}>{t('This code has expired.')}</div>
      <Button variant="primary" onClick={() => setLink(null)}>{t('Make a new code')}</Button>
    </> : <>
      <div className="muted small" style={{ marginBottom: 14 }}>
        {t('Scan this with the other device, or open openGym there and enter the code on the sign-in screen. It works once, for {0} minutes.', LINK_MINUTES)}
      </div>
      <div className="ci-qr-plate" style={{ width: 'fit-content', margin: '0 auto 14px' }}><QrCanvas value={url} size={200} /></div>
      {/* Read out or typed character by character: left to right in every language. */}
      <div className="card" dir="ltr" style={{ textAlign: 'center', fontSize: 24, fontWeight: 700, letterSpacing: '.12em', padding: '14px 0' }}>{link.code}</div>
      <div style={{ height: 12 }} />
      <Button icon="link" onClick={copy}>{t('Copy link')}</Button>
    </>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" onClick={close}>{t('Done')}</Button>
  </>
}

/* ------------------------------------------------------------------ the other device -------
   Redeeming a code: the device being added creates a passkey of its own, and that passkey signs it
   in. The code comes from the link's ?link= (the store holds it, see boot()) or is typed. A code
   from a link is checked as the sheet opens, so it can say whose profile this device is joining
   and the passkey prompt then opens straight from the tap. The passkey is named after this
   browser (deviceLabel), which the list in Settings can change. Signed in afterwards like a
   passkey sign-in on the sign-in screen: the same account coming back merges what this device
   kept for it (adoptProfile), and another account's copy is kept aside for that one (setUser).

   A link opens this sheet by itself, and anyone can send one: a code for their own profile would
   sign this browser in to it with a single tap and the passkey prompt, and whatever is logged
   here afterwards would be theirs to read (login CSRF). So unless the code is for the profile
   this browser is already signed in as — told apart by id, since names are not unique and the
   sender chooses theirs — the sheet says which profile this device ends up in and to go on only
   with a code from a device of one's own, and a guest's workouts go into that profile only when
   the guest says so, even into one that has nothing yet (adoptProfile's alwaysAsk). */
export function DeviceLinkRedeemSheet({ close }) {
  const user = useStore(s => s.user)
  const pending = useStore(s => s.linkCode)
  const [code, setCode] = useState(pending || '')
  const [info, setInfo] = useState(null)   // { code, cid, options, id, name, at } from checking the code
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const ref = useRef(null)
  const check = async c => {
    const r = await post('/api/device-link/options', { code: c })
    const i = { ...r, code: c, at: Date.now() }
    setInfo(i)
    return i
  }
  useEffect(() => {
    if (!webauthnOK()) return
    if (pending) check(pending).catch(e => setErr(passkeyError(e)))
    else setTimeout(() => ref.current?.focus(), 250)
  }, [])
  const submit = async ev => {
    ev.preventDefault()
    if (busy) return
    const c = code.trim()
    if (!c) { setErr(t('Enter the code from your other device.')); return }
    setBusy(true); setErr(null)
    let spent = false
    try {
      const i = info && info.code === c && Date.now() - info.at < CHALLENGE_FRESH_MS ? info : await check(c)
      const credential = await createPasskey(i.options)
      spent = true
      const r = await post('/api/device-link/verify', { code: c, cid: i.cid, credential, name: deviceLabel() })
      const st = useStore.getState()
      useStore.setState({ linkCode: null })
      const same = st.user?.id === r.user.id
      // Another profile: its question decides what becomes of this copy, and nothing syncs
      // before it is answered (adoptProfile).
      st.setUser(r.user, same ? undefined : { adopt: { alwaysAsk: true } })
      close()
      if (same) { toast(t('Passkey added')); return }
      // Signed in by now whatever happens next: a pull that fails is the sync banner's to say
      // (adoptProfile records it), not a reason to hide that this device got in.
      await st.adoptProfile(askAddDeviceData, { alwaysAsk: true }).catch(() => {})
      // Not "Welcome back": this may be the first time this person has seen that profile.
      toast(t('Signed in as {0}', r.user.name))
    } catch (e) {
      if (!dismissed(e)) setErr(passkeyError(e))
      // Answered by the server, the challenge is gone; the next try asks for a new one.
      if (spent || e?.status) setInfo(null)
    } finally { setBusy(false) }
  }
  if (!webauthnOK()) return <>
    <h3>{t('Add this device')}</h3>
    <div className="muted small">{t('This browser cannot create passkeys, so it cannot be added with a code. Open the link in a browser that can.')}</div>
    <div style={{ height: 12 }} />
    <Button onClick={close}>{t('Done')}</Button>
  </>
  const joining = info && info.code === code.trim() ? info : null
  const elsewhere = joining && joining.id !== user?.id
  return <>
    <h3>{t('Add this device')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{joining
      ? t('Create a passkey on this device for the profile “{0}”. It signs you in here from now on.', joining.name)
      : t('Enter the code your other device shows under Settings → Add another device. This device then gets a passkey of its own.')}</div>
    {elsewhere && <div className="card small" style={{ textAlign: 'start', marginBottom: 14 }}>
      {user && <div style={{ marginBottom: 8 }}>{user.name === joining.name
        ? t('This code is for a different profile that is also called “{0}”, not the one this browser is signed in as. Adding it there signs yours out here.', joining.name)
        : t('This browser is signed in as “{0}”. Adding it to “{1}” signs “{0}” out here.', user.name, joining.name)}</div>}
      <div>{t('Only continue if this code comes from a device of your own. This browser is then signed in to “{0}”, and what you log here goes to that profile.', joining.name)}</div>
    </div>}
    <form onSubmit={submit} noValidate>
      <input ref={ref} className="input" name="device-code" autoComplete="one-time-code" placeholder={t('Code from your other device')} maxLength={20}
        value={code} onChange={e => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
        dir="ltr" style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      {err && <div className="small" role="alert" style={errStyle}>{err}</div>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary" disabled={busy}>{t('Create passkey')}</Button>
    </form>
  </>
}
export const openDeviceLinkRedeem = () => ui().openSheet(close => <DeviceLinkRedeemSheet close={close} />)
