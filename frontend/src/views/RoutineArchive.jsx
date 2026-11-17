// Plan → Archive (docs/dev/ROUTINE_FOLDERS.md): archived folders as headers with their routines,
// then the loose archived ones. Restore and Delete for good, each delete naming what it takes.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { exCount, routineCount } from '../lib/format.js'
import { nameIn, said } from '../lib/a11y-name.js'
import { groupRoutines } from '../lib/routine-folders.js'
import { deleteArchived, restoreFolder, restoreRoutines } from '../lib/routine-archive.js'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import RoutineTile from '../components/RoutineTile.jsx'
import { withUndo } from '../components/RoutineMenus.jsx'
import { MoreButton } from '../components/RoutineRow.jsx'

const update = fn => useStore.getState().update(fn)

function deleteForGood(ids, name, gone) {
  confirmSheet({
    title: t('Delete for good'), danger: true, confirmText: t('Delete'),
    message: t('Delete {0} for good? Your past workouts stay in History.', name),
    onConfirm: () => withUndo(gone, s => deleteArchived(s, ids)),
  })
}

const restored = name => useUI.getState().toast(t('“{0}” restored.', name))

function routineMenu(r) {
  menuSheet({ title: r.name, sections: [{ items: [
    { icon: 'undo', label: t('Restore'), onClick: () => { update(s => { restoreRoutines(s, [r.id]) }); restored(r.name) } },
  ] }, { items: [
    { icon: 'trash', label: t('Delete for good'), danger: true, onClick: () => deleteForGood([r.id], r.name, t('“{0}” gone.', r.name)) },
  ] }] })
}

function folderMenu(name, ids) {
  menuSheet({ title: name, sections: [{ items: [
    { icon: 'undo', label: t('Restore folder'), onClick: () => { update(s => { restoreFolder(s, name) }); restored(name) } },
  ] }, { items: [
    { icon: 'trash', label: t('Delete folder for good'), danger: true, onClick: () => deleteForGood(ids, routineCount(ids.length), t('“{0}” and its routines gone.', name)) },
  ] }] })
}

const restoreOne = r => { update(s => { restoreRoutines(s, [r.id]) }); restored(r.name) }

const rows = rs => rs.map(r =>
  <div key={r.id} className="item plan-routine arch-routine">
    <RoutineTile r={r} />
    <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
    <button type="button" className="arch-restore" aria-label={nameIn(r.name, t('Restore'))} onClick={() => restoreOne(r)}><Icon name="undo" />{t('Restore')}</button>
    <MoreButton name={r.name} onClick={() => routineMenu(r)} />
  </div>)

export default function RoutineArchive() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const archived = (S.routines || []).filter(r => r.archived === true)
  // groupRoutines puts the loose ones first; this screen lists the folders first.
  const [loose, ...folders] = groupRoutines(archived)
  const all = routineCount(archived.length)

  return <div className="narrow plan">
    <div className="row between plan-crumb">
      <button type="button" className="plan-textbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" />{t('Plan')}</button>
    </div>
    <div className="hdr">
      <div style={{ minWidth: 0 }}>
        <h1>{t('Archive')}</h1>
        {archived.length > 0 && <div className="sub">{all}. {t('They stay out of Plan until you restore them.')}</div>}
      </div>
    </div>
    {archived.length ? <>
      {/* One card per archived folder, then the loose ones in their own, so they never read as part of the last folder. */}
      {folders.map(g => <div key={g.folder} className="list plan-group routine-list plan-routines">
        <div className="plan-folder-bar arch-folder">
          <span className="plan-folder"><Icon name="folder" /><span className="grow">{g.folder}</span><span className="n">{g.routines.length}</span></span>
          <MoreButton name={g.folder} onClick={() => folderMenu(g.folder, g.routines.map(r => r.id))} />
        </div>
        {rows(g.routines)}
      </div>)}
      {loose.routines.length > 0 && <>
        {folders.length > 0 && <h4 className="sec plan-hdr">{t('Not in a folder')}</h4>}
        <div className="list plan-group routine-list plan-routines">{rows(loose.routines)}</div>
      </>}
      <button type="button" className="arch-delete-all" onClick={() => deleteForGood(archived.map(r => r.id), all, t('{0} deleted.', all))}>
        {t('Delete all {0} for good', archived.length)}</button>
    </> : <EmptyState icon="archive" title={t('Nothing archived.')} />}
  </div>
}
