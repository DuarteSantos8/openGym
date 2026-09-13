import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { DAYN, fmtDate, weekOrder } from '../lib/format.js'
import { buildSocialPlanBundle, parsePlan } from '../lib/plan-share.js'
import { exerciseNameFor, t } from '../lib/i18n.js'
import { confirmSheet, menuSheet, planImportSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import ProfileAvatar from '../components/ProfileAvatar.jsx'
import { Button, SearchField } from '../components/ui.jsx'
import { EXIDX } from '../lib/exercises.js'
import { exLine } from '../lib/history.js'
import '../social.css'

function FriendCard({ friend, busy, hasPlan, open, share, remove, block }) {
  const actions = () => menuSheet({
    title: friend.name,
    items: [
      { icon: 'upload', label: t('Share my plan'), disabled: busy || !hasPlan, onClick: () => share(friend) },
      { icon: 'trash', label: t('Remove friend'), danger: true, disabled: busy, onClick: () => remove(friend) },
      { icon: 'lock', label: t('Block'), danger: true, disabled: busy, onClick: () => block(friend) }
    ]
  })
  return <article className="card social-friend">
    <div className="social-friend-head">
      <button className="row social-person social-person-button" onClick={() => open(friend)}>
        <ProfileAvatar name={friend.name} avatar={friend.avatar} size="sm" />
        <div className="grow"><h2>{friend.name}</h2><div className="small muted">{friend.lastWorkout
          ? t('Last workout: {0}', fmtDate(friend.lastWorkout, false, true)) : t('No workouts logged yet')}</div>
          <div className="small social-friend-summary"><Icon name="flame" /> {t('{0} week streak', friend.weekStreak)}
            <span>·</span>{t('{0} this week', friend.thisWeek)}<span>·</span>{t('{0} records', friend.recordCount)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </button>
      <button className="iconbtn social-friend-more" onClick={actions} aria-label={t('Actions for {0}', friend.name)}><Icon name="more" /></button>
    </div>
  </article>
}

function PeopleSheet({ people, request, close, user }) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)
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
    <p className="small muted social-sheet-copy">{t('Choose a registered profile on this server. They decide whether to accept your request.')}</p>
    <FriendPrivacy user={user} />
    {error && <p role="alert" className="social-error">{error}</p>}
    {(people.length > 4 || query) && <SearchField value={query} onChange={event => setQuery(event.target.value)}
      onClear={() => setQuery('')} placeholder={t('Search people…')} aria-label={t('Search people…')} />}
    {shown.length ? <div className="social-people">{shown.map(person => <div className="social-request" key={person.id}>
      <ProfileAvatar name={person.name} size="sm" /><b className="grow">{person.name}</b>
      <Button size="sm" variant="tinted" icon="plus" disabled={busy} onClick={() => choose(person)}>{t('Add')}</Button>
    </div>)}</div> : <div className="social-empty-people"><Icon name="people" />
      <p className="small muted">{query ? t('No registered profile matches your search.')
        : t('Everyone registered on this server is already connected or has a pending request.')}</p></div>}
  </>
}

function FriendPrivacy({ user }) {
  return <div className="small muted social-sheet-copy">
    <p>{t('Accepting shares your training stats, plans and personal records. Body weight follows each person’s privacy choice.')}</p>
    <p>{t('Share body weight with friends')}: <b>{user.shareBodyWeight !== false ? t('On') : t('Off')}</b></p>
  </div>
}

