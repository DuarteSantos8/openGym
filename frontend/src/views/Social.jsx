import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { fmtSec } from '../lib/history.js'
import { buildPlanBundle, parsePlan } from '../lib/plan-share.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { confirmSheet, planImportSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import '../social.css'

function recordValue(record, unit) {
  if (record.metric === 'weight') return `${fmtNum(record.value)} ${unit}`
  if (record.metric === 'sec') return fmtSec(record.value)
  if (record.metric === 'min') return `${fmtNum(record.value)} min`
  return t('{0} reps', fmtNum(record.value))
}

function FriendCard({ friend, busy, hasPlan, share, remove }) {
  return <article className="card social-friend">
    <div className="row social-person">
      <span className="social-avatar"><Icon name="person" /></span>
      <div className="grow"><h2>{friend.name}</h2><div className="small muted">{friend.lastWorkout
        ? t('Last workout: {0}', fmtDate(friend.lastWorkout, false, true)) : t('No workouts logged yet')}</div></div>
    </div>
    <div className="social-metrics">
      <div><span><Icon name="flame" /> {t('Week streak')}</span><b>{friend.weekStreak}</b></div>
      <div><span>{t('Workouts this week')}</span><b>{friend.thisWeek}</b></div>
      <div><span>{t('Total workouts')}</span><b>{friend.workouts}</b></div>
    </div>
    <details className="social-records">
      <summary><Icon name="trophy" /> {t('Personal records')} <span className="dim">{friend.recordCount}</span></summary>
      {friend.records.length ? <ul>{friend.records.map(record => <li key={record.exerciseId}>
        <div className="grow"><b>{record.name || exerciseNameFor(EXIDX[record.exerciseId]) || t('Exercise')}</b>
          <span className="small muted">{fmtDate(record.date, false, true)}</span></div>
        <strong>{recordValue(record, friend.unit)}</strong>
      </li>)}</ul> : <p className="small muted">{t('No personal records yet')}</p>}
      {friend.recordCount > friend.records.length && <p className="small muted">{t('Showing the 12 most recently set personal records.')}</p>}
    </details>
    <div className="social-actions">
      <Button size="sm" variant="tinted" icon="upload" disabled={busy || !hasPlan} onClick={() => share(friend)}>{t('Share my plan')}</Button>
      <Button size="sm" disabled={busy} onClick={() => remove(friend)}>{t('Remove friend')}</Button>
    </div>
  </article>
}

