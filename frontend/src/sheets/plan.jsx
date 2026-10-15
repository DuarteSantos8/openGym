import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { fmtDate, todayISO, exCount, routineCount, DAYN } from '../lib/format.js'
import { effectiveRoutineIds, NOTE_MAX } from '../lib/history.js'
import { t, tn } from '../lib/i18n.js'
import { nav } from '../lib/nav.js'
import Icon from '../components/Icon.jsx'
import { Button, Switch } from '../components/ui.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { buildPlanBundle, parsePlan, mergePlan, printPlan, planPrintHTML } from '../lib/plan-share.js'
import { MOBILE, shareExport, printHtml } from '../lib/mobile.js'
import { useSheetKeyboard, tappable } from '../lib/use-sheet-keyboard.js'
import { deriveSessionName } from '../lib/session-merge.js'
import { workoutsOn } from '../lib/backfill.js'
import { queueRemaining, pinState } from '../lib/queue.js'
import { DAY_NOTE_TAGS, DAY_NOTE_LABEL, DAY_NOTE_ICON, dayNoteOf, canNoteDay, withDayNote } from '../lib/day-notes.js'
import { S, update, ui, toast } from './shared.js'
import { logPastWorkoutSheet } from './workout-flow.jsx'

/* ============================ share / print / import a plan ============================ */
export const planToolsSheet = () => ui().openSheet(close => <PlanTools close={close} />)

// The three things the Plan menu and this sheet both do with a plan, so the two can never drift.
export const planHasRoutines = st => (st.routines || []).some(r => r.ex && r.ex.length)
export async function exportPlanFile() {
  const st = S(), user = useStore.getState().user
  const bundle = buildPlanBundle(st, user?.name ? t('{0}’s plan', user.name) : '')
  const json = JSON.stringify(bundle, null, 2)
  const name = 'opengym-plan-' + todayISO() + '.json'
  if (MOBILE) { try { await shareExport(json, name) } catch (e) { /* dismissed */ } return }
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
  toast(t('Plan file saved. Send it to a friend!'))
}
// Web: the browser's print dialog (→ Save as PDF). Mobile: the OS print flow via the native
// Print plugin — Android WebView has no window.print(). Same printable HTML both ways.
export function printWholePlan() {
  const st = S(), owner = useStore.getState().user?.name || ''
  if (MOBILE) printHtml(planPrintHTML(st, owner), t('Weekly Training Plan')).catch(() => { /* dismissed */ })
  else printPlan(st, owner)
}
// A picked plan file → the import sheet, or a toast saying why not.
export function importPlanFile(f, onRead) {
  if (!f) return
  const rd = new FileReader()
  rd.onload = () => {
    try { const bundle = parsePlan(rd.result, S().unit || 'kg'); onRead?.(); planImportSheet(bundle) }
    // parsePlan's own refusal is written for people; anything else is not shown raw.
    catch (e) { toast(e?.code === 'not-plan' ? t('Import failed: {0}', e.message) : t('Couldn’t read that file.')) }
  }
  rd.readAsText(f)
}

