import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { EXIDX } from '../lib/exercises.js'
import { fmtNum } from '../lib/format.js'
import { Thumb } from '../components/Media.jsx'
import { emojiPicker, exercisePicker, exConfigSheet } from '../sheets.jsx'

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = S.routines.find(x => x.id === id)
  useEffect(() => { if (!r) nav('/plan') }, [!!r])
  if (!r) return null

  const move = (i, dir) => update(s => {
    const ex = s.routines.find(x => x.id === id).ex
    const j = i + dir
    if (j < 0 || j >= ex.length) return
    ;[ex[i], ex[j]] = [ex[j], ex[i]]
  })

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
      return <div key={i} className="item" onClick={() => {
        exConfigSheet(ex, e, cfg => update(s => { Object.assign(s.routines.find(x => x.id === id).ex[i], cfg) }),
          () => update(s => { s.routines.find(x => x.id === id).ex.splice(i, 1) }))
      }}>
        <Thumb ex={ex} />
        <div className="grow"><div className="tt">{ex.n}</div><div className="ss">{e.sets} × {e.reps}{e.weight ? ' · ' + fmtNum(e.weight) + ' ' + S.unit : ''}</div></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none' }}>
          <button className="iconbtn" style={{ width: 34, height: 30, fontSize: '.8rem' }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}>▲</button>
          <button className="iconbtn" style={{ width: 34, height: 30, fontSize: '.8rem' }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}>▼</button>
        </div>
      </div>
    })}</div> : <div className="empty"><div className="ico">🏋️</div>No exercises yet — add your first one.</div>}

    <div style={{ height: 10 }} />
    <button className="btn primary" onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => update(s => { s.routines.find(x => x.id === id).ex.push({ id: ex.id, ...cfg }) })))}>+ Add exercise</button>
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