export default function Social() {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [code, setCode] = useState('')
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const ownCode = useRef(null)
  const hasPlan = S.routines.some(r => r.ex?.length)

  useEffect(() => {
    if (!user) { setData(null); return }
    const abort = new AbortController()
    setLoading(true)
    api('/api/social', { signal: abort.signal }).then(value => {
      setData(value); setError('')
    }).catch(e => {
      if (e.name !== 'AbortError') { setData(null); setError(e.message) }
    }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [user?.id, revision])

  useEffect(() => {
    if (!user) return
    const refresh = () => { if (!document.hidden) setRevision(n => n + 1) }
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [user?.id])

  const send = async (path, body, message) => {
    if (busy) return false
    setBusy(true); setError('')
    try {
      await api('/api/social/' + path, { method: 'POST', body: JSON.stringify(body) })
      if (message) toast(message)
      setRevision(n => n + 1)
      return true
    } catch (e) { setError(e.message); return false }
    finally { setBusy(false) }
  }
  const request = async event => {
    event.preventDefault()
    if (await send('request', { code }, t('Friend request sent'))) setCode('')
  }
  const share = friend => confirmSheet({
    title: t('Share your plan with {0}?', friend.name),
    message: t('Send a copy of your routines and weekly schedule. Your friend chooses what to import. This replaces any plan you already have waiting in their inbox.'),
    confirmText: t('Share plan'),
    onConfirm: () => send('plan', { userId: friend.id, plan: buildPlanBundle(S, t('{0}’s plan', user.name)) }, t('Plan shared'))
  })
  const remove = friend => confirmSheet({
    title: t('Remove {0} as a friend?', friend.name),
    message: t('You will stop seeing each other’s progress. Pending shared plans will be removed; imported routines stay.'),
    confirmText: t('Remove friend'), danger: true,
    onConfirm: () => send('remove', { userId: friend.id }, t('Friend removed'))
  })
  const review = async item => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const { plan } = await api('/api/social/plan?id=' + encodeURIComponent(item.id))
      planImportSheet(parsePlan(plan), () => {
        api('/api/social/plan/dismiss', { method: 'POST', body: JSON.stringify({ id: item.id }) })
          .catch(() => toast(t('Plan imported. Dismiss the shared copy from Social when you are back online.')))
      })
    } catch (e) { setError(e.message) }
    finally { setBusy(false) }
  }
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(data.code); toast(t('Friend code copied')) }
    catch { ownCode.current?.select(); toast(t('Select and copy your friend code')) }
  }

  return <div className="social">
    <div className="hdr"><div><h1>{t('Social')}</h1><div className="sub">{t('Keep up with your training friends')}</div></div>
      {user && <Button size="sm" disabled={loading || busy} onClick={() => setRevision(n => n + 1)}>{t('Refresh')}</Button>}
    </div>
    {!user ? <div className="card social-empty">
      <Icon name="people" /><h2>{t('Train together, wherever you are')}</h2>
      <p className="muted">{t('Sign in or connect to your server in Settings to add friends, see their progress and share plans.')}</p>
      <Button variant="primary" onClick={() => nav('/settings')}>{t('Settings')}</Button>
    </div> : <>
      {error && <div className="card social-error" role="alert">{error}</div>}
      {!data && loading && <p role="status" className="muted">{t('Loading friends…')}</p>}
      {data && <>
        <div className="card">
          <h2>{t('Add a friend')}</h2>
          <p className="small muted">{t('Use a friend code from this openGym server. Accepting a request shares your streak, workout counts, last workout date and personal records with each other.')}</p>
          <label className="social-label" htmlFor="own-friend-code">{t('Your friend code')}</label>
          <div className="social-code"><input ref={ownCode} id="own-friend-code" className="field" readOnly value={data.code} onClick={event => event.target.select()} />
            <Button size="sm" onClick={copyCode}>{t('Copy')}</Button></div>
          <form onSubmit={request}>
            <label className="social-label" htmlFor="friend-code">{t('Your friend’s code')}</label>
            <div className="social-code"><input id="friend-code" className="field" value={code} onChange={event => setCode(event.target.value)}
              autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32} placeholder="ABCD-EF12-3456-7890" required />
              <Button type="submit" variant="tinted" disabled={busy || !code.trim()}>{t('Send request')}</Button></div>
          </form>
        </div>
        {!!(data.incoming.length || data.outgoing.length) && <div className="card">
          <h2>{t('Friend requests')}</h2>
          {data.incoming.map(person => <div className="social-request" key={person.id}>
            <b className="grow">{person.name}</b><div className="social-actions">
              <Button size="sm" variant="tinted" disabled={busy} onClick={() => send('accept', { userId: person.id }, t('Friend request accepted'))}>{t('Accept')}</Button>
              <Button size="sm" disabled={busy} onClick={() => send('remove', { userId: person.id })}>{t('Decline')}</Button>
            </div></div>)}
          {data.outgoing.map(person => <div className="social-request" key={person.id}>
            <div className="grow"><b>{person.name}</b><div className="small muted">{t('Request pending')}</div></div>
            <Button size="sm" disabled={busy} onClick={() => send('remove', { userId: person.id })}>{t('Cancel request')}</Button>
          </div>)}
        </div>}
        {!!data.plans.length && <div className="card">
          <h2>{t('Plans from friends')}</h2>
          {data.plans.map(item => <div className="social-request" key={item.id}>
            <div className="grow"><b>{item.name || t('Shared plan')}</b>
              <div className="small muted">{t('From {0}', item.from.name)} · {fmtDate(item.created.slice(0, 10))}</div></div>
            <div className="social-actions">
              <Button size="sm" variant="tinted" disabled={busy} onClick={() => review(item)}>{t('Review plan')}</Button>
              <Button size="sm" disabled={busy} onClick={() => send('plan/dismiss', { id: item.id })}>{t('Dismiss')}</Button>
            </div>
          </div>)}
        </div>}
        <h4 className="sec">{t('Friends')} · {data.friends.length}</h4>
        <p className="small muted social-hint">{t('A streak counts consecutive weeks with a workout, allowing the current week to be unfinished. Records use completed work sets.')}</p>
        {data.friends.length ? <div className="social-grid">{data.friends.map(friend =>
          <FriendCard key={friend.id} friend={friend} busy={busy} hasPlan={hasPlan} share={share} remove={remove} />)}</div>
          : <div className="card social-empty"><Icon name="people" /><h2>{t('Your training circle starts here')}</h2>
            <p className="muted">{t('Exchange codes with a friend. Once your request is accepted, their streak and records will appear here.')}</p></div>}
      </>}
    </>}
  </div>
}