function PlanTools({ close }) {
  const st = useStore(s => s.S)
  const fileRef = useRef(null)
  const hasRoutines = planHasRoutines(st)

  const exportFile = async () => { await exportPlanFile(); close() }
  const pickFile = ev => {
    const f = ev.target.files[0]; ev.target.value = ''
    importPlanFile(f, close)
  }

  return <>
    <h3>{t('Share your plan')}</h3>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Send your routines to a friend, or put your week on paper.')}</div>
    <Button variant="primary" icon="share" onClick={exportFile} disabled={!hasRoutines}>{t('Export plan file')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A small file a friend can import into their own openGym. Routines only, none of your workouts or weigh-ins.')}</div>
    <div style={{ height: 12 }} />
    <Button variant="tinted" icon="note" onClick={() => { close(); printWholePlan() }} disabled={!hasRoutines}>{t('Print / Save as PDF')}</Button>
    <div className="dim small" style={{ margin: '7px 2px 0', lineHeight: 1.4 }}>{t('A clean printout, one page per plan. No exercise ever gets split across pages.')}</div>
    {!hasRoutines && <div className="dim small" style={{ margin: '12px 2px 0' }}>{t('Add an exercise to a routine first. An empty plan has nothing to share.')}</div>}
    <h4 className="sec">{t('Got a plan from a friend?')}</h4>
    <Button variant="ghost" icon="download" onClick={() => fileRef.current?.click()}>{t('Import a plan file')}</Button>
    <input ref={fileRef} type="file" accept="application/json,.json" onChange={pickFile} hidden />
  </>
}

export const planImportSheet = bundle => ui().openSheet(close => <PlanImport bundle={bundle} close={close} />)

function PlanImport({ bundle, close }) {
  const [schedule, setSchedule] = useState(false)
  const apply = () => {
    update(s => mergePlan(s, bundle, { schedule }))
    close()
    toast(tn('Added {0} routine to your plan', 'Added {0} routines to your plan', bundle.routineCount))
    nav('/train/routines')
  }
  return <>
    <h3>{bundle.name ? t('Import “{0}”', bundle.name) : t('Import this plan')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {routineCount(bundle.routineCount)}
      {' · ' + exCount(bundle.exerciseCount)}
      {bundle.scheduledDays > 0
        ? ' · ' + tn('scheduled on {0} day', 'scheduled on {0} days', bundle.scheduledDays)
        : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>{t('These are added as new routines. Nothing you already have is touched.')}</div>
    {bundle.dropped > 0 && <div className="small" style={{ color: 'var(--yellow-ink)', marginBottom: 14, lineHeight: 1.4 }}>
      {t(bundle.dropped === 1
        ? '{0} exercise in the file isn’t in your library and was left out.'
        : '{0} exercises in the file aren’t in your library and were left out.', bundle.dropped)}
    </div>}
    {bundle.scheduledDays > 0 && <div className="row between" style={{ padding: '10px 2px', borderTop: '1px solid var(--sep)', borderBottom: '1px solid var(--sep)', marginBottom: 16, gap: 12 }}>
      <div><div className="tt" style={{ fontSize: 15 }}>{t('Use this weekly schedule')}</div><div className="small dim">{t('Replaces your current Mon–Sun assignments.')}</div></div>
      <Switch checked={schedule} onChange={setSchedule} />
    </div>}
    <Button variant="primary" onClick={apply}>{t('Add to my plan')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

/* ============================ day override / assign ============================ */
function DayOverride({ iso, close }) {
  const st = useStore(s => s.S)
  const hasOvr = st.dayPlan[iso] !== undefined
  // A fulfilled pin (a coach session pinned here and since done) reads as no override, as it does
  // everywhere else — the row to clear the leftover entry stays.
  const changed = hasOvr && pinState(st, st.dayPlan[iso]) !== 'done'
  // The plan the day would have without its override — the weekday's routines, and in a coach
  // week the queue's session for the day in front of them, same as the Home row shows.
  const { [iso]: _ovr, ...noOvr } = st.dayPlan
  const weeklyNames = effectiveRoutineIds({ ...st, dayPlan: noOvr }, iso).map(id => st.routines.find(r => r.id === id)?.name).filter(Boolean)
  // A weekday can hold several routines; the per-date override stays single-pick, so picking
  // one here collapses a combined day to it (docs/dev/COMBINE_ROUTINES.md §8). The check marks
  // show everything currently planned for the day.
  const effIds = effectiveRoutineIds(st, iso)
  // A planned day in the past with nothing logged was missed — or trained and never logged,
  // like a run you forgot to start the app for (#284). Logging it opens "Log a past workout" on
  // that date with the day's routines picked, where the time and the duration can still change.
  const missed = iso < todayISO() && effIds.length > 0 && !workoutsOn(st, iso).length
  const logIt = () => { close(); logPastWorkoutSheet({ iso, routineIds: effIds }) }
  // A note on a day off (#261, lib/day-notes.js): offered on today and past days with nothing
  // logged, kept in view on any day that already has one. Quiet on purpose: a row, not a button.
  const note = dayNoteOf(st, iso)
  const canNote = !!note || (canNoteDay(iso) && !workoutsOn(st, iso).length)
  // The coach week's sessions still to do come first, in slot order: picking one here pins it
  // to this day — the same per-date override, read back by queueNext (lib/queue.js). A session
  // already pinned to another day says so in place of its exercise count. Done sessions and
  // your own routines follow in the plain list.
  const remaining = queueRemaining(st)
  // Your own rotation's pass (its rotationId matches the saved rotation) is your loop, not a coach's week.
  const ownLoop = !!st.queue && !!st.rotation && st.queue.rotationId === st.rotation.id
  const coach = remaining.map(id => st.routines.find(r => r.id === id)).filter(Boolean)
  // Active pins straight from the plan (earliest day per session, today or later) — not the
  // row's 'pinned' items, which leave out the session pinned to today itself.
  const pinnedOn = Object.entries(st.dayPlan).filter(([d, id]) => d >= todayISO() && remaining.includes(id)).sort()
    .reduce((m, [d, id]) => (m[id] ? m : { ...m, [id]: d }), {})
  const set = v => {
    update(s => { if (!v) delete s.dayPlan[iso]; else s.dayPlan[iso] = v })
    close()
    toast(v === '' ? t('Back to weekly plan') : v === 'rest' ? t('{0} set to rest', fmtDate(iso)) : t('{0} planned for {1}', (st.routines.find(r => r.id === v) || {}).name, fmtDate(iso)))
  }
  const row = r => <div key={r.id} className="item" {...tappable(() => set(r.id))}>
    <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
    <div className="grow"><div className="tt">{r.name}</div><div className="ss">{pinnedOn[r.id] && pinnedOn[r.id] !== iso ? fmtDate(pinnedOn[r.id], true) : exCount(r.ex.length)}</div></div>
    {effIds.includes(r.id) && <Icon name="check" className="accent" />}</div>
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyNames.length ? deriveSessionName(weeklyNames) : t('Rest')}{changed && <span style={{ color: 'var(--orange-ink)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    {missed && <div style={{ marginBottom: 14 }}><Button variant="primary" icon="checkCircle" onClick={logIt}>{t('Log this workout')}</Button></div>}
    {canNote && <div className="day-note" style={{ marginBottom: 14 }}>
      <div className="item day-note-row" {...tappable(() => dayNoteSheet(iso))}>
        <span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name={note?.tag ? DAY_NOTE_ICON[note.tag] : 'note'} /></span>
        <div className="grow">{note
          ? <><div className="tt">{note.tag ? t(DAY_NOTE_LABEL[note.tag]) : t('Day note')}</div>{note.text && <div className="ss" style={{ whiteSpace: 'pre-wrap' }}>{note.text}</div>}</>
          : <div className="tt">{t('Add a note for this day')}</div>}</div>
        <Icon name={note ? 'pencil' : 'plus'} className="chev" />
      </div>
    </div>}
    {coach.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 0 }}>{ownLoop ? t('Your loop') : t('Coach week')}</h4>
      <div className="list" style={{ marginBottom: 8 }}>{coach.map(row)}</div>
    </>}
    <div className="list">
      {st.routines.filter(r => !remaining.includes(r.id)).map(row)}
      <div className="item" {...tappable(() => set('rest'))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{effIds.length === 0 && <Icon name="check" className="accent" />}</div>
      {hasOvr && <div className="item" {...tappable(() => set(''))}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </>
}
export const dayOverrideSheet = iso => ui().openSheet(close => <DayOverride iso={iso} close={close} />)

// Why a day went without training (#261): one quick pick, a line of text, or both. Saving an
// empty note takes it away (a stamped clear, lib/day-notes.js withDayNote), and so does Remove.
function DayNote({ iso, close }) {
  const noteRef = useRef(null)
  const onNoteFocus = useSheetKeyboard(noteRef)
  const st = useStore(s => s.S)
  const had = dayNoteOf(st, iso)
  const [tag, setTag] = useState(had?.tag || null)
  const [text, setText] = useState(had?.text || '')
  const write = v => {
    update(s => { s.dayNotes = withDayNote(s.dayNotes, iso, v) })
    close()
  }
  const save = () => {
    const clean = text.trim().slice(0, NOTE_MAX)
    if (!tag && !clean && !had) { close(); return }
    write({ tag, text: clean })
    toast(tag || clean ? t('Noted. See you next session!') : t('Note removed'))
  }
  const remove = () => { write(null); toast(t('Note removed')) }
  return <>
    <h3>{fmtDate(iso, true)}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Life happens. Leave yourself a note, and the missed-day nudge lets this one go.')}</div>
    <div className="chips" style={{ margin: '0 0 12px' }}>
      {DAY_NOTE_TAGS.map(k => <button key={k} className={'chip nocap' + (tag === k ? ' on' : '')} aria-pressed={tag === k}
        onClick={() => setTag(tag === k ? null : k)}><Icon name={DAY_NOTE_ICON[k]} /> {t(DAY_NOTE_LABEL[k])}</button>)}
    </div>
    <textarea ref={noteRef} className="input" rows={3} maxLength={NOTE_MAX} value={text}
      placeholder={t('Anything else? (optional)')}
      onFocus={onNoteFocus} onChange={e => setText(e.target.value)} />
    <div style={{ height: 18 }} />
    <Button variant="primary" onClick={save}>{t('Save')}</Button>
    {had && <><div style={{ height: 10 }} /><Button variant="ghost" icon="trash" onClick={remove}>{t('Remove note')}</Button></>}
  </>
}
export const dayNoteSheet = iso => ui().openSheet(close => <DayNote iso={iso} close={close} />)

// Plan → Schedule → a weekday. One sheet for the whole day: tap routines to put them on it or
// take them off (two or more make a combined day, docs/dev/COMBINE_ROUTINES.md), in the order
// tapped, which is the order the session runs them; "Rest day" clears it. The sheet stays open
// for a second pick, so "Done" closes it. The weekday never stores [] (the key goes instead).
function DayAssign({ day, close }) {
  const st = useStore(s => s.S)
  const cur = [].concat(st.week[day] || [])
  const toggle = id => update(s => {
    const ids = [].concat(s.week[day] || [])
    const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
    if (next.length) s.week[day] = next; else delete s.week[day]
  })
  const rest = () => { update(s => { delete s.week[day] }); close() }
  return <>
    <h3 style={{ marginBottom: 2 }}>{t(DAYN[day])}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Pick one routine, or more to train them together.')}</div>
    <div className="list menu-list">
      <div className="item menu-item" {...tappable(rest)}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest day')}</div></div><span className={'menu-on' + (!cur.length ? ' is-on' : '')}><Icon name="check" /></span></div>
      {st.routines.map(r => {
        const on = cur.includes(r.id)
        return <div key={r.id} className="item menu-item" aria-pressed={on} {...tappable(() => toggle(r.id))}>
          <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
          <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
          <span className={'menu-on' + (on ? ' is-on' : '')}><Icon name="check" /></span>
        </div>
      })}
    </div>
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
export const dayAssignSheet = day => ui().openSheet(close => <DayAssign day={day} close={close} />)
