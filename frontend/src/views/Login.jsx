import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, BIO } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { useState, useRef, useEffect } from 'react'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState } = useStore()
  const [name, setName] = useState('')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast('Enter a name'); return }
    try {
      const u = await passkeyRegister(n)
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast('Profile created — data from this device moved into it ✓') }
      else { await pullState(); useUI.getState().toast('Welcome, ' + u.name + ' 💪') }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || 'Registration failed') }
  }
  return <>
    <h3>Create your profile ✨</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>Pick a name, then confirm with {BIO}. The passkey is saved in your device — no password needed.</div>
    <input ref={ref} className="input" placeholder="Your name" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div style={{ height: 12 }} />
    <button className="btn primary" onClick={go}>Create passkey</button>
  </>
}

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast('Welcome back, ' + u.name + ' 💪') }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || 'Sign-in failed') }
  }
  return (
    <div className="narrow" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }}>
      <div style={{ fontSize: '4rem' }}>🏋️</div>
      <h1 style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-.02em', margin: '8px 0 4px' }}>openGym</h1>
      <div className="muted" style={{ marginBottom: 34 }}>Your workouts. Your weights. Your profile.</div>
      {webauthnOK() ? <>
        <button className="btn primary" onClick={signIn}>👤 Sign in with passkey</button>
        <div style={{ height: 10 }} />
        <button className="btn" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>✨ Create new profile</button>
        <div style={{ height: 10 }} />
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>This browser doesn't support passkeys — you can still use openGym locally on this device.</div>}
      <button className="btn ghost dim" onClick={() => setGuest(true)}>Continue without account</button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>Passkeys use {BIO} — no passwords.<br />Each profile keeps its own plan, workouts & body weight.</div>
    </div>
  )
}
