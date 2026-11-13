// Home's one line about a trainer or gym: the newest thing waiting in Trainer & gym (a note, a
// suggestion, a new connection, a changed sharing), one tap away. A trainer gets a line to their
// dashboard when someone wants to connect. Nothing at all without TRAINERS on and a session.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { getInbox, getOverview, showsDashboard, trainerRoles } from '../lib/trainer-api.js'
import { noticeText } from '../lib/trainer-notice-text.js'
import Icon from './Icon.jsx'

function lineFor(i) {
  const who = i.from?.name || ''
  if (i.kind === 'suggest') return t('{0} has an idea for you', who)
  if (i.kind === 'comment') return t('{0} left you a note', who)
  if (i.kind === 'offer') return t('{0} left {1}', i.names?.[0] || who, i.names?.[1] || '')
  return noticeText(i.notice, i.names || []).title
}

export default function TrainerNotice() {
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const nav = useNavigate()
  const on = !!config?.trainers?.on && !!user
  const [box, setBox] = useState(null)
  const [reqs, setReqs] = useState(0)
  useEffect(() => {
    if (!on) return
    let live = true
    getInbox().then(r => { if (live) setBox(r) }).catch(() => {})
    if (trainerRoles(config).trainer) getOverview().then(r => { if (live) setReqs((r.requests || []).length) }).catch(() => {})
    return () => { live = false }
  }, [on])
  if (!on) return null
  const fresh = (box?.items || []).filter(i => i.status === 'open' && !i.seen)
  if (!fresh.length && !(reqs && showsDashboard(config))) return null
  const go = fresh.length ? () => nav('/settings/trainer') : () => nav('/trainer')
  const text = fresh.length ? lineFor(fresh[0]) + (fresh.length > 1 ? ' ' + t('and {0} more', fresh.length - 1) : '') : t('{0} want to connect with you', reqs)
  return <button className="tr-notice" onClick={go}>
    <span className="tr-inbox-i" style={{ '--tint': fresh.length ? 'var(--indigo)' : 'var(--orange)' }}><Icon name={fresh.length ? 'bell' : 'personCircle'} /></span>
    <span className="tr-notice-t">{text}</span>
    <Icon name="chevronRight" className="tr-row-c" />
  </button>
}
