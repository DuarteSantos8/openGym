// Plan → Archive (docs/dev/ROUTINE_FOLDERS.md): archived folders as headers with their routines,
// then the loose archived ones. Restore and Delete for good, each delete naming what it takes.
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { exCount, routineCount } from '../lib/format.js'
import { said } from '../lib/a11y-name.js'
import { groupRoutines } from '../lib/routine-folders.js'
import { deleteArchived, restoreFolder, restoreRoutines } from '../lib/routine-archive.js'
import { confirmSheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import RoutineTile from '../components/RoutineTile.jsx'
import { Button } from '../components/ui.jsx'
import { withUndo } from '../components/RoutineMenus.jsx'

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

const MoreButton = ({ name, onClick }) => <button type="button" className="plan-more" aria-label={t('More for {0}', said(name))}
  onClick={e => { e.stopPropagation(); onClick() }}><Icon name="more" /></button>

const list = rs => <div className="list routine-list plan-routines">{rs.map(r =>
  <div key={r.id} className="item plan-routine arch-routine">
    <RoutineTile r={r} />
    <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
    <MoreButton name={r.name} onClick={() => routineMenu(r)} />
  </div>)}</div>

export default function RoutineArchive() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const archived = (S.routines || []).filter(r => r.archived === true)
  // groupRoutines puts the loose ones first; this screen lists the folders first.
  const [loose, ...folders] = groupRoutines(archived)
  const all = routineCount(archived.length)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px', minWidth: 0 }}><h1>{t('Archive')}</h1></div>
    </div>
    {archived.length ? <>
      {folders.map(g => <div key={g.folder} className="plan-folder-sect">
        <div className="plan-folder-bar arch-folder">
          <span className="plan-folder"><Icon name="folder" /><span className="grow">{g.folder}</span><span className="n">{g.routines.length}</span></span>
          <MoreButton name={g.folder} onClick={() => folderMenu(g.folder, g.routines.map(r => r.id))} />
        </div>
        {list(g.routines)}
      </div>)}
      {loose.routines.length > 0 && list(loose.routines)}
      <div style={{ height: 16 }} />
      <Button variant="danger" icon="trash" onClick={() => deleteForGood(archived.map(r => r.id), all, t('{0} deleted.', all))}>
        {t('Delete all {0} for good', archived.length)}</Button>
    </> : <EmptyState icon="download" title={t('Nothing archived.')} />}
  </div>
}
