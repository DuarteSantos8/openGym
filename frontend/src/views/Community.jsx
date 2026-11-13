// Community (docs/dev/SHARED-LIBRARY-API.md): what people on this server chose to share, one tab per
// kind, with search, New / Popular, a preview and one tap to take a copy. Every card says who
// shared it and when, always. Sharing one of your own things goes through a consent per item.
// Only a signed-in profile on a server with LIBRARY=on sees any of this (lib/shared-api.js
// libraryOn); guests and phones on their own get a friendly line instead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, baseLang } from '../lib/i18n.js'
import { fmtDate, isoOf, exCount } from '../lib/format.js'
import { remoteAuth } from '../lib/api.js'
import {
  libraryOf, libraryOn, listShared, getShared, publishShared, editShared, withdrawShared, importShared, reportShared,
  sharedMediaBlob, libraryConsentWords, REPORT_REASONS, reasonLabel, sharedError,
} from '../lib/shared-api.js'
import { TYPE, browseTypes, ownItems, applyImport, importedRefs, cardLine, bylineOf, hasCopy, newerThanCopy, typeWords } from '../lib/shared-items.js'
import { exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { initialOf } from '../lib/avatar.js'
import { Button, SearchField, Segmented, Check, TextField, TextArea } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import { confirmSheet } from '../sheets.jsx'
import { useRevealActiveChip } from '../lib/use-sheet-keyboard.js'
import { pathBefore } from '../lib/nav.js'
import './Community.css'

const day = ms => fmtDate(isoOf(new Date(ms || 0)))
const serverName = () => {
  const base = remoteAuth()?.base || (typeof location !== 'undefined' ? location.origin : '')
  try { return new URL(base).host } catch { return base || t('this server') }
}

/* ---------------------------------------------------------------- media */

// Object URLs of shared files, kept for the page's life: a list scrolls back and forth, and a
// profile picture repeats on every card that person shared.
const blobs = new Map()
function useSharedFile(hash, size) {
  const [url, setUrl] = useState(() => (hash && blobs.has(hash) ? blobs.get(hash) : null))
  useEffect(() => {
    if (!hash) return
    if (blobs.has(hash)) { setUrl(blobs.get(hash)); return }
    let live = true
    sharedMediaBlob(hash, size).then(b => {
      const u = URL.createObjectURL(b)
      blobs.set(hash, u)
      if (live) setUrl(u)
    }).catch(() => {})
    return () => { live = false }
  }, [hash, size])
  return url
}

// A person's mark: their shared picture, or their initial on a colour of their own.
const TINTS = ['var(--blue)', 'var(--purple)', 'var(--teal)', 'var(--orange)', 'var(--pink)', 'var(--indigo)', 'var(--green)']
const tintOf = name => TINTS[[...String(name || '?')].reduce((n, c) => (n * 31 + c.codePointAt(0)) >>> 0, 7) % TINTS.length]
function Face({ by, size = 22 }) {
  const url = useSharedFile(by?.avatar || null)
  return <span className="com-face" style={{ width: size, height: size, background: url ? 'none' : tintOf(by?.name) }} aria-hidden="true">
    {url ? <img src={url} alt="" /> : initialOf(by?.name || '?')}
  </span>
}
// The byline. Not optional anywhere: who shared it and when.
export function Byline({ item }) {
  return <span className="com-by"><Face by={item.by} /><span>{bylineOf(item, day)}</span></span>
}

function PlayButton({ hash, size }) {
  const url = useSharedFile(hash, size)
  const [on, setOn] = useState(false)
  const audio = useRef(null)
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = e => {
    e.stopPropagation()
    if (!url) return
    if (on) { audio.current?.pause(); setOn(false); return }
    const a = audio.current || (audio.current = new Audio(url))
    a.currentTime = 0
    a.onended = () => setOn(false)
    a.play().then(() => setOn(true)).catch(() => setOn(false))
  }
  return <button type="button" className="com-play" onClick={toggle} disabled={!url} aria-label={on ? t('Stop') : t('Play')} aria-pressed={on}>
    <Icon name={on ? 'pause' : 'play'} />
  </button>
}

function Preview({ item, big = false }) {
  const p = item.payload || {}
  const meta = TYPE[item.type] || {}
  if (item.type === 'sound' && p.m) return <div className="com-pre com-pre-sound"><PlayButton hash={p.m.hash} size={p.m.size} /></div>
  const still = item.type === 'exercise' ? (p.media?.poster || (p.media?.kind !== 'video' ? p.media : null))
    : (item.type === 'photo' || item.type === 'progress' || item.type === 'formvideo') ? (p.media?.[0]?.poster || (p.media?.[0]?.kind !== 'video' ? p.media?.[0] : null)) : null
  if (still) return <div className={'com-pre com-pre-pic' + (big ? ' big' : '')}><Pic hash={still.hash} size={still.size} /></div>
  if (item.type === 'look') {
    const f = p.flame, z = p.freeze
    return <div className="com-pre com-pre-look" style={{ '--look': f?.c || 'var(--orange)' }}>
      {f ? (/^[A-Za-z]/.test(f.v) ? <Icon name={f.v} style={{ color: f.c }} /> : <span className="com-emoji">{f.v}</span>) : null}
      {z ? (/^[A-Za-z]/.test(z.v) ? <Icon name={z.v} style={{ color: z.c }} /> : <span className="com-emoji">{z.v}</span>) : null}
      {!f && !z && <span className="com-swatch" style={{ background: /^#/.test(p.accent || '') ? p.accent : 'var(--acc)' }} />}
    </div>
  }
  return <div className="com-pre" style={{ color: meta.tint }}><Icon name={meta.icon || 'star'} /></div>
}
function Pic({ hash, size }) {
  const url = useSharedFile(hash, size)
  return url ? <img src={url} alt="" loading="lazy" /> : <span className="com-pic-wait" />
}

/* ---------------------------------------------------------------- the screen */

export default function Community() {
  const nav = useNavigate()
  const config = useStore(s => s.config)
  const user = useStore(s => s.user)
  const lib = libraryOf(config)
  const on = libraryOn(config, user)
  const tabs = browseTypes(lib)
  const [type, setType] = useState(() => tabs[0]?.id || 'exercise')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('new')
  const [mine, setMine] = useState(false)
  const [state, setState] = useState({ items: [], next: null, loading: true, error: '' })
  const seq = useRef(0)
  // The chosen kind scrolls into view on a phone, like the body parts in Exercises.
  const tabsRef = useRef(null)
  useRevealActiveChip(tabsRef, type)

  const load = useCallback((more = false) => {
    if (!on) return
    const n = ++seq.current
    setState(s => ({ ...s, loading: true, error: '', ...(more ? {} : { items: [] }) }))
    // Your language and English first, unless you are looking at your own.
    const lang = mine ? '' : [...new Set([baseLang(), 'en'])].join(',')
    listShared({ type, q, sort, lang, mine, cursor: more ? state.next : null })
      .then(r => { if (n === seq.current) setState(s => ({ items: more ? [...s.items, ...r.items] : r.items, next: r.next, loading: false, error: '' })) })
      .catch(e => { if (n === seq.current) setState(s => ({ ...s, loading: false, error: sharedError(e) })) })
  }, [on, type, q, sort, mine, state.next])
  // A beat after typing stops, not on every key.
  useEffect(() => { const tm = setTimeout(() => load(false), q ? 250 : 0); return () => clearTimeout(tm) }, [type, q, sort, mine, on]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!on) {
    return <div className="com">
      <ScreenHeader hard title={t('Community')} />
      <div className="empty com-empty"><div className="ico"><Icon name="globe" /></div>
        <p>{user && !user.guest ? t('This server has no community library.') : t('Sharing works once you are connected to a server.')}</p>
        <Button size="sm" variant="tinted" onClick={() => nav('/settings')}>{t('Settings')}</Button>
      </div>
    </div>
  }

  const meta = TYPE[type] || {}
  const open = item => useUI.getState().openSheet(close => <ItemSheet item={item} close={close} onChanged={() => load(false)} />)
  const share = () => useUI.getState().openSheet(close => <ShareSheet type={type} close={close} onShared={() => { setMine(true); load(false) }} />)

  return <div className="com">
    <ScreenHeader hard className="com-hdr" title={t('Community')} sub={t('Shared by people on {0}. Take a copy, it is yours.', serverName())}
      left={(window.history.state?.idx || 0) > 0 && <button type="button" className="iconbtn com-back" data-back={pathBefore() || '/library'} onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>}
      right={<Button size="sm" variant="tinted" icon="plus" onClick={share}>{t('Share yours')}</Button>} />
    <AvatarShareRow lib={lib} />
    <div className="chips com-tabs" role="tablist" aria-label={t('Kinds')} ref={tabsRef}>
      {tabs.map(x => <button key={x.id} type="button" role="tab" aria-selected={type === x.id} className={'chip nocap ichip' + (type === x.id ? ' on' : '')}
        onClick={() => setType(x.id)}><Icon name={x.icon} />{typeWords()[x.id]?.[0]}</button>)}
    </div>
    <div className="com-tools">
      <SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder={t('Search {0}', (typeWords()[type]?.[0] || '').toLowerCase())} aria-label={t('Search')} />
      <div className="com-sortrow">
        <Segmented className="com-sort" value={sort} onChange={setSort} options={[{ value: 'new', label: t('New') }, { value: 'popular', label: t('Popular') }]} />
        <button type="button" className={'chip nocap' + (mine ? ' on' : '')} aria-pressed={mine} onClick={() => setMine(v => !v)}>{t('Yours')}</button>
      </div>
    </div>
    {state.error && <p className="intg-problem" role="alert">{state.error}</p>}
    <div className="com-list" aria-busy={state.loading}>
      {state.items.map(item => <Card key={item.id} item={item} onOpen={() => open(item)} onChanged={() => load(false)} />)}
    </div>
    {state.loading && !state.items.length && <div className="com-skel" aria-hidden="true"><span /><span /><span /></div>}
    {!state.loading && !state.items.length && !state.error && <div className="empty com-empty">
      <div className="ico" style={{ color: meta.tint }}><Icon name={meta.icon || 'globe'} /></div>
      <p>{q ? t('Nothing matches that. Try fewer words.') : mine ? t('You have not shared any of these yet.') : t('Nothing here yet. Be the first to share something.')}</p>
      {!q && <Button size="sm" variant="tinted" icon="plus" onClick={share}>{t('Share yours')}</Button>}
    </div>}
    {state.next && <><div style={{ height: 10 }} /><Button onClick={() => load(true)} disabled={state.loading}>{t('Show more')}</Button></>}
    <p className="com-foot small dim">{t('Spotted something that does not belong here? Open it and tap Report.')}</p>
  </div>
}

const STATUS = {
  pending: () => t('Waiting for a look'),
  hidden: () => t('Hidden by an admin'),
  withdrawn: () => t('Not shared any more'),
  removed: () => t('Removed by an admin'),
}

function Card({ item, onOpen, onChanged }) {
  const meta = TYPE[item.type] || {}
  const taken = useStore(s => hasCopy(s.S, item))
  const newer = useStore(s => newerThanCopy(s.S, item))
  const line = item.type === 'tip' ? tipLine(item) : cardLine(item)
  return <div className="com-card tap-host">
    <Preview item={item} />
    <button type="button" className="com-main tap-main" aria-haspopup="dialog" onClick={onOpen}>
      <span className="tt">{item.title}</span>
      {line && <span className={'ss' + (item.type === 'exercise' || item.type === 'tip' ? ' capitalize' : '')}>{line}</span>}
      <Byline item={item} />
    </button>
    <div className="com-side">
      {item.mine && item.status !== 'live'
        ? <span className={'tag com-st com-st-' + item.status}>{STATUS[item.status]?.() || item.status}</span>
        : item.mine ? <span className="tag acc">{t('Yours')}</span>
          : newer ? <span className="tag acc">{t('New version')}</span>
          : taken ? <span className="tag"><Icon name="check" />{t('In yours')}</span>
            : meta.take ? <TakeButton item={item} onDone={onChanged} compact /> : null}
      {item.stats?.imports > 0 && <span className="com-count small dim" aria-label={t('Taken {0} times', item.stats.imports)}>{t('{0}× taken', item.stats.imports)}</span>}
    </div>
  </div>
}
function tipLine(item) {
  const ex = item.payload?.exId ? exOr(item.payload.exId) : null
  return ex && !ex.missing ? exerciseNameFor(ex) : item.payload?.exName || ''
}

/* ---------------------------------------------------------------- taking a copy */

async function fetchRefs(res) {
  // The files are in your own folder on the server now; pull them onto this device too.
  try {
    const { fetchToStore } = await import('../lib/media-sync.js')
    await Promise.allSettled(importedRefs(res).map(r => fetchToStore(r.hash, { size: r.size })))
  } catch { /* the media sync fetches them on its own later */ }
}
function useTake(item, onDone) {
  const [busy, setBusy] = useState(false)
  const take = () => {
    const toast = useUI.getState().toast
    setBusy(true)
    importShared(item.id).then(res => {
      let msg = ''
      try { useStore.getState().update(s => { msg = applyImport(s, res) }) }
      catch (e) { setBusy(false); toast(e.message); return }
      fetchRefs(res)
      setBusy(false)
      toast(msg)
      onDone?.()
    }).catch(e => { setBusy(false); toast(sharedError(e)) })
  }
  return [busy, take]
}
function TakeButton({ item, onDone, compact }) {
  const [busy, take] = useTake(item, onDone)
  if (item.type === 'tip') return null
  return <Button size="sm" variant={compact ? 'tinted' : 'primary'} disabled={busy} onClick={e => { e.stopPropagation?.(); take() }}
    aria-label={compact ? t('Take a copy of {0}', item.title) : undefined}>{busy ? t('Taking…') : compact ? t('Get') : t('Take a copy')}</Button>
}

/* ---------------------------------------------------------------- one item */

function ItemSheet({ item: first, close, onChanged }) {
  const [item, setItem] = useState(first)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const meta = TYPE[item.type] || {}
  useEffect(() => { getShared(first.id).then(r => setItem(r.item)).catch(() => {}) }, [first.id])
  const p = item.payload || {}
  const [busy, take] = useTake(item, () => { close(); onChanged?.() })
  const own = item.mine && item.src ? ownItems(S, item.type).find(x => x.src === item.src) : null
  const newer = newerThanCopy(S, item)
  const changed = own && JSON.stringify(own.payload) !== JSON.stringify(p)
  const stop = () => confirmSheet({
    title: t('Stop sharing?'), message: t('People who already took it keep their copy.'), confirmText: t('Stop sharing'),
    onConfirm: () => withdrawShared(item.id).then(() => { toast(t('Not shared any more.')); close(); onChanged?.() }).catch(e => toast(sharedError(e))),
  })
  const update = () => editShared(item.id, item.rev, { payload: own.payload })
    .then(r => { toast(r.status === 'pending' ? t('On its way. An admin will have a quick look.') : t('New version shared.')); setItem(r.item); onChanged?.() })
    .catch(e => toast(sharedError(e)))
  const asNote = () => {
    const toastFn = useUI.getState().toast
    importShared(item.id).then(res => { let msg = ''; useStore.getState().update(s => { msg = applyImport(s, res) }); toastFn(msg); close() })
      .catch(e => toastFn(sharedError(e)))
  }
  return <div className="com-sheet">
    <div className="com-sheet-top">
      <Preview item={item} big />
      <div className="grow">
        <h3>{item.title}</h3>
        <div className="small dim">{typeWords()[item.type]?.[1]}{item.version > 1 ? ' · ' + t('version {0}', item.version) : ''}</div>
      </div>
    </div>
    <Byline item={item} />
    {item.stats?.imports > 0 && <span className="small dim com-taken">{t('Taken {0} times', item.stats.imports)}</span>}
    {item.mine && item.status !== 'live' && <p className={'com-note com-st-' + item.status}>{STATUS[item.status]?.()}</p>}
    {newer && <p className="com-note com-st-pending">{t('{0} shared a new version. Yours stays as it is; take the new one as another copy if you like.', item.by?.name || t('someone who left'))}</p>}
    {item.desc && <p className="com-desc">{item.desc}</p>}
    <Detail item={item} />
    <div className="com-actions">
      {item.mine ? <>
        {changed && item.status !== 'withdrawn' && item.status !== 'removed' && <Button variant="primary" onClick={update}>{t('Share the new version')}</Button>}
        {item.status !== 'withdrawn' && item.status !== 'removed' && <Button onClick={stop}>{t('Stop sharing')}</Button>}
      </> : meta.take ? (item.type === 'tip'
        ? <Button variant="primary" onClick={asNote}>{t('Add to my note')}</Button>
        : <Button variant="primary" disabled={busy} onClick={take}>{busy ? t('Taking…') : t('Take a copy')}</Button>)
        : <p className="small dim">{t('Just to look at. Please do not save other people’s photos.')}</p>}
      {!item.mine && <Button variant="ghost" className="dim" icon="flag" onClick={() => useUI.getState().openSheet(c => <ReportSheet item={item} close={() => { c(); }} />)}>{t('Report')}</Button>}
    </div>
  </div>
}

function Detail({ item }) {
  const p = item.payload || {}
  switch (item.type) {
    case 'plan': {
      const rs = p.bundle?.routines || item.summary?.routines || []
      return <ul className="com-detail">{rs.slice(0, 12).map((r, i) => <li key={i}><Icon name="calendar" /><span className="grow">{r.name || t('Routine')}</span>
        <span className="small dim">{exCount(Array.isArray(r.ex) ? r.ex.length : r.n || 0)}</span></li>)}</ul>
    }
    case 'exercise': {
      const ex = p.ex || {}
      return <>
        {p.media?.kind === 'video' && <SharedVideo m={p.media} />}
        <ul className="com-detail">
          {ex.bp && <li><Icon name="figureStrength" /><span className="grow">{t('Body part')}</span><span className="capitalize">{t(ex.bp)}</span></li>}
          {ex.eq && <li><Icon name="kettlebell" /><span className="grow">{t('Equipment')}</span><span className="capitalize">{t(ex.eq)}</span></li>}
        </ul>
        {ex.desc && <p className="com-desc">{ex.desc}</p>}
      </>
    }
    case 'tip': {
      const ex = p.exId ? exOr(p.exId) : null
      return <blockquote className="com-quote">{p.text}{ex && !ex.missing && <cite className={exerciseNameClass(ex)}>{exerciseNameFor(ex)}</cite>}</blockquote>
    }
    case 'measures':
      return <ul className="com-detail">{(p.fields || []).map((f, i) => <li key={i}><Icon name="ruler" /><span className="grow">{f.name}</span><span className="small dim">{f.unit === 'none' ? '' : f.unit}</span></li>)}</ul>
    case 'equipment': {
      const kit = p.profile?.equipment || []
      return kit.length ? <div className="chips wrap com-kit">{kit.slice(0, 40).map(k => <span key={k} className="tag">{t(k)}</span>)}</div> : null
    }
    case 'photo': case 'progress': case 'formvideo':
      return <div className="com-gallery">{(p.media || []).map(m => m.kind === 'video' ? <SharedVideo key={m.hash} m={m} /> : <div key={m.hash} className="com-gal-pic"><Pic hash={m.hash} size={m.size} /></div>)}</div>
  }
  return null
}
function SharedVideo({ m }) {
  const url = useSharedFile(m.hash, m.size)
  return url ? <video className="com-video" src={url} controls playsInline preload="metadata" /> : <div className="com-video com-pic-wait" />
}

/* ---------------------------------------------------------------- reporting */

function ReportSheet({ item, close }) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useUI(s => s.toast)
  const send = () => {
    setBusy(true)
    reportShared(item.id, reason, note).then(() => { toast(t('Thanks. An admin will take a look.')); close() })
      .catch(e => { setBusy(false); toast(sharedError(e)) })
  }
  return <div className="com-sheet">
    <h3>{t('Something off?')}</h3>
    <p className="small dim">{t('Tell us what is up. Only the admins see it, not {0}.', item.by?.name || t('the person who shared it'))}</p>
    <div className="com-reasons" role="radiogroup" aria-label={t('Reason')}>
      {REPORT_REASONS.map(r => <button key={r} type="button" role="radio" aria-checked={reason === r} className={'chip nocap' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{reasonLabel(r)}</button>)}
    </div>
    <TextArea value={note} maxLength={300} rows={3} placeholder={t('A few words, if you like')} aria-label={t('Note')} onChange={e => setNote(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={!reason || busy} onClick={send}>{t('Send report')}</Button>
    <Button variant="ghost" onClick={close}>{t('Cancel')}</Button>
  </div>
}

/* ---------------------------------------------------------------- sharing your own */

function ShareSheet({ type, close, onShared }) {
  const S = useStore(s => s.S)
  const config = useStore(s => s.config)
  const lib = libraryOf(config)
  const tabs = browseTypes(lib)
  const [kind, setKind] = useState(TYPE[type] ? type : tabs[0]?.id)
  const [shared, setShared] = useState(null)
  useEffect(() => {
    let live = true
    listShared({ type: kind, mine: true }).then(r => { if (live) setShared(r.items) }).catch(() => live && setShared([]))
    return () => { live = false }
  }, [kind])
  const items = useMemo(() => ownItems(S, kind), [S, kind])
  const liveSrc = new Set((shared || []).filter(i => i.status !== 'withdrawn' && i.status !== 'removed').map(i => i.src).filter(Boolean))
  const pick = it => useUI.getState().openSheet(c => <ConsentSheet type={kind} it={it} close={c} done={() => { c(); close(); onShared?.() }} />)
  const meta = TYPE[kind] || {}
  return <div className="com-sheet">
    <h3>{t('Share one of yours')}</h3>
    <p className="small dim">{t('Nothing is shared until you pick it and say yes. You decide for each one.')}</p>
    <div className="chips com-tabs">
      {tabs.map(x => <button key={x.id} type="button" className={'chip nocap ichip' + (kind === x.id ? ' on' : '')} aria-pressed={kind === x.id} onClick={() => setKind(x.id)}><Icon name={x.icon} />{typeWords()[x.id]?.[0]}</button>)}
    </div>
    <div className="com-own">
      {items.map(it => {
        const done = liveSrc.has(it.src)
        return <div key={it.src} className="com-own-row">
          <span className="com-pre sm" style={{ color: meta.tint }}><Icon name={meta.icon} /></span>
          <span className="grow tt">{it.title || (it.exId ? exerciseNameFor(exOr(it.exId)) : typeWords()[kind]?.[1])}</span>
          {done ? <span className="tag acc"><Icon name="check" />{t('Shared')}</span>
            : <Button size="sm" variant="tinted" disabled={shared === null} onClick={() => pick(it)}>{t('Share')}</Button>}
        </div>
      })}
      {!items.length && <p className="small dim com-own-empty">{t('Nothing of yours to share here yet. Things you took from the community are not yours to share again.')}</p>}
    </div>
    <Button variant="ghost" onClick={close}>{t('Done')}</Button>
  </div>
}

// The consent, per item, every time: public to everyone here, and it is yours to share.
function ConsentSheet({ type, it, close, done }) {
  const config = useStore(s => s.config)
  const lib = libraryOf(config)
  const toast = useUI(s => s.toast)
  const personal = TYPE[type]?.personal
  const exName = it.exId ? exerciseNameFor(exOr(it.exId)) : ''
  const defTitle = it.title || (exName ? exName.charAt(0).toUpperCase() + exName.slice(1) : '')
  const [title, setTitle] = useState(defTitle)
  const [desc, setDesc] = useState('')
  const [own, setOwn] = useState(false)
  const [busy, setBusy] = useState(false)
  const consent = lib?.consent
  const words = libraryConsentWords(consent)
  const payload = it.payload.exId && !it.payload.exName ? { ...it.payload, exName: defTitle } : it.payload
  const go = async () => {
    setBusy(true)
    const body = { type, src: it.src, title: title.trim(), desc: desc.trim(), lang: baseLang(), payload, consent: { v: consent.v, hash: consent.hash, own } }
    let tries = 0
    for (;;) {
      try {
        const r = await publishShared(body)
        toast(r.status === 'pending' ? t('On its way. An admin will have a quick look.') : t('Shared. Your gym thanks you.'))
        done()
        return
      } catch (e) {
        // The files are not on the server yet: send what this device owes, then once more.
        if (e?.code === 'media-missing' && tries++ < 1) {
          try { const { syncMedia } = await import('../lib/media-sync.js'); await syncMedia({ force: true }) } catch { /* try anyway */ }
          continue
        }
        setBusy(false)
        toast(e?.code === 'media-missing' ? t('Your files are still on their way to the server. Try again in a minute.') : sharedError(e))
        return
      }
    }
  }
  return <div className="com-sheet com-consent">
    <h3>{t('Share with this server?')}</h3>
    <p className="com-server"><Icon name="globe" />{serverName()}</p>
    <label className="com-field"><span>{t('Title')}</span>
      <TextField value={title} maxLength={60} onChange={e => setTitle(e.target.value)} /></label>
    <label className="com-field"><span>{t('A few words about it')}</span>
      <TextArea value={desc} maxLength={500} rows={3} placeholder={t('What it is, who it is for')} onChange={e => setDesc(e.target.value)} /></label>
    {personal && <p className="com-warn" role="note"><Icon name="shield" />{t('Careful: this is a photo of you. Everyone on this server can see it and could save it with a screenshot. Sure?')}</p>}
    {lib?.review || personal ? <p className="small dim">{t('An admin looks at it before anyone else can see it.')}</p> : null}
    <p className="com-consent-text">{words}</p>
    <label className="com-own-check">
      <Check checked={own} onChange={setOwn} label={t('It is mine to share')} />
      <span>{t('It is mine to share. I made it, recorded it or may pass it on, and it is not an openGym animation.')}</span>
    </label>
    <Button variant="primary" disabled={!own || busy || !title.trim()} onClick={go}>{busy ? t('Sharing…') : t('Share it')}</Button>
    <Button variant="ghost" onClick={close}>{t('Not now')}</Button>
  </div>
}

/* ---------------------------------------------------------------- your picture */

// Your profile picture next to your name on what you share: a switch, with its own consent.
function AvatarShareRow({ lib }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [item, setItem] = useState(undefined)
  const pic = S?.avatar?.m || null
  const can = (lib?.types || []).includes('avatar') && !!pic
  useEffect(() => {
    if (!can) return
    listShared({ type: 'avatar', mine: true }).then(r => setItem(r.items.find(i => i.status === 'live' || i.status === 'pending') || null)).catch(() => setItem(null))
  }, [can, pic?.hash])
  if (!can || item === undefined) return null
  const sharedNow = !!item && item.media?.[0] === pic.hash
  const flip = () => {
    if (item && sharedNow) {
      withdrawShared(item.id).then(() => { setItem(null); toast(t('Your picture is not shown any more.')) }).catch(e => toast(sharedError(e)))
      return
    }
    useUI.getState().openSheet(close => <ConsentSheet type="avatar" it={{ src: 'avatar', title: t('Profile picture'), payload: { m: pic } }} close={close}
      done={() => { close(); listShared({ type: 'avatar', mine: true }).then(r => setItem(r.items.find(i => i.status !== 'withdrawn') || null)).catch(() => {}) }} />)
  }
  return <div className="com-avatar">
    <Face by={{ name: useStore.getState().user?.name, avatar: sharedNow ? pic.hash : null }} size={32} />
    <span className="grow">{t('Show your picture next to your name on things you share?')}</span>
    <Button size="sm" className="com-nowrap" variant={sharedNow ? 'plain' : 'tinted'} onClick={flip}>{sharedNow ? t('Hide it') : t('Show it')}</Button>
  </div>
}


