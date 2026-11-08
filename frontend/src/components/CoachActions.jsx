// What the Coach offered to do in a chat answer (api/coach/core/ask-actions.js): each one a card
// that opens a preview, and nothing happens until "yes" there. Routines and plan edits never come
// this way; they arrive as the plan card or the review card with their own Apply and Undo.
// Also: the pages a web-researched answer used, as links under it.
import { t, tn } from '../lib/i18n.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXIDX } from '../lib/exercises.js'
import { confirmSheet, exerciseDetailSheet, customExSheet, startBuiltSession, startFlow, planImportSheet } from '../sheets.jsx'
import { parsePlan } from '../lib/plan-share.js'
import Icon from './Icon.jsx'

const exName = id => (EXIDX[id]?.n) || t('Unknown exercise')
const itemLine = it => `${exName(it.id)} · ${it.sec ? t('{0} × {1} s', it.sets, it.sec) : t('{0} × {1}', it.sets, it.reps)}`
const NOTE_MAX = 600

/** The card's title and icon for one action. */
function look(a, S) {
  switch (a.type) {
    case 'workout': return { icon: 'play', title: t('Start “{0}” now', a.name), sub: tn('{0} exercise', '{0} exercises', a.items.length) }
    case 'start': return { icon: 'play', title: t('Start “{0}” now', (S.routines || []).find(r => r.id === a.routineId)?.name || t('this routine')) }
    case 'note': return { icon: 'note', title: t('Remember this'), sub: a.text }
    case 'exercise': return { icon: 'plusCircle', title: t('Add “{0}” to your exercises', a.name) }
    case 'show': return { icon: 'info', title: exName(a.exId), sub: t('How it’s done') }
    case 'import': return { icon: 'download', title: t('Add “{0}” to my plan', a.title || t('this plan')), sub: t('From the routines library') }
    default: return null
  }
}

/** Opens the preview for `a`; every write goes through a confirm or the app's own form. */
export function runAction(a) {
  const st = useStore.getState()
  const S = st.S
  const toast = useUI.getState().toast
  switch (a.type) {
    case 'workout':
      if (S.active) return toast(t('Finish the current workout first.'))
      return confirmSheet({
        title: t('Start “{0}” now?', a.name),
        message: a.items.map(itemLine).join('\n'),
        confirmText: t('Start'),
        onConfirm: () => startBuiltSession(a.items.map(it => ({ id: it.id, sets: it.sets, mode: it.sec ? 'time' : 'reps', ...(it.sec ? { sec: it.sec } : { reps: it.reps }), weight: it.weight || 0 })), a.name)
      })
    case 'start': {
      const r = (S.routines || []).find(x => x.id === a.routineId)
      if (!r) return toast(t('That routine is gone.'))
      if (S.active) return toast(t('Finish the current workout first.'))
      return confirmSheet({ title: t('Start “{0}” now?', r.name), confirmText: t('Start'), onConfirm: () => startFlow([r.id]) })
    }
    case 'note':
      return confirmSheet({
        title: t('Should the Coach remember this?'),
        message: a.text,
        confirmText: t('Remember'),
        onConfirm: () => {
          st.update(s => {
            if (!s.coach?.profile) return
            const cur = String(s.coach.profile.notes || '').trim()
            s.coach.profile.notes = (cur ? cur + '\n' + a.text : a.text).slice(-NOTE_MAX)
          })
          toast(t('Saved to what the Coach knows about you'))
        }
      })
    case 'exercise':
      return customExSheet(null, () => toast(t('Added to your exercises')), a.name)
    case 'show': {
      const ex = EXIDX[a.exId]
      return ex ? exerciseDetailSheet(ex) : toast(t('Unknown exercise'))
    }
    case 'import':
      return import('../lib/routine-library.js').then(m => m.importBundle(a.libraryId)).then(b => {
        if (!b) return toast(t('That plan isn’t in the library any more.'))
        planImportSheet(parsePlan(b, S.unit || 'kg'))
      }).catch(() => toast(t('That plan isn’t in the library any more.')))
  }
}

export function ActionCards({ actions }) {
  const S = useStore(s => s.S)
  const list = (actions || []).map(a => ({ a, l: look(a, S) })).filter(x => x.l)
  if (!list.length) return null
  return <div className="coach-acts">
    {list.map(({ a, l }, i) => <button key={i} type="button" className="coach-act" onClick={() => runAction(a)}>
      <span className="coach-act-i"><Icon name={l.icon} /></span>
      <span className="coach-act-t"><b>{l.title}</b>{l.sub && <span>{l.sub}</span>}</span>
      <Icon name="chevronRight" className="chev" />
    </button>)}
  </div>
}

const hostOf = u => { try { return new URL(u).host.replace(/^www\./, '') } catch { return '' } }
export function Sources({ list }) {
  const ok = (list || []).filter(s => /^https?:\/\//i.test(s?.url || ''))
  if (!ok.length) return null
  return <div className="coach-src">
    <span>{t('Sources')}</span>
    {ok.map(s => <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer">{s.title || hostOf(s.url)}</a>)}
  </div>
}
