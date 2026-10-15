import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { Button } from '../components/ui.jsx'

export default function ChatGPTLoginSheet({ close, onDone }) {
  const [attempt, setAttempt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(null)
  const mounted = useRef(true)
  const done = useRef(false)
  const running = a => ['starting', 'pending', 'stopping'].includes(a?.state)
  const cancel = id => api('/api/admin/coach/auth/chatgpt/cancel', { method: 'POST', body: JSON.stringify({ id }) })
  const receive = a => { current.current = a; setAttempt(a) }

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (running(current.current)) cancel(current.current.id).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!running(attempt)) return
    let active = true
    let timer
    const poll = async () => {
      try {
        const a = await api('/api/admin/coach/auth/chatgpt/status')
        if (!active) return
        if (a.id !== attempt.id) throw new Error('This sign-in ended. Start again.')
        receive(a)
        if (a.state === 'connected' && !done.current) {
          done.current = true
          onDone(); close()
        } else if (running(a)) timer = setTimeout(poll, 1500)
      } catch (e) { if (active) { setError(e.message); timer = setTimeout(poll, 3000) } }
    }
    timer = setTimeout(poll, 1000)
    return () => { active = false; clearTimeout(timer) }
  }, [attempt?.id])

  const start = async () => {
    setBusy(true); setError('')
    try {
      const a = await api('/api/admin/coach/auth/chatgpt/device', { method: 'POST', body: '{}' })
      if (!mounted.current) { if (running(a)) await cancel(a.id); return }
      receive(a)
    } catch (e) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setBusy(false) }
  }
  const stop = async () => {
    setBusy(true)
    try { if (running(current.current)) await cancel(current.current.id); close() }
    catch (e) { setError(e.message); setBusy(false) }
  }
  const pending = running(attempt)
  return <>
    <h3>Sign in with ChatGPT</h3>
    <p className="muted small">Use only your own ChatGPT account on a server you trust. Enable device-code login in ChatGPT security settings first. Codex keeps a refreshable login on this server, separate from your workout backups.</p>
    <p className="muted small">Complete the authorization on OpenAI’s website using this browser or another device. No ChatGPT password or API key is entered here. Coach requests use your Codex allowance; signing in does not test a model response.</p>
    {attempt?.verificationUrl && attempt?.userCode ? <div className="adm-result">
      <a href={attempt.verificationUrl} target="_blank" rel="noopener noreferrer">Open OpenAI sign-in</a>
      <p>Enter this one-time code: <strong style={{ userSelect: 'all' }}>{attempt.userCode}</strong></p>
      <span>Waiting for authorization…</span>
    </div> : pending ? <p role="status">Starting Codex sign-in…</p> : null}
    {(error || attempt?.error) && <p role="alert">{error || attempt.error}</p>}
    <div className="adm-actions">
      {!pending && <Button variant="primary" disabled={busy} onClick={start}>Start device sign-in</Button>}
      <Button disabled={busy} onClick={stop}>{pending ? 'Cancel sign-in' : 'Close'}</Button>
    </div>
  </>
}