function SharePlanSheet({ friend, state, user, send, close }) {
  const routines = state.routines.filter(r => r.ex?.length)
  const [selected, setSelected] = useState(routines.map(r => r.id))
  const [includeSchedule, setIncludeSchedule] = useState(true)
  const [includeNotes, setIncludeNotes] = useState(false)
  const [preview, setPreview] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const plan = buildSocialPlanBundle(state, t('{0}’s plan', user.name), {
    routineIds: selected, includeSchedule, includeNotes
  })
  const names = new Map(plan.routines.map(r => [r.id, r.name]))
  const share = async () => {
    if (sending.current) return
    sending.current = true
    setBusy(true); setError('')
    try {
      if (await send('plan', { userId: friend.id, plan, includeNotes }, t('Plan shared'), true)) close()
    } catch (e) { setError(e.message) }
    finally { sending.current = false; setBusy(false) }
  }
  return <>
    <h3>{t('Share your plan with {0}?', friend.name)}</h3>
    <p className="small muted">{t('Send a copy of your routines and weekly schedule. Your friend chooses what to import. This replaces any plan you already have waiting in their inbox.')}</p>
    {error && <p role="alert" className="social-error">{error}</p>}
    {!preview ? <>
      {routines.map(r => <label className="social-request" key={r.id}>
        <input type="checkbox" checked={selected.includes(r.id)} onChange={e => setSelected(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} />
        <span>{r.name}</span>
      </label>)}
      <label className="social-request"><input type="checkbox" checked={includeSchedule} onChange={e => setIncludeSchedule(e.target.checked)} /><span>{t('Include weekly schedule')}</span></label>
      <label className="social-request"><input type="checkbox" checked={includeNotes} onChange={e => setIncludeNotes(e.target.checked)} /><span>{t('Include exercise notes')}</span></label>
      <Button variant="primary" disabled={!selected.length} onClick={() => setPreview(true)}>{t('Preview')}</Button>
    </> : <>
      <h4>{t('Preview')}</h4>
      {plan.routines.map(r => <div className="social-sheet-copy" key={r.id}>
        <b>{r.name}</b>
        {r.ex.map((e, index) => <div className="small" key={index}>
          {exerciseNameFor(EXIDX[e.id] || plan.customEx.find(c => c.id === e.id)) || t('Exercise')}
          <div className="muted">{exLine(e, plan.unit)}</div>
          {e.note && <p>{e.note}</p>}
        </div>)}
      </div>)}
      {weekOrder(state.weekStart).filter(day => plan.week[day]?.length).map(day => <p className="small" key={day}>
        {t(DAYN[day])}: {plan.week[day].map(id => names.get(id)).join(' + ')}
      </p>)}
      <Button variant="primary" disabled={busy} onClick={share}>{t('Share plan')}</Button>
      <Button variant="ghost" disabled={busy} onClick={() => setPreview(false)}>{t('Edit')}</Button>
    </>}
    <Button variant="ghost" disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </>
}

export default function Social({ embedded = false }) {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const setSocialCount = useUI(s => s.setSocialCount)
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [revision, setRevision] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const sending = useRef(false)
  useEffect(() => { setData(null); setError('') }, [user?.id])
  const hasPlan = S.routines.some(r => r.ex?.length)

  useEffect(() => {
    if (!user) { setData(null); setSocialCount(0); return }
    const abort = new AbortController()
    setLoading(true)
    api('/api/social', { signal: abort.signal }).then(value => {
      if (abort.signal.aborted) return
      setData(value); setError(''); setSocialCount(value.incoming.length + value.plans.length)
    }).catch(e => {
      if (!abort.signal.aborted && e.name !== 'AbortError') { setError(e.message); if (e.status === 401 || e.status === 403) setData(null) }
    }).finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [user?.id, revision, setSocialCount])

  useEffect(() => {
    if (!user) return
    const refresh = () => { if (!document.hidden) setRevision(n => n + 1) }
    const timer = setInterval(refresh, 60000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [user?.id])

  const send = async (path, body, message, inline = false) => {
    if (sending.current) return false
    sending.current = true
    setBusy(true); setError('')
    try {
      await api('/api/social/' + path, { method: 'POST', body: JSON.stringify(body) })
      if (message) toast(message)
      setRevision(n => n + 1)
      return true
    } catch (e) { if (inline) throw e; setError(e.message); return false }
    finally { sending.current = false; setBusy(false) }
  }
  const request = person => send('request', { userId: person.id }, t('Friend request sent'), true)
  const share = friend => openSheet(close => <SharePlanSheet friend={friend} state={S} user={user} send={send} close={close} />)
  const block = person => confirmSheet({
    title: t('Block {0}?', person.name),
    message: t('Blocking removes your connection and pending plans, and prevents new requests in both directions. Unblocking does not restore the friendship.'),
    confirmText: t('Block'), danger: true,
    onConfirm: () => send('block', { userId: person.id })
  })
  const remove = friend => confirmSheet({
    title: t('Remove {0} as a friend?', friend.name),
    message: t('You will stop seeing each other’s progress. Pending shared plans will be removed; imported routines stay.'),
    confirmText: t('Remove friend'), danger: true,
    onConfirm: () => send('remove', { userId: friend.id }, t('Friend removed'))
  })
  const review = async item => {
    if (sending.current) return
    if (useStore.getState().S.importedSocialPlans?.includes(item.id)) { toast(t('Already imported')); return }
    sending.current = true
    setBusy(true); setError('')
    try {
      const { plan } = await api('/api/social/plan?id=' + encodeURIComponent(item.id))
      planImportSheet(parsePlan(plan), () => {
        api('/api/social/plan/dismiss', { method: 'POST', body: JSON.stringify({ id: item.id }) })
          .then(() => setRevision(n => n + 1))
          .catch(() => toast(t('Plan imported. Dismiss the shared copy from Social when you are back online.')))
      }, item.id)
    } catch (e) { setError(e.message) }
    finally { sending.current = false; setBusy(false) }
  }
  const openPeople = () => openSheet(close => <PeopleSheet people={data?.suggestions || []} request={request} close={close} user={user} />)

  return <div className="social">
    {!embedded && <div className="hdr"><div><h1>{t('Social')}</h1><div className="sub">{t('Keep up with your training friends')}</div></div></div>}
    {!user ? <div className="card social-empty">
      <Icon name="people" /><h2>{t('Train together, wherever you are')}</h2>
      <p className="muted">{t('Sign in or connect to your server in Settings to add friends, see their progress and share plans.')}</p>
      <Button variant="primary" onClick={() => nav('/settings')}>{t('Settings')}</Button>
    </div> : <>
      {error && <div className="card social-error" role="alert">{error}
        <Button size="sm" disabled={loading || busy} onClick={() => setRevision(n => n + 1)}>{t('Try again')}</Button></div>}
      {!data && loading && <p role="status" className="muted">{t('Loading friends…')}</p>}
      {data && <>
        {!!(data.incoming.length || data.outgoing.length) && <div className="card">
          <h2>{t('Friend requests')}</h2>
          {!!data.incoming.length && <FriendPrivacy user={user} />}
          {data.incoming.map(person => <div className="social-request" key={person.id}>
            <ProfileAvatar name={person.name} size="sm" /><b className="grow">{person.name}</b><div className="social-actions">
              <Button size="sm" variant="tinted" disabled={busy} onClick={() => send('accept', { userId: person.id }, t('Friend request accepted'))}>{t('Accept')}</Button>
              <Button size="sm" disabled={busy} onClick={() => send('remove', { userId: person.id })}>{t('Decline')}</Button>
              <Button size="sm" disabled={busy} onClick={() => block(person)}>{t('Block')}</Button>
            </div></div>)}
          {data.outgoing.map(person => <div className="social-request" key={person.id}>
            <ProfileAvatar name={person.name} size="sm" /><div className="grow"><b>{person.name}</b><div className="small muted">{t('Request pending')}</div></div>
            <Button size="sm" disabled={busy} onClick={() => send('remove', { userId: person.id })}>{t('Cancel request')}</Button>
          </div>)}
        </div>}

        {!!data.plans.length && <div className="card">
          <h2>{t('Plans from friends')}</h2>
          {data.plans.map(item => <div className="social-request" key={item.id}>
            <ProfileAvatar name={item.from.name} avatar={item.from.avatar} size="sm" />
            <div className="grow"><b>{item.name || t('Shared plan')}</b>
              <div className="small muted">{t('From {0}', item.from.name)} · {fmtDate(item.created.slice(0, 10))}</div></div>
            <div className="social-actions">
              <Button size="sm" variant="tinted" disabled={busy || S.importedSocialPlans?.includes(item.id)} onClick={() => review(item)}>{S.importedSocialPlans?.includes(item.id) ? t('Already imported') : t('Review plan')}</Button>
              <Button size="sm" disabled={busy} onClick={() => send('plan/dismiss', { id: item.id })}>{t('Dismiss')}</Button>
            </div>
          </div>)}
        </div>}

        <div className="social-section-heading">
          <div><h2>{t('Friends')}</h2><p>{t('{0} connected', data.friends.length)}</p></div>
          <div className="row social-heading-actions">
            <button className="iconbtn" disabled={loading || busy} onClick={() => setRevision(n => n + 1)} aria-label={t('Refresh')}><Icon name="reset" /></button>
            <Button size="sm" variant="tinted" icon="plus" disabled={busy} onClick={openPeople}>{t('Add friend')}</Button>
          </div>
        </div>
        {data.friends.length ? <div className="social-grid">{data.friends.map(friend =>
          <FriendCard key={friend.id} friend={friend} busy={busy} hasPlan={hasPlan}
            open={friend => nav('/profile/friends/' + friend.id)} share={share} remove={remove} block={block} />)}</div>
          : <div className="card social-empty social-friends-empty"><Icon name="people" />
            <h2>{t('Your friends will appear here')}</h2>
            <p className="small muted">{t('Add someone from this server, then wait for them to accept your request.')}</p>
            <Button size="sm" variant="tinted" icon="plus" onClick={openPeople}>{t('Add friend')}</Button>
          </div>}
        {!!data.blocks?.length && <div className="card">
          <h2>{t('Blocked profiles')}</h2>
          {data.blocks.map(person => <div className="social-request" key={person.id}>
            <b className="grow">{person.name}</b>
            <Button size="sm" disabled={busy} onClick={() => send('unblock', { userId: person.id })}>{t('Unblock')}</Button>
          </div>)}
        </div>}
      </>}
    </>}
  </div>
}
