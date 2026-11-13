import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn, exerciseNameFor, exerciseNameClass, dateLocale } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { fmtDate, todayISO, isoOf, uid } from '../lib/format.js'
import { tappable, useSheetKeyboard } from '../lib/use-sheet-keyboard.js'
import {
  collectNotes, filterNotes, normFilter, filterIsEmpty, kindCounts, notedExercises, foldersOf, withFolder,
  withGymNote, gymNoteText, NOTE_KINDS, NOTE_KIND_LABEL, NOTE_KIND_ICON, EXERCISE_KINDS, ANY_EX, FOLDERS_MAX,
} from '../lib/journal.js'
import { gymsOf, gymLabel, activeGym } from '../lib/gym-inventory.js'
import { RECOVERY_ICON } from '../lib/recovery-sessions.js'
import { DAY_NOTE_ICON } from '../lib/day-notes.js'
import { copyText } from '../lib/clipboard.js'
import Icon from '../components/Icon.jsx'
import ScreenHeader from '../components/ScreenHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import DateField from '../components/DateField.jsx'
import { Button, SearchField, TextField } from '../components/ui.jsx'
import { recoverySheet } from '../components/RecoverySheet.jsx'
import { menuSheet, confirmSheet, workoutDetailSheet, exerciseHistorySheet, dayNoteSheet } from '../sheets.jsx'

// The journal (Stats → More → Journal; lib/journal.js reads the notes): one feed of everything you
// ever wrote down, newest first, with the always-on notes, the routine tips and the gym pins after
// the dated ones. Narrow it by kind, by exercise, by dates or by words; keep a narrowing you use as
// a folder (a saved filter, so a note is never in one place only). Tap a note to read it whole,
// jump to its workout or exercise, or pin it at a gym.

const ui = () => useUI.getState()
const store = () => useStore.getState()
const exName = id => exerciseNameFor(exOr(id))
const monthLabel = ym => new Date(ym + '-15T12:00:00').toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' })
const noteIcon = n => n.kind === 'recovery' ? RECOVERY_ICON[n.recKind] || 'sparkles' : n.kind === 'day' && n.tag ? DAY_NOTE_ICON[n.tag] : NOTE_KIND_ICON[n.kind]
// The note's heading: its exercise, its workout, its quick pick or its kind.
function noteHead(n) {
  if (n.exId) return exName(n.exId)
  if (n.kind === 'workout') return n.title || t('Workout')
  if (n.kind === 'body') return t('Check-in')
  if (n.kind === 'gym') return n.title || t('My gym')
  return n.title ? t(n.title) : t(NOTE_KIND_LABEL[n.kind])
}
// What sits under it: where and when.
function noteSub(n) {
  const bits = []
  if (n.d) bits.push(fmtDate(n.d, true))
  if (n.kind === 'set') bits.push(t('Set {0}', n.setNo))
  if (n.kind === 'exercise' || n.kind === 'set') bits.push(n.title)
  if (n.kind === 'standing') bits.push(t('Every session'))
  if (n.kind === 'tip') bits.push(t('In {0}', n.title))
  if (n.kind === 'gym') bits.push(n.exId ? t('At {0}', n.title || t('My gym')) : t('Every workout here'))
  if (n.pinned) bits.push(t('Shown next time'))
  return bits.filter(Boolean).join(' · ')
}

/* ---------------- one note, whole ---------------- */

export function pinAtGym(n) {
  const S = store().S
  const gyms = gymsOf(S)
  const exId = EXERCISE_KINDS.has(n.kind) && n.exId ? n.exId : ANY_EX
  const pin = g => {
    const had = gymNoteText(S, g.id, exId)
    const write = () => {
      store().update(s => { s.gymNotes = withGymNote(s.gymNotes, g.id, exId, n.text) })
      ui().toast(t('Pinned at {0}. It shows when you train there.', gymLabel(g)))
    }
    if (had && had !== n.text) confirmSheet({ title: t('Replace the pin at {0}?', gymLabel(g)), message: had, confirmText: t('Replace'), onConfirm: write })
    else write()
  }
  if (gyms.length === 1) { pin(gyms[0]); return }
  menuSheet({
    title: t('Pin at a gym'),
    subtitle: exId === ANY_EX ? t('Shows at the top of every workout there.') : t('Shows on {0} when you train there.', exName(exId)),
    items: gyms.map(g => ({ icon: 'mapPin', label: gymLabel(g), sub: gymNoteText(S, g.id, exId) || undefined, on: activeGym(S)?.id === g.id ? true : undefined, onClick: () => pin(g) })),
  })
}

