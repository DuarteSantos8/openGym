import { useState } from 'react'
import { useStore } from '../store/useStore.js'
import { EXDB, BODYPARTS } from '../lib/exercises.js'
import { bestWeightFor } from '../lib/history.js'
import { fmtNum } from '../lib/format.js'
import { Thumb } from '../components/Media.jsx'
import { exerciseDetailSheet, addToRoutineSheet } from '../sheets.jsx'

export default function Library() {
  const S = useStore(s => s.S)
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [shown, setShown] = useState(40)
  const ql = q.toLowerCase().trim()
  const f = EXDB.filter(e => (!bp || e.bp === bp) && (!ql || e.n.includes(ql) || e.tg.includes(ql) || e.eq.includes(ql)))

  return <>
    <div className="hdr"><div><h1>Exercises</h1><div className="sub">{EXDB.length} exercises with animations</div></div></div>
    <div className="search" style={{ marginBottom: 10 }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder="Search…" value={q} onChange={e => { setQ(e.target.value); setShown(40) }} /></div>
    <div className="chips" style={{ marginBottom: 12 }}>
      <button className={'chip' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(40) }}>All</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(40) }}>{b}</button>)}
    </div>
    <div className="list">
      {f.slice(0, shown).map(e => {
        const best = bestWeightFor(S, e.id)
        return <div key={e.id} className="item" onClick={() => exerciseDetailSheet(e)}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt">{e.n}</div><div className="ss">{(e.tg || e.bp)} · {e.eq}</div></div>
          {best > 0 && <span className="tag acc">{fmtNum(best)}</span>}
          <button className="btn sm primary" onClick={ev => { ev.stopPropagation(); addToRoutineSheet(e) }}>＋ Plan</button>
        </div>
      })}
      {f.length === 0 && <div className="empty">No match 🤷</div>}
    </div>
    {f.length > shown && <><div style={{ height: 10 }} /><button className="btn" onClick={() => setShown(s => s + 40)}>Show more</button></>}
  </>
}
