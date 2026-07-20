import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { WorkoutRow, workoutDetailSheet } from '../sheets.jsx'

export default function History() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  return <>
    <div className="hdr"><button className="iconbtn" onClick={() => nav('/stats')}>‹</button>
      <div style={{ flex: 1, marginLeft: 12 }}><h1>History</h1><div className="sub">{S.workouts.length} workouts</div></div></div>
    {S.workouts.length ? <div className="list">{[...S.workouts].reverse().map(w => <WorkoutRow key={w.id} w={w} onClick={() => workoutDetailSheet(w)} />)}</div>
      : <div className="empty"><div className="ico">🗂</div>No workouts yet.</div>}
  </>
}
