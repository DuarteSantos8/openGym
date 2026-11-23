import { favRoutinesFirst, isFavRoutine } from '../lib/routine-favs.js'
import { activeRoutines } from '../lib/routine-folders.js'
import Icon from './Icon.jsx'
import { useMemo } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { startFlow, menuSheet } from '../sheets.jsx'
import { t, tn, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exCount, todayISO, DAYN, fmtDaysAgo } from '../lib/format.js'
import { setLabel } from '../lib/history.js'
import { isWarmupRow } from '../lib/workout-model.js'
import { buildCombinedEntries, deriveSessionName } from '../lib/session-merge.js'
import { daySessionsStatus } from '../lib/day-sessions.js'
import { exOr } from '../lib/exercises.js'
import { speedUnitOf } from '../lib/speed.js'
import { glyphOf } from '../lib/glyphs.js'
import { colorOf, tileStyle } from '../lib/routine-colors.js'
import { leftoversBefore } from '../lib/leftovers.js'
import { Button, Row } from './ui.jsx'
import MiniBodyMap from './MiniBodyMap.jsx'

const ui = () => useUI.getState()
const S = () => useStore.getState().S

// Settings → Workout → "Preview before starting" (#976): a planned session opens on what it
// holds, with Start at its foot, instead of starting on the tap. Off (the default) starts at once,
// the way it always did. Every start of a planned session goes through here.
export function startOrPreview(routineIds) {
  const ids = [].concat(routineIds || [])
  // #985: the last session ended before its routine did. Asked once per such session, then the
  // answer is remembered (S.leftoverSeen) and Start goes back to one tap.
  const left = ids.length ? leftoversBefore(S(), todayISO(), ids) : null
  if (left) return askLeftovers(left, ids)
  if (S().previewStart === true && ids.length) { previewSheet(ids); return }
  startFlow(ids)
}

const answered = left => useStore.getState().update(s => { s.leftoverSeen = left.key })
const leftFrom = left => t('From {0}, {1}', deriveSessionName(left.routines.map(r => r.name)), fmtDaysAgo(left.d))
/** Starts the leftovers first, then `ids` (today's plan, or nothing). */
export function startWithLeftovers(left, ids = []) {
  answered(left)
  startFlow(ids, { lead: left })
}
function askLeftovers(left, ids) {
  const n = left.ex.length
  menuSheet({
    title: tn('You didn’t get to {0} exercise last time', 'You didn’t get to {0} exercises last time', n),
    subtitle: leftFrom(left),
    items: [
      { icon: 'play', label: tn('Start with the {0} exercise you didn’t get to', 'Start with the {0} exercises you didn’t get to', n), sub: t('Then today’s plan, as usual'), onClick: () => startWithLeftovers(left, ids) },
      { icon: 'skipForward', label: t('Just today’s plan'), sub: t('Let them go. No one’s counting.'), onClick: () => { answered(left); startOrPreview(ids) } },
    ],
  })
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
  // Starred routines first (lib/routine-favs.js, #327), each half in Plan's order.
  const others = favRoutinesFirst(activeRoutines(st).filter(r => !planned.has(r.id)))
  const go = ids => { close(); startOrPreview(ids) }
  const nameOf = s => deriveSessionName(s.routines.map(r => r.name))
  const firstOpen = sessions.find(x => !x.done)
  const left = leftoversBefore(st, today, firstOpen ? firstOpen.ids : [])
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('What are we training?')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {sessions.length ? t('Today is {0}. Or pick anything else.', sessions.map(nameOf).join(', ')) : t('Rest day, but no one’s stopping you.')}
    </div>
    {left && <div className="list menu-list" style={{ marginBottom: 14 }}>
      <Row icon="history" iconTint="var(--orange)" title={tn('Start with the {0} exercise you didn’t get to', 'Start with the {0} exercises you didn’t get to', left.ex.length)}
        subtitle={leftFrom(left) + (firstOpen ? ' · ' + t('then {0}', nameOf(firstOpen)) : '')} accessory="chevron"
        onClick={() => { close(); startWithLeftovers(left, firstOpen ? firstOpen.ids : []) }} />
    </div>}
    {sessions.length > 0 && <>
      <h4 className="sec">{t('Today')} · {t(DAYN[new Date(today + 'T12:00:00').getDay()])}</h4>
      <div className="list menu-list start-today" style={{ marginBottom: 14 }}>
        {sessions.map((s, i) => <Row key={s.ids.join('+')} icon={s.done ? 'checkCircle' : glyphOf(s.routines[0].emoji)}
          iconTint={s.done ? 'var(--green)' : 'var(--acc)'} iconStyle={s.done ? undefined : tileStyle(s.routines[0])} title={nameOf(s)}
          subtitle={s.done ? t('Done today. Again?') : exCount(s.routines.reduce((n, r) => n + (r.ex || []).length, 0))}
          accessory="chevron" className={!s.done && i === sessions.findIndex(x => !x.done) ? 'start-first' : ''}
          onClick={() => go(s.ids)} />)}
      </div>
    </>}
    {others.length > 0 && <>
      <h4 className="sec">{sessions.length ? t('Other routines') : t('Your routines')}</h4>
      <div className="list menu-list" style={{ marginBottom: 14 }}>
        {others.map(r => <Row key={r.id} icon={glyphOf(r.emoji)} iconStyle={tileStyle(r)} title={isFavRoutine(r) ? <><Icon name="starFill" className="fav-star" />{r.name}</> : r.name} subtitle={exCount((r.ex || []).length)}
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
  const body = !labels.length ? '' : same ? `${tn('{0} set', '{0} sets', labels.length)} · ${labels[0]}` : labels.join(', ')
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
      <MiniBodyMap routines={built.routines} tint={colorOf(built.routines[0])} body={st.body} />
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