function NoteView({ n, close }) {
  const S = useStore(s => s.S)
  const nav = useNavigate()
  const w = n.wid ? (S.workouts || []).find(x => String(x.id != null ? x.id : `${x.d}|${x.start}`) === n.wid) : null
  const gyms = gymsOf(S)
  const go = fn => () => { close(); fn() }
  const actions = [
    w && { icon: 'history', label: t('Open the workout'), onClick: go(() => workoutDetailSheet(w)) },
    n.exId && { icon: 'chartLine', label: t('Exercise history'), onClick: go(() => exerciseHistorySheet(n.exId)) },
    n.kind === 'body' && { icon: 'ruler', label: t('Open measurements'), onClick: go(() => nav('/measurements')) },
    n.kind === 'recovery' && { icon: 'pencil', label: t('Edit'), onClick: go(() => recoverySheet({ id: n.rid })) },
    n.kind === 'day' && { icon: 'pencil', label: t('Edit'), onClick: go(() => dayNoteSheet(n.d)) },
    n.kind === 'tip' && { icon: 'list', label: t('Open the routine'), onClick: go(() => nav('/plan/r/' + n.routineId)) },
    n.kind !== 'gym' && gyms.length > 0 && { icon: 'mapPin', label: t('Pin at a gym'), onClick: go(() => pinAtGym(n)) },
    n.kind === 'gym' && { icon: 'xmark', label: t('Unpin'), onClick: go(() => {
      store().update(s => { s.gymNotes = withGymNote(s.gymNotes, n.gymId, n.exId || ANY_EX, '') })
      ui().toast(t('Unpinned'))
    }) },
    { icon: 'copy', label: t('Copy text'), onClick: () => copyText(n.text).then(() => ui().toast(t('Copied'))).catch(() => {}) },
  ].filter(Boolean)
  return <>
    <div className="jn-view-kind small muted"><Icon name={noteIcon(n)} />{t(NOTE_KIND_LABEL[n.kind])}</div>
    <h3 className={n.exId ? exerciseNameClass(exOr(n.exId)) : undefined} style={{ marginBottom: 2 }}>{noteHead(n)}</h3>
    {noteSub(n) && <div className="muted small" style={{ marginBottom: 12 }}>{noteSub(n)}</div>}
    <div className="jn-view-text">{n.text}</div>
    <div className="list menu-list" style={{ marginTop: 16 }}>
      {actions.map((a, i) => <div key={i} className="item menu-item" {...tappable(a.onClick)}>
        <span className="lrow-i"><Icon name={a.icon} /></span>
        <div className="grow"><div className="tt">{a.label}</div></div>
      </div>)}
    </div>
  </>
}
export const noteSheet = n => ui().openSheet(close => <NoteView n={n} close={close} />)

/* ---------------- filter sheets ---------------- */

function DatesSheet({ filter, onChange, close }) {
  const [from, setFrom] = useState(filter.from || '')
  const [to, setTo] = useState(filter.to || '')
  const today = todayISO()
  const back = days => { const d = new Date(); d.setDate(d.getDate() - days); return isoOf(d) }
  const pick = (f, tt) => { onChange({ ...filter, from: f || undefined, to: tt || undefined }); close() }
  const presets = [
    { label: t('Last 30 days'), f: back(30) },
    { label: t('Last 3 months'), f: back(91) },
    { label: t('This year'), f: today.slice(0, 4) + '-01-01' },
  ]
  return <>
    <h3>{t('Dates')}</h3>
    <div className="chips" style={{ flexWrap: 'wrap', margin: '0 0 14px' }}>
      {presets.map(p => <button key={p.label} type="button" className={'chip nocap' + (filter.from === p.f && !filter.to ? ' on' : '')}
        onClick={() => pick(p.f, null)}>{p.label}</button>)}
    </div>
    <label className="measure-date"><span>{t('From')}</span><DateField value={from} max={to || today} onChange={setFrom} label={t('From')} /></label>
    <label className="measure-date"><span>{t('To')}</span><DateField value={to} max={today} onChange={setTo} label={t('To')} /></label>
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={() => pick(from, to)}>{t('Show these days')}</Button>
    {(filter.from || filter.to) && <><div style={{ height: 8 }} /><Button variant="ghost" onClick={() => pick(null, null)}>{t('Any day')}</Button></>}
  </>
}

