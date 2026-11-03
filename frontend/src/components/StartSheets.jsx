import { useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { startFlow } from '../sheets.jsx'
import { t, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exCount, todayISO, DAYN } from '../lib/format.js'
import { setLabel } from '../lib/history.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { buildCombinedEntries, deriveSessionName } from '../lib/session-merge.js'
import { daySessionsStatus } from '../lib/day-sessions.js'
import { exOr } from '../lib/exercises.js'
import { speedUnitOf } from '../lib/speed.js'
import { glyphOf } from '../lib/glyphs.js'
import { Button, Row } from './ui.jsx'
import MiniBodyMap from './MiniBodyMap.jsx'

const ui = () => useUI.getState()
const S = () => useStore.getState().S

// Settings → Workout → "Preview before starting" (#976): a planned session opens on what it
// holds, with Start at its foot, instead of starting on the tap. Off (the default) starts at once,
// the way it always did. Every start of a planned session goes through here.
export function startOrPreview(routineIds) {
  const ids = [].concat(routineIds || [])
  if (S().previewStart === true && ids.length) { previewSheet(ids); return }
  startFlow(ids)
}

/* ---------- the start picker (#930) ---------- */
// Which workout to start, straight from the Start button (a long press, or every tap with
// Settings → Workout → Start button → "Lets you pick"), and from Home's "Choose a different
// workout": today's plan on top, every other routine below it (scheduled on another day or on
// none), and a freestyle session last. One tap starts it, or opens its preview.
function StartPicker({ close }) {
  const st = useStore(s => s.S)
  const today = todayISO()
  const sessions = daySessionsStatus(st, today).filter(x => x.routines.length)
  const planned = new Set(sessions.flatMap(x => x.ids))
  const others = (st.routines || []).filter(r => !planned.has(r.id))
  const go = ids => { close(); startOrPreview(ids) }
  const nameOf = s => deriveSessionName(s.routines.map(r => r.name))
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('What are we training?')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {sessions.length ? t('Today is {0}. Or pick anything else.', sessions.map(nameOf).join(', ')) : t('Rest day, but no one’s stopping you.')}
    </div>
    {sessions.length > 0 && <>
      <h4 className="sec">{t('Today')} · {t(DAYN[new Date(today + 'T12:00:00').getDay()])}</h4>
      <div className="list menu-list start-today" style={{ marginBottom: 14 }}>
        {sessions.map((s, i) => <Row key={s.ids.join('+')} icon={s.done ? 'checkCircle' : glyphOf(s.routines[0].emoji)}
          iconTint={s.done ? 'var(--green)' : 'var(--acc)'} title={nameOf(s)}
          subtitle={s.done ? t('Done today. Again?') : exCount(s.routines.reduce((n, r) => n + (r.ex || []).length, 0))}
          accessory="chevron" className={!s.done && i === sessions.findIndex(x => !x.done) ? 'start-first' : ''}
          onClick={() => go(s.ids)} />)}
      </div>
    </>}
    {others.length > 0 && <>
      <h4 className="sec">{sessions.length ? t('Other routines') : t('Your routines')}</h4>
      <div className="list menu-list" style={{ marginBottom: 14 }}>
        {others.map(r => <Row key={r.id} icon={glyphOf(r.emoji)} title={r.name} subtitle={exCount((r.ex || []).length)}
          accessory="chevron" onClick={() => go([r.id])} />)}
      </div>
    </>}
    <div className="list menu-list" style={{ marginBottom: 14 }}>
      <Row icon="shuffle" title={t('Freestyle workout (pick as you go)')} accessory="chevron" onClick={() => { close(); startFlow([]) }} />
    </div>
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}
export const startPickerSheet = () => ui().openSheet(close => <StartPicker close={close} />)

/* ---------- the preview (#976) ---------- */
// What the session will put on screen, built the way Start builds it (lib/session-merge.js), so
// the weights shown are the ones you will get: each exercise with its work sets, and the warm-ups
// counted. Nothing is started or stored until Start.
function setsLine(entry, speedUnit) {
  const sets = entry.sets || []
  const work = sets.filter(s => !isWarmupRow(s))
  const warm = sets.length - work.length
  const labels = work.map(s => setLabel(entry.id, s, entry.target, speedUnit))
  const same = labels.length > 0 && labels.every(l => l === labels[0])
  const body = !labels.length ? '' : same ? `${labels.length} × ${labels[0]}` : labels.join(', ')
  return [body, warm ? t('warm-ups: {0}', String(warm)) : ''].filter(Boolean).join(' · ')
}

function Preview({ ids, close }) {
  const st = useStore(s => s.S)
  const built = useMemo(() => buildCombinedEntries(st, ids), [st, ids])
  const name = built.routines.length ? deriveSessionName(built.routines.map(r => r.name)) : t('Freestyle')
  const speedUnit = speedUnitOf(st)
  const start = () => { close(); startFlow(built.routineIds) }
  const other = () => { close(); startPickerSheet() }
  return <>
    <div className="row between" style={{ gap: 12, marginBottom: 4 }}>
      <div style={{ minWidth: 0 }}>
        <h3 style={{ marginBottom: 2 }}>{name}</h3>
        <div className="muted small">{exCount(built.entries.length)}</div>
      </div>
      <MiniBodyMap routines={built.routines} body={st.body} />
    </div>
    {built.entries.length
      ? <ol className="list preview-list" style={{ margin: '12px 0 16px' }} aria-label={t('In this workout')}>
        {built.entries.map((e, i) => {
          const ex = exOr(e.id)
          return <li key={e.id + ':' + i} className="lrow">
            <span className="lrow-m">
              <span className={'lrow-t ' + exerciseNameClass(ex)}>{exerciseNameFor(ex)}</span>
              <span className="lrow-s">{setsLine(e, speedUnit) || t('Pick sets as you go')}</span>
            </span>
          </li>
        })}
      </ol>
      : <div className="muted small" style={{ margin: '12px 0 16px' }}>{t('No exercises in it yet. You can add them once it runs.')}</div>}
    <Button variant="primary" icon="play" onClick={start}>{t('Start {0}', name)}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" icon="swap" onClick={other}>{t('Choose a different workout')}</Button>
  </>
}
export const previewSheet = ids => ui().openSheet(close => <Preview ids={[].concat(ids || [])} close={close} />)
