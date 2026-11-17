// Plan → one folder (docs/dev/ROUTINE_FOLDERS.md): its routines as Plan's rows, the folder "…",
// and "New routine in this folder" at the end. A folder that is gone (removed, deleted, archived,
// or a stale link) sends you back to Plan.
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { exCount, routineCount, weekOrder, weekStartOf, DAYS } from '../lib/format.js'
import { nameIn, said } from '../lib/a11y-name.js'
import { workoutControls } from '../lib/workout-controls.js'
import { folderList, folderOf, isLive } from '../lib/routine-folders.js'
import Icon from '../components/Icon.jsx'
import RoutineRow, { MoreButton } from '../components/RoutineRow.jsx'
import { routineMenu, folderMenu, duplicateRoutine } from '../components/RoutineMenus.jsx'
import { deleteRoutineWithUndo, newRoutine } from './Plan.jsx'

const enc = n => '/plan/folder/' + encodeURIComponent(n)

export default function RoutineFolderView() {
  const nav = useNavigate()
  // The router has already decoded the name.
  const { name = '' } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const f = folderList(S).find(x => x.name.toLowerCase() === name.toLowerCase())
  useEffect(() => { if (!f) nav('/plan', { replace: true }) }, [f, nav])
  if (!f) return null

  const swipe = workoutControls(S).swipeSets
  const order = weekOrder(weekStartOf(S))
  const daysOf = id => order.filter(d => [].concat(S.week[d] || []).includes(id)).map(d => t(DAYS[d]))
  const rows = S.routines.filter(r => isLive(r) && folderOf(r).toLowerCase() === f.name.toLowerCase())

  return <div className="narrow plan">
    <div className="row between plan-crumb">
      <button type="button" className="plan-textbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" />{t('Plan')}</button>
      <MoreButton name={f.name} onClick={() => folderMenu(f.name, n => nav(enc(n), { replace: true }))} />
    </div>
    <div className="hdr">
      <div style={{ minWidth: 0 }}>
        <h1 style={{ overflowWrap: 'anywhere' }}>{f.name}</h1>
        <div className="sub">{routineCount(f.live)} · {f.current ? t('Current plan') : t('Not the current plan')}</div>
      </div>
    </div>
    <div className="plan-routes">
      <div className="list plan-group routine-list plan-routines">
        {rows.map(r => <RoutineRow key={r.id} r={r} body={S.body}
          sub={[exCount(r.ex.length), daysOf(r.id).join(', ')].filter(Boolean).join(' · ')}
          onOpen={() => nav('/plan/r/' + r.id)} onMenu={() => routineMenu(r)}
          swipe={swipe && { copyLabel: t('Duplicate'), deleteName: t('Delete {0}', said(r.name)), copyName: nameIn(r.name, t('Duplicate')),
            onDelete: () => deleteRoutineWithUndo(r.id), onCopy: () => duplicateRoutine(r) }} />)}
        {!rows.length && <p className="item small" style={{ color: 'var(--label-2)' }}>{t('No routines here yet.')}</p>}
        <button type="button" className="item plan-new-here" onClick={() => newRoutine(update, nav, f.name)}>
          <span className="lrow-i"><Icon name="plus" /></span><span className="tt">{t('New routine in this folder')}</span>
        </button>
      </div>
    </div>
  </div>
}
