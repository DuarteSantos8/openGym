import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid } from '../lib/format.js'
import { dayAssignSheet, loadStarterPlan } from '../sheets.jsx'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  const addRoutine = () => {
    const r = { id: uid(), name: 'New routine', emoji: '💪', ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  return <>
    <div className="hdr"><div><h1>Plan</h1><div className="sub">Your weekly routine</div></div></div>
    <div className="cols"><div>
      <h4 className="sec">Week schedule</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{DAYN[d]}</div></div>
            {r ? <span className="tag acc">{(r.emoji || '') + ' ' + r.name}</span> : <span className="tag">Rest</span>}
            <span className="chev">›</span></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>Routines</h4>
        <button className="btn sm primary" onClick={addRoutine}>+ New</button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <div style={{ fontSize: '1.5rem', flex: 'none' }}>{r.emoji || '💪'}</div>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{r.ex.length} exercises</div></div>
        <span className="chev">›</span></div>)}</div> : <>
        <div className="empty"><div className="ico">📋</div>No routines yet.<br />Create one or load the starter plan.</div>
        <button className="btn" onClick={loadStarterPlan}>Load starter plan (Push / Pull / Legs)</button>
      </>}
    </div></div>
  </>
}
