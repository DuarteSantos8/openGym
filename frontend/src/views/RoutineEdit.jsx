import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtNum, uid } from '../lib/format.js'
import { supersetUnits } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { emojiPicker, exercisePicker, exConfigSheet } from '../sheets.jsx'

// drop superset ids that no longer have an adjacent partner (after unlink/reorder)
function cleanupSg(ex) {
  ex.forEach((e, i) => {
    if (e.sg && !(ex[i - 1]?.sg === e.sg || ex[i + 1]?.sg === e.sg)) delete e.sg
  })
}

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  if (!r) return null

  const edit = fn => update(s => { fn(s.routines.find(x => x.id === id).ex) })
  const move = (i, dir) => edit(ex => { const j = i + dir; if (j < 0 || j >= ex.length) return;[ex[i], ex[j]] = [ex[j], ex[i]]; cleanupSg(ex) })
  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i], prev = ex[i - 1]
    if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
    else { const gid = prev.sg || ('sg' + uid()); prev.sg = gid; cur.sg = gid }
    cleanupSg(ex)
  })

  const units = supersetUnits(r.ex)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')}>‹</button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" defaultValue={r.name} style={{ fontWeight: 800, fontSize: '1.1rem' }}
          onChange={e => update(s => { s.routines.find(x => x.id === id).name = e.target.value.trim() || 'Routine' })} />
      </div>
      <button className="iconbtn" onClick={() => emojiPicker(r.emoji, emo => update(s => { s.routines.find(x => x.id === id).emoji = emo }))}>{r.emoji || '💪'}</button>
    </div>

    {r.ex.length ? <div className="list">{r.ex.map((e, i) => {
      const ex = EXIDX[e.id]; if (!ex) return null
      const linkedPrev = i > 0 && e.sg && r.ex[i - 1].sg === e.sg
      return <div key={i}>
        {unitFirst.has(i) && <div className="ss-label">🔗 Superset</div>}
        <div className={'item' + (inSS.has(i) ? ' in-ss' : '')} onClick={() => {
          exConfigSheet(ex, e, cfg => edit(x => { Object.assign(x[i], cfg) }), () => edit(x => { x.splice(i, 1); cleanupSg(x) }))
        }}>
          <Thumb ex={ex} />
          <div className="grow"><div className="tt">{ex.n}</div><div className="ss">{e.sets} × {e.reps}{e.weight ? ' · ' + fmtNum(e.weight) + ' ' + S.unit : ''}</div></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
            {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title="Superset with exercise above" style={{ width: 34, height: 28, fontSize: '.85rem' }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}>🔗</button>}
            <div style={{ display: 'flex', gap: 2 }}>
              <button className="iconbtn" style={{ width: 28, height: 26, fontSize: '.7rem' }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}>▲</button>
              <button className="iconbtn" style={{ width: 28, height: 26, fontSize: '.7rem' }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}>▼</button>
            </div>
          </div>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico">🏋️</div>No exercises yet — add your first one.</div>}

    <div className="small dim" style={{ margin: '10px 2px' }}>Tip: tap 🔗 on an exercise to superset it with the one above — you’ll do them back-to-back.</div>
    <button className="btn primary" onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) })))}>+ Add exercise</button>
    <div style={{ height: 10 }} />
    <button className="btn danger" onClick={() => {
      if (!confirm('Delete "' + r.name + '"?')) return
      update(s => {
        s.routines = s.routines.filter(x => x.id !== id)
        Object.keys(s.week).forEach(k => { if (s.week[k] === id) delete s.week[k] })
        Object.keys(s.dayPlan).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
      })
      nav('/plan')
    }}>Delete routine</button>
  </div>
}
