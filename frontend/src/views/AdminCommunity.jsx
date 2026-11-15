// Admin → Community (library design 6.2): what was reported, what waits for a look (SHARE_REVIEW),
// and everything shared. Approve, hide, restore, remove, and pause sharing for a person, each with
// a short reason that lands in the activity log. English only, like the rest of the admin page.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate, isoOf } from '../lib/format.js'
import { libraryOf, adminShared, moderateShared, banSharing } from '../lib/shared-api.js'
import { TYPE } from '../lib/shared-items.js'
import { Button } from '../components/ui.jsx'

const day = ms => fmtDate(isoOf(new Date(ms || 0)))
const REASON = { spam: 'spam', offensive: 'rude or not okay', 'not-theirs': 'not theirs', licensed: 'licensed material', personal: 'personal data', other: 'other' }
const VERB = { approve: 'Approve', hide: 'Hide', restore: 'Restore', remove: 'Remove for good' }

export default function AdminCommunity({ tick }) {
  const config = useStore(s => s.config)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [tab, setTab] = useState('reported')
  const [d, setD] = useState(null)
  const on = !!libraryOf(config)
  const load = () => adminShared(tab === 'reported' ? { reported: true } : tab === 'pending' ? { status: 'pending' } : {})
    .then(setD).catch(e => toast(e.message))
  useEffect(() => { if (on) load() }, [tab, tick, on]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!on) return null
  const act = (item, action) => openSheet(close => <ReasonSheet title={`${VERB[action]} “${item.title}”?`}
    lead={action === 'remove'
      ? 'Final. The files leave the shared folder and the folders of the ' + item.importers + ' people who took a copy, and can never be shared again. Text copies (a routine, a tip) stay with them.'
      : action === 'hide' ? 'Nobody new can see or take it. Copies people took stay theirs. You can restore it later.' : 'Everyone on the server can see and take it again.'}
    danger={action === 'remove' || action === 'hide'} confirm={VERB[action]}
    onDone={reason => moderateShared(item.id, action, reason).then(r => { toast(action === 'remove' ? `Removed, ${r.copiesRemoved || 0} copies too` : 'Done'); close(); load() }).catch(e => toast(e.message))}
    close={close} />)
  const ban = item => openSheet(close => <ReasonSheet title={(item.owner.banned ? 'Let ' : 'Pause sharing for ') + item.owner.name + (item.owner.banned ? ' share again?' : '?')}
    lead={item.owner.banned ? 'What the pause hid comes back. What you hid for another reason stays hidden.' : 'They cannot share or edit anything, and what they shared steps out of sight until you let them again.'}
    danger={!item.owner.banned} confirm={item.owner.banned ? 'Let them share' : 'Pause sharing'} optional={item.owner.banned}
    onDone={reason => banSharing(item.owner.id, !item.owner.banned, reason).then(r => { toast(`${r.items} item(s) changed`); close(); load() }).catch(e => toast(e.message))}
    close={close} />)
  const counts = d?.counts || {}
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Community</h2>
      {counts.reported > 0 && <span className="adm-pill bad">{counts.reported} reported</span>}</div>
    <div className="adm-lead">What people chose to share with everyone here. Three reports from different people, or one about licensed material, take an item out of sight until you decide.{d?.review ? ' SHARE_REVIEW is on: new items wait for your approval.' : ''}</div>
    <div className="row" style={{ gap: 6, margin: '4px 0 8px', flexWrap: 'wrap' }}>
      {[['reported', 'Reported'], ['pending', `Waiting${counts.pending ? ' (' + counts.pending + ')' : ''}`], ['all', 'All']].map(([k, l]) =>
        <button key={k} className={'chip nocap' + (tab === k ? ' on' : '')} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
    </div>
    {d && !d.items.length && <div className="adm-empty">{tab === 'reported' ? 'No reports. Quiet in here.' : tab === 'pending' ? 'Nothing waiting.' : 'Nobody shared anything yet.'}</div>}
    {(d?.items || []).map(it => <div key={it.id} style={{ padding: '10px 0', borderBottom: 'var(--hair) solid var(--sep)', opacity: it.status === 'removed' || it.status === 'withdrawn' ? 0.55 : 1 }}>
      <div className="row between" style={{ gap: 8 }}>
        <div className="small" style={{ fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }}>{it.title}</div>
        <span className={'adm-pill' + (it.status === 'live' ? ' acc' : it.status === 'pending' || it.status === 'hidden' ? ' bad' : '')}>{it.status}</span></div>
      <div className="dim" style={{ fontSize: 'var(--fs-caption2)' }}>{(TYPE[it.type]?.one || it.type).toLowerCase()} by {it.owner.name || 'a deleted profile'}{it.owner.banned ? ' (paused)' : ''}, {day(it.createdAt)}, {it.importers} took a copy{it.mod ? `, last: ${it.mod.action} by ${it.mod.by || 'auto'} (${it.mod.reason || ''})` : ''}</div>
      {it.desc && <div className="small" style={{ margin: '4px 0', whiteSpace: 'pre-line' }}>{it.desc}</div>}
      {it.reports.length > 0 && <ul className="small" style={{ margin: '4px 0', paddingInlineStart: 18 }}>
        {it.reports.map((r, i) => <li key={i}><b>{REASON[r.reason] || r.reason}</b> from {r.by || 'a deleted profile'}, {day(r.at)}{r.note ? ': ' + r.note : ''}</li>)}</ul>}
      {it.status !== 'removed' && <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        {it.status === 'pending' && <button className="btn xs" onClick={() => act(it, 'approve')}>Approve</button>}
        {it.status === 'live' && <button className="btn xs" onClick={() => act(it, 'hide')}>Hide</button>}
        {it.status === 'hidden' && <button className="btn xs" onClick={() => act(it, 'restore')}>Restore</button>}
        <button className="btn xs" style={{ color: 'var(--red)' }} onClick={() => act(it, 'remove')}>Remove</button>
        {it.owner.id && <button className="btn xs" onClick={() => ban(it)}>{it.owner.banned ? 'Let them share' : 'Pause their sharing'}</button>}
      </div>}
    </div>)}
  </div>
}

function ReasonSheet({ title, lead, confirm, danger, optional, onDone, close }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = optional || reason.trim().length > 0
  return <>
    <h3>{title}</h3>
    <div className="adm-lead">{lead}</div>
    <input className="field" placeholder="A short reason, for the activity log" value={reason} maxLength={200} onChange={e => setReason(e.target.value)} aria-label="reason" />
    <div style={{ height: 12 }} />
    <Button variant={danger ? 'danger' : 'primary'} disabled={!ok || busy} onClick={() => { setBusy(true); onDone(reason.trim()) }}>{confirm}</Button>
    <Button variant="ghost" onClick={close}>Cancel</Button>
  </>
}
