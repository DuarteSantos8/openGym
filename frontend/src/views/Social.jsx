import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useVisibleRefresh } from '../lib/use-visible-refresh.js'
import { api } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, SearchField } from '../components/ui.jsx'
import '../social.css'

const PRIVACY = 'Only accepted friends can see your training summary. Plans, notes and body weight stay private.'
const initials = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase()
function Person({ name }) {
  return <><span className="social-avatar" aria-hidden="true">{initials(name)}</span><b className="grow">{name}</b></>
}

function PeopleSheet({ people, request, close }) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const sending = useRef(false)
  const shown = people.filter(person => person.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const choose = async person => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setError('')
    try { if (await request(person)) close() }
    catch (e) { setError(e.message) }
    finally { sending.current = false; setBusy(false) }
  }
  return <>
    <h3>{t('Add friend')}</h3>
    <p className="small muted">{t('Choose a registered profile on this server. They decide whether to accept your request.')}</p>
    <p className="small muted">{t(PRIVACY)}</p>
    {error && <p role="alert" className="social-error">{error}</p>}
    {!!people.length && <SearchField value={query} onChange={event => setQuery(event.target.value)}
      onClear={() => setQuery('')} placeholder={t('Search people…')} aria-label={t('Search people…')} />}
    {shown.length ? <div className="social-people">{shown.map(person => <div className="social-request" key={person.id}>
      <Person name={person.name} /><Button size="sm" variant="tinted" icon="plus" disabled={busy} onClick={() => choose(person)}>{t('Add')}</Button>
    </div>)}</div> : <p className="small muted">{query ? t('No registered profile matches your search.')
      : t('Everyone registered on this server is already connected or has a pending request.')}</p>}
    <Button variant="ghost" disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </>
}

export default function Social() {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [revision, refresh] = useVisibleRefresh(user?.id)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const sending = useRef(false)
  useEffect(() => { setData(null); setError('') }, [user?.id])
  useEffect(() => {
    if (!user) return
    const abort = new AbortController()
    setLoading(true)
    api('/api/social', { signal: abort.signal }).then(value => {
      if (!abort.signal.aborted) { setData(value); setError('') }
    }).catch(e => {
      if (!abort.signal.aborted && e.name !== 'AbortError') {
        setError(e.message)
        if (e.status === 401 || e.status === 403) setData(null)
      }
    }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [user?.id, revision])

  const send = async (path, person, message, inline = false) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true); setError('')
    try {
      await api('/api/social/' + path, { method: 'POST', body: JSON.stringify({ userId: person.id }) })
      if (message) toast(message)
      refresh()
      return true
    } catch (e) { if (inline) throw e; setError(e.message); return false }
    finally { sending.current = false; setBusy(false) }
  }
  const openPeople = () => openSheet(close => <PeopleSheet people={data?.suggestions || []}
    request={person => send('request', person, t('Friend request sent'), true)} close={close} />)
  const remove = friend => confirmSheet({
    title: t('Remove {0} as a friend?', friend.name), message: t(PRIVACY),
    confirmText: t('Remove friend'), danger: true,
    onConfirm: () => send('remove', friend, t('Friend removed'))
  })
  const block = person => confirmSheet({
    title: t('Block {0}?', person.name),
    message: t('Blocking removes your connection and prevents new requests in both directions. Unblocking does not restore the friendship.'),
    confirmText: t('Block'), danger: true, onConfirm: () => send('block', person)
  })

  if (!user) return <div className="card social-empty">
    <Icon name="personCircle" /><h2>{t('Train together, wherever you are')}</h2>
    <p className="muted">{t('Sign in or connect to your server in Settings to add friends and see their progress.')}</p>
    <Button variant="primary" onClick={() => nav('/settings')}>{t('Settings')}</Button>
  </div>
  return <div className="social">
    <p className="small muted social-privacy"><Icon name="lock" />{t(PRIVACY)}</p>
    {error && <div className="card social-error" role="alert">{error}
      <Button size="sm" disabled={loading || busy} onClick={refresh}>{t('Try again')}</Button></div>}
    {!data && loading && <p role="status" className="muted">{t('Loading friends…')}</p>}
    {data && <>
      {!!data.incoming.length && <section className="card">
        <h2>{t('Friend requests')} · {data.incoming.length}</h2>
        {data.incoming.map(person => <div className="social-request" key={person.id}>
          <Person name={person.name} /><div className="social-actions">
            <Button size="sm" variant="tinted" disabled={busy} onClick={() => send('accept', person, t('Friend request accepted'))}>{t('Accept')}</Button>
            <Button size="sm" disabled={busy} onClick={() => send('remove', person)}>{t('Decline')}</Button>
            <Button size="sm" disabled={busy} onClick={() => block(person)}>{t('Block')}</Button>
          </div>
        </div>)}
      </section>}
      <div className="social-section-heading">
        <div><h2>{t('Friends')}</h2><p>{t('{0} connected', data.friends.length)}</p></div>
        <div className="row social-heading-actions">
          <button className="iconbtn" disabled={loading || busy} onClick={refresh} aria-label={t('Refresh')}><Icon name="reset" /></button>
          <Button size="sm" variant="tinted" icon="plus" disabled={busy || loading} onClick={openPeople}>{t('Add friend')}</Button>
        </div>
      </div>
      {data.friends.length ? <div className="social-grid">{data.friends.map(friend => <article className="card social-friend" key={friend.id}>
        <div className="social-friend-head"><Person name={friend.name} />
          <button className="iconbtn" disabled={busy} aria-label={t('Actions for {0}', friend.name)} onClick={() => menuSheet({ title: friend.name, items: [
            { icon: 'trash', label: t('Remove friend'), danger: true, onClick: () => remove(friend) },
            { icon: 'lock', label: t('Block'), danger: true, onClick: () => block(friend) }
          ] })}><Icon name="more" /></button>
        </div>
        <p className="small muted">{friend.lastWorkout ? t('Last workout: {0}', fmtDate(friend.lastWorkout, false, true)) : t('No workouts logged yet')}</p>
        <dl className="social-friend-metrics">
          <div><dt>{t('This week')}</dt><dd>{friend.thisWeek}</dd></div>
          <div><dt>{t('Week streak')}</dt><dd><Icon name="flame" />{friend.weekStreak}</dd></div>
          <div><dt>{t('Personal records')}</dt><dd>{friend.recordCount}</dd></div>
        </dl>
      </article>)}</div> : <div className="card social-empty">
        <Icon name="personCircle" /><h2>{data.outgoing.length ? t('Waiting for your friends to accept') : t('Your friends will appear here')}</h2>
        <p className="small muted">{t('Add someone from this server, then wait for them to accept your request.')}</p>
        <Button size="sm" variant="tinted" icon="plus" onClick={openPeople}>{t('Add friend')}</Button>
      </div>}
      {!!data.outgoing.length && <section className="card">
        <h2>{t('Sent requests')} · {data.outgoing.length}</h2>
        {data.outgoing.map(person => <div className="social-request" key={person.id}>
          <Person name={person.name} /><span className="small muted">{t('Request pending')}</span>
          <Button size="sm" disabled={busy} onClick={() => send('remove', person)}>{t('Cancel request')}</Button>
        </div>)}
      </section>}
      {!!data.blocks.length && <section className="card">
        <h2>{t('Blocked profiles')}</h2>
        {data.blocks.map(person => <div className="social-request" key={person.id}>
          <Person name={person.name} /><Button size="sm" disabled={busy} onClick={() => send('unblock', person)}>{t('Unblock')}</Button>
        </div>)}
      </section>}
    </>}
  </div>
}