function FolderName({ initial = '', title, onSave, close }) {
  const [name, setName] = useState(initial)
  const ref = useRef(null)
  const onFocus = useSheetKeyboard(ref)
  const ok = name.trim().length > 0
  const save = () => { if (ok) { onSave(name.trim().slice(0, 40)); close() } }
  return <>
    <h3>{title}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('A folder is a saved filter: a note that matches turns up in it, nothing gets moved.')}</div>
    <TextField ref={ref} value={name} maxLength={40} placeholder={t('Like “Shoulder niggles”')} autoFocus
      onFocus={onFocus} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={!ok} onClick={save}>{t('Save')}</Button>
  </>
}
const folderNameSheet = opts => ui().openSheet(close => <FolderName {...opts} close={close} />)

/* ---------------- the page ---------------- */

const sameFilter = (a, b) => JSON.stringify(normFilter(a)) === JSON.stringify(normFilter(b))
let lastFilter = {}
let lastFolder = null

export default function Journal() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const all = useMemo(() => collectNotes(S), [S.workouts, S.measurements, S.dayNotes, S.recoverySessions, S.exNotes, S.routines, S.gymNotes, S.equipProfiles]) // eslint-disable-line react-hooks/exhaustive-deps
  const folders = foldersOf(S)
  const [filter, setFilterRaw] = useState(lastFilter)
  const [folderId, setFolderIdRaw] = useState(() => (folders.some(f => f.id === lastFolder) ? lastFolder : null))
  const setFilter = f => { lastFilter = normFilter(f); setFilterRaw(lastFilter) }
  const setFolderId = id => { lastFolder = id; setFolderIdRaw(id) }
  const folder = folders.find(f => f.id === folderId) || null
  const f = normFilter(filter)
  const shown = filterNotes(all, f, exName)
  const counts = kindCounts(filterNotes(all, { ...f, kinds: undefined }, exName))
  const kinds = new Set(f.kinds || [])
  const toggleKind = k => {
    const next = new Set(kinds)
    if (next.has(k)) next.delete(k); else next.add(k)
    setFilter({ ...f, kinds: [...next] })
  }
  const openFolder = fo => {
    if (folder?.id === fo.id) { folderMenu(fo); return }
    setFolderId(fo.id); setFilter(fo.filter)
  }
  const allNotes = () => { setFolderId(null); setFilter({}) }
  const saveFolder = () => folderNameSheet({
    title: t('New folder'),
    onSave: name => {
      const id = uid()
      update(s => { s.journalFolders = withFolder(s.journalFolders, id, { name, filter: f }) })
      setFolderId(id)
      ui().toast(t('Folder “{0}” saved', name))
    },
  })
  const folderMenu = fo => menuSheet({
    title: fo.name,
    items: [
      !sameFilter(fo.filter, f) && { icon: 'check', label: t('Save the current filter here'), onClick: () => update(s => { s.journalFolders = withFolder(s.journalFolders, fo.id, { name: fo.name, filter: f }) }) },
      { icon: 'pencil', label: t('Rename'), onClick: () => folderNameSheet({ title: t('Rename folder'), initial: fo.name, onSave: name => update(s => { s.journalFolders = withFolder(s.journalFolders, fo.id, { name, filter: fo.filter }) }) }) },
      { icon: 'trash', label: t('Delete folder'), danger: true, onClick: () => {
        update(s => { s.journalFolders = withFolder(s.journalFolders, fo.id, null) })
        allNotes()
        ui().toast(t('Folder deleted. The notes stay where they were.'))
      } },
    ].filter(Boolean),
  })
  const exList = notedExercises(all)
  const pickExercise = () => menuSheet({
    title: t('Exercise'),
    items: [
      { icon: 'list', label: t('Any exercise'), on: !f.exId ? true : undefined, onClick: () => setFilter({ ...f, exId: undefined }) },
      ...exList.map(e => ({ icon: 'dumbbell', label: exName(e.id), sub: tn('{0} note', '{0} notes', e.count), on: f.exId === e.id ? true : undefined, onClick: () => setFilter({ ...f, exId: e.id }) })),
    ],
  })
  const pickDates = () => ui().openSheet(close => <DatesSheet filter={f} onChange={setFilter} close={close} />)
  const dateChip = f.from || f.to
    ? (f.from && f.to ? t('{0} to {1}', fmtDate(f.from), fmtDate(f.to)) : f.from ? t('Since {0}', fmtDate(f.from)) : t('Until {0}', fmtDate(f.to)))
    : t('Any day')
  const unsaved = !filterIsEmpty(f) && (!folder || !sameFilter(folder.filter, f))

  // Dated notes by month, then the ones that are true every time.
  const groups = []
  for (const n of shown) {
    const key = n.d ? n.d.slice(0, 7) : 'always'
    let g = groups.at(-1)
    if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g) }
    g.items.push(n)
  }

  return <div className="narrow journal">
    <ScreenHeader hard title={t('Journal')} sub={tn('{0} note', '{0} notes', all.length)}
      left={<button className="iconbtn" data-back="/stats" onClick={() => nav('/stats')} aria-label={t('Stats')}><Icon name="chevronLeft" /></button>} />

    <SearchField value={f.q || ''} placeholder={t('Search your notes')} aria-label={t('Search your notes')}
      onChange={e => setFilter({ ...f, q: e.target.value })} onClear={() => setFilter({ ...f, q: '' })} />

    {(folders.length > 0 || unsaved) && <div className="chips jn-folders" role="toolbar" aria-label={t('Folders')}>
      <button type="button" className={'chip nocap ichip' + (!folder && filterIsEmpty(f) ? ' on' : '')} onClick={allNotes}><Icon name="note" />{t('All notes')}</button>
      {folders.map(fo => <button key={fo.id} type="button" className={'chip nocap ichip' + (folder?.id === fo.id ? ' on' : '')}
        aria-pressed={folder?.id === fo.id} onClick={() => openFolder(fo)}>
        <Icon name="folder" />{fo.name}{folder?.id === fo.id && <Icon name="chevronDown" />}</button>)}
      {unsaved && folders.length < FOLDERS_MAX && <button type="button" className="chip nocap ichip jn-save" onClick={saveFolder}><Icon name="plus" />{t('Save as folder')}</button>}
    </div>}

    <div className="chips jn-filters" role="toolbar" aria-label={t('Filter')}>
      <button type="button" className={'chip nocap ichip' + (f.exId ? ' on' : '')} onClick={pickExercise} disabled={!exList.length}>
        <Icon name="dumbbell" />{f.exId ? exName(f.exId) : t('Any exercise')}<Icon name="chevronDown" /></button>
      <button type="button" className={'chip nocap ichip' + (f.from || f.to ? ' on' : '')} onClick={pickDates}>
        <Icon name="calendar" />{dateChip}<Icon name="chevronDown" /></button>
      <button type="button" className={'chip nocap ichip' + (f.media ? ' on' : '')} aria-pressed={!!f.media}
        onClick={() => setFilter({ ...f, media: !f.media })}><Icon name="image" />{t('With photos')}</button>
    </div>
    <div className="chips jn-kinds" role="group" aria-label={t('Kind')}>
      {NOTE_KINDS.filter(k => counts[k] || kinds.has(k)).map(k => <button key={k} type="button" aria-pressed={kinds.has(k)}
        className={'chip nocap ichip' + (kinds.has(k) ? ' on' : '')} onClick={() => toggleKind(k)}>
        <Icon name={NOTE_KIND_ICON[k]} />{t(NOTE_KIND_LABEL[k])}<span className="dim">{counts[k] || 0}</span></button>)}
    </div>

    {!all.length
      ? <EmptyState icon="note" text={t('Nothing written down yet. A note on a set, a workout or a check-in lands here, all in one place.')} />
      : !shown.length
        ? <div className="empty small jn-none">{t('No note matches. Loosen a filter or two.')}
          <div style={{ height: 10 }} /><Button size="sm" variant="tinted" onClick={allNotes}>{t('Show all notes')}</Button></div>
        : groups.map(g => <section key={g.key} className="jn-group" aria-label={g.key === 'always' ? t('Kept on the exercise') : monthLabel(g.key)}>
          <h4 className="sec">{g.key === 'always' ? t('Kept on the exercise') : monthLabel(g.key)}</h4>
          <div className="list">{g.items.map(n => <div key={n.key} className={'item jn-row jn-' + n.kind} {...tappable(() => noteSheet(n))}>
            <span className="lrow-i jn-i" aria-hidden="true"><Icon name={noteIcon(n)} /></span>
            <div className="grow">
              <div className="tt"><span className={n.exId ? exerciseNameClass(exOr(n.exId)) : undefined}>{noteHead(n)}</span></div>
              <div className="jn-text">{n.text}</div>
              {noteSub(n) && <div className="ss">{noteSub(n)}</div>}
            </div>
            {n.media && <Icon name="image" className="jn-media" aria-label={t('With photos')} />}
          </div>)}</div>
        </section>)}
  </div>
}
