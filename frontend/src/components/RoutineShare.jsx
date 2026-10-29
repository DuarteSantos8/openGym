// "Share with a friend" (v1.4.4): a routine, or a finished workout as one, goes out as a link
// (lib/routine-link.js) through the phone's share sheet, and a link that comes back in opens a
// preview with "Add to my routines". The routine rides in the link's fragment, so no server ever
// sees it; a routine too big for a link goes as a plan file instead.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO, exerciseNameText, exCount } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { exLine } from '../lib/history.js'
import { speedUnitOf } from '../lib/speed.js'
import { nav } from '../lib/nav.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { copyText } from '../lib/clipboard.js'
import { buildPlanBundle } from '../lib/plan-share.js'
import { routineLink, routinePayloadFromUrl, decodePayload, readRoutineBundle, importRoutineLink, FROM_MAX } from '../lib/routine-link.js'
import { Button, Switch } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()
const toast = m => ui().toast(m)

/* ------------------------------- sending ------------------------------- */

const isDismissed = e => e?.name === 'AbortError' || /cancel/i.test(String(e?.message || e?.errorMessage || ''))

// The phone's own share sheet in the app, the browser's where it has one, else the clipboard.
async function shareLink(url, text, title) {
  if (MOBILE) {
    try {
      const { Share } = await import('@capacitor/share')
      await Share.share({ title, text, url, dialogTitle: t('Share with a friend') })
      return
    } catch (e) { if (isDismissed(e)) return }
  } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try { await navigator.share({ title, text, url }); return } catch (e) { if (isDismissed(e)) return }
  }
  toast(await copyText(text + '\n' + url) ? t('Link copied. Paste it to a friend.') : url)
}

// Too long for a link: the routine alone as a plan file, the way the Plan menu exports one.
async function shareAsPlanFile(st, routine) {
  const bundle = buildPlanBundle({ ...st, routines: [routine], week: {}, programmes: {} }, routine.name || '')
  const json = JSON.stringify(bundle, null, 2)
  const name = 'opengym-routine-' + todayISO() + '.json'
  if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } return }
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
}

function ShareRoutine({ routine, close }) {
  const st = useStore(s => s.S)
  const user = useStore(s => s.user)
  const [weights, setWeights] = useState(false)
  const [named, setNamed] = useState(false)
  const [from, setFrom] = useState(user?.name || '')
  const [busy, setBusy] = useState(false)
  const name = routine.name || t('Routine')
  const go = async () => {
    setBusy(true)
    try {
      const link = await routineLink(st, routine, { weights, from: named ? from : '' })
      close()
      if (link.tooLong) {
        toast(t('That one’s too big for a link, so it goes as a plan file.'))
        await shareAsPlanFile(st, routine)
        return
      }
      await shareLink(link.url, t('Here’s my {0} on openGym 💪', name), name)
    } catch {
      setBusy(false)
      toast(t('Couldn’t make a link for this one.'))
    }
  }
  return <>
    <h3>{t('Share with a friend')}</h3>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('A link to “{0}”. Your friend taps it and adds it to their own openGym. The routine rides inside the link, no server in between.', name)}
    </div>
    <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Include my weights')}</div><div className="small dim">{t('Off: just sets, reps and rest. They pick their own weights.')}</div></div>
      <Switch checked={weights} onChange={setWeights} aria-label={t('Include my weights')} />
    </div>
    <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: named ? 'none' : '1px solid var(--sep)', gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Your name')}</div><div className="small dim">{t('So they know who it’s from.')}</div></div>
      <Switch checked={named} onChange={setNamed} aria-label={t('Your name')} />
    </div>
    {named && <input className="input" style={{ margin: '4px 0 12px' }} maxLength={FROM_MAX} value={from}
      placeholder={t('Your name')} aria-label={t('Your name')} onChange={e => setFrom(e.target.value)} />}
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="share" disabled={busy} onClick={go}>{t('Share link')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/** The share sheet for a routine ({ name, ex: [...] }, saved or built from a workout). */
export const shareRoutineSheet = routine => ui().openSheet(close => <ShareRoutine routine={routine} close={close} />)

/* ------------------------------- receiving ------------------------------- */

function RoutinePreview({ parsed, close }) {
  const st = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = parsed.routines[0]
  const custom = new Map((parsed.customEx || []).map(c => [c.id, c]))
  const nameOf = id => exerciseNameText(custom.get(id) || EXIDX[id] || { id, n: id })
  const speedUnit = speedUnitOf(st)
  const add = () => {
    let id
    update(s => { id = importRoutineLink(s, parsed) })
    close()
    toast(t('Added to your routines'))
    if (id) nav('/plan/r/' + id)
  }
  return <>
    <h3>{r.name || t('Shared routine')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {parsed.from ? t('From {0}', parsed.from) + ' · ' : ''}{exCount(r.ex.length)}
    </div>
    <div className="list" style={{ marginBottom: 12 }}>
      {r.ex.map((e, i) => <div key={i} className="item">
        <div className="grow">
          <div className="tt capitalize">{nameOf(e.id)}{e.sg && r.ex[i + 1]?.sg === e.sg ? <Icon name="link" style={{ fontSize: 12, marginInlineStart: 6, opacity: .6 }} /> : null}</div>
          <div className="ss">{exLine(e, parsed.unit, speedUnit)}</div>
        </div>
      </div>)}
    </div>
    {parsed.dropped > 0 && <div className="small" style={{ color: 'var(--yellow)', marginBottom: 12, lineHeight: 1.4 }}>
      {t(parsed.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', parsed.dropped)}
    </div>}
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('Added as a new routine. Nothing you already have is touched.')}</div>
    <Button variant="primary" icon="plus" onClick={add}>{t('Add to my routines')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

const LINK_ERRORS = {
  'too-new': () => t('This link is from a newer openGym. Update the app to open it.'),
  'no-inflate': () => t('This browser can’t open this link. Try it in the openGym app.'),
  empty: () => t('Nothing in this routine works here, sorry.'),
}

let lastOpened = { payload: null, at: 0 }

/** Opens the preview for a link's payload (or says why not). Resolves true when it opened. */
export async function openRoutinePayload(payload, now = Date.now()) {
  if (!payload) return false
  // The cold-start link can arrive twice (getLaunchUrl and the retained appUrlOpen event).
  if (lastOpened.payload === payload && now - lastOpened.at < 5000) return false
  lastOpened = { payload, at: now }
  try {
    const data = await decodePayload(payload)
    const parsed = readRoutineBundle(data, useStore.getState().S.unit || 'kg')
    ui().openSheet(close => <RoutinePreview parsed={parsed} close={close} />)
    return true
  } catch (e) {
    toast((LINK_ERRORS[e?.code] || (() => t('This routine link is broken or cut off.')))())
    return false
  }
}

// A web app opened at <server>/#/r/<payload> (the website's "Open in the web app"): read before
// the router turns the unknown route into /home, and the address put back on the plan.
const BOOT = (() => {
  try {
    const p = routinePayloadFromUrl(globalThis.location?.href || '')
    if (p && /^#\/r\//.test(globalThis.location.hash)) history.replaceState(history.state, '', location.pathname + location.search + '#/plan')
    return p
  } catch { return null }
})()

/**
 * Listens for routine links for the whole app: the one the web app opened with, a later
 * #/r/... in the address bar, and in the phone apps opengym://r#... and https://opengym.ch/r#...
 * One that arrives before the app is set up waits until it is.
 */
export function useRoutineLinks(ready) {
  const readyRef = useRef(ready)
  const pending = useRef(BOOT)
  readyRef.current = ready
  useEffect(() => {
    const got = url => {
      const p = routinePayloadFromUrl(url)
      if (!p) return false
      if (readyRef.current) openRoutinePayload(p)
      else pending.current = p
      return true
    }
    const onHash = () => {
      if (got(location.href)) { try { history.replaceState(history.state, '', location.pathname + location.search + '#/plan') } catch { /* fine */ } }
    }
    window.addEventListener('hashchange', onHash)
    const handles = []
    let gone = false
    if (MOBILE) {
      import('@capacitor/app').then(({ App }) => {
        Promise.resolve(App.addListener('appUrlOpen', e => { if (e?.url) got(String(e.url)) }))
          .then(h => { if (gone) h?.remove?.(); else handles.push(h) }).catch(() => {})
        Promise.resolve(App.getLaunchUrl?.()).then(r => { if (!gone && r?.url) got(String(r.url)) }).catch(() => {})
      }).catch(() => {})
    }
    return () => {
      gone = true
      window.removeEventListener('hashchange', onHash)
      handles.splice(0).forEach(h => { try { h?.remove?.() } catch { /* gone already */ } })
    }
  }, [])
  useEffect(() => {
    if (!ready || !pending.current) return
    const p = pending.current
    pending.current = null
    setTimeout(() => openRoutinePayload(p), 0)
  }, [ready])
}

export function _resetRoutineLinksForTests() { lastOpened = { payload: null, at: 0 } }
