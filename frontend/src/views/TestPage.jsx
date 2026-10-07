import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { BEN_PROFILE, BEN_GOAL_SHORT } from '../lib/ben-profile.js'
import { bodyweightTrend, strengthRetention, routineCoaching } from '../lib/ben-coach.js'
import { buildStarterPlan } from '../lib/starter.js'

function Check({ name, ok, detail }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'28px 1fr auto', gap:12, alignItems:'center', padding:'13px 15px', borderBottom:'1px solid var(--separator)' }}>
      <strong style={{ fontSize:18 }}>{ok ? '✓' : '!'}</strong>
      <div><div style={{ fontWeight:700 }}>{name}</div><div style={{ color:'var(--label-2)', fontSize:13, marginTop:3 }}>{detail}</div></div>
      <span style={{ fontSize:12, fontWeight:700, opacity:.7 }}>{ok ? 'PASS' : 'CHECK'}</span>
    </div>
  )
}

export default function TestPage() {
  const navigate = useNavigate()
  const { S, user, ready } = useStore()
  const [message, setMessage] = useState('')
  const [demoWeight, setDemoWeight] = useState(null)

  const checks = useMemo(() => {
    const plan = buildStarterPlan('benjamin-home')
    const routine = plan?.routines?.[0]
    const coaching = routine ? routineCoaching(S, routine, 3) : []
    const bw = bodyweightTrend(S)
    const strength = strengthRetention(S)
    return [
      ['Store booted', ready, ready ? 'Zustand store reports ready.' : 'Store is still booting.'],
      ['Profile', BEN_PROFILE.name === 'Benjamin', `${BEN_PROFILE.name} · ${BEN_PROFILE.frequency} sessions/week`],
      ['Home plan', !!plan && plan.routines?.length === 4, plan ? `${plan.routines?.length || 0} routines available · 3 scheduled` : 'Plan is missing.'],
      ['Home environment', BEN_PROFILE.environment === 'Home training', BEN_PROFILE.environment],
      ['Coach engine', typeof routineCoaching === 'function', coaching.length ? `${coaching.length} exercise recommendations generated` : 'No routine data available yet.'],
      ['Weight trend engine', ['baseline','down','up','steady'].includes(bw.status), bw.delta == null ? 'Waiting for two weekly averages.' : `${bw.delta.toFixed(2)} kg vs previous week`],
      ['Strength retention engine', ['baseline','holding','mixed','attention'].includes(strength.status), strength.compared ? `${strength.compared} exercise comparisons` : 'Waiting for enough history.'],
      ['GitHub Pages route', window.location.protocol === 'https:' || window.location.hostname === 'localhost', window.location.hash || 'Hash route active'],
    ]
  }, [S, ready])

  function runLocalTest() {
    try {
      const key = '__benOpenGym_test__'
      localStorage.setItem(key, 'ok')
      const value = localStorage.getItem(key)
      localStorage.removeItem(key)
      setDemoWeight(value === 'ok' ? 'Local storage works.' : 'Local storage returned an unexpected value.')
    } catch {
      setDemoWeight('Local storage is unavailable in this browser.')
    }
  }

  function resetNotice() {
    setMessage('')
    setDemoWeight(null)
  }

  return (
    <main style={{ maxWidth:760, margin:'0 auto', padding:'24px 16px 110px' }}>
      <div style={{ marginBottom:22 }}>
        <button onClick={() => navigate('/home')} style={{ marginBottom:18 }}>← Back to app</button>
        <div style={{ fontSize:12, fontWeight:800, letterSpacing:1.2, opacity:.6 }}>BENOPENGYM / TEST</div>
        <h1 style={{ margin:'8px 0 6px' }}>App Test</h1>
        <p style={{ margin:0, color:'var(--label-2)' }}>A smoke-test page for the GitHub Pages build and personal features.</p>
      </div>

      <section style={{ border:'1px solid var(--separator)', borderRadius:16, overflow:'hidden', marginBottom:16, background:'var(--secondary-background)' }}>
        {checks.map(([name, ok, detail]) => <Check key={name} name={name} ok={ok} detail={detail} />)}
      </section>

      <section style={{ padding:18, borderRadius:16, background:'var(--secondary-background)', border:'1px solid var(--separator)', marginBottom:16 }}>
        <div style={{ fontSize:12, fontWeight:800, opacity:.6, letterSpacing:1 }}>PROFILE</div>
        <h2 style={{ margin:'8px 0 6px' }}>{BEN_PROFILE.name}</h2>
        <div style={{ color:'var(--label-2)' }}>{BEN_GOAL_SHORT}</div>
        <div style={{ marginTop:14, display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <div><small>Frequency</small><div><b>{BEN_PROFILE.frequency}× / week</b></div></div>
          <div><small>Environment</small><div><b>{BEN_PROFILE.environment}</b></div></div>
        </div>
      </section>

      <section style={{ padding:18, borderRadius:16, background:'var(--secondary-background)', border:'1px solid var(--separator)' }}>
        <div style={{ fontSize:12, fontWeight:800, opacity:.6, letterSpacing:1 }}>MANUAL SMOKE TEST</div>
        <h2 style={{ margin:'8px 0 10px' }}>Open the important screens</h2>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2, minmax(0,1fr))', gap:10 }}>
          {[
            ['/home','Home'],
            ['/plan','Plan'],
            ['/stats','Progress / Stats'],
            ['/history','History'],
            ['/library','Exercise Library'],
            ['/settings','Settings'],
          ].map(([path,label]) => <button key={path} onClick={() => navigate(path)}>{label}</button>)}
        </div>
        <button onClick={runLocalTest} style={{ width:'100%', marginTop:10 }}>Test local storage</button>
        {demoWeight && <div style={{ marginTop:10, color:'var(--label-2)' }}>{demoWeight}</div>}
        <button onClick={() => { resetNotice(); setMessage(`Ready: ${user ? 'signed-in user' : 'guest'} · ${new Date().toLocaleTimeString()}`) }} style={{ width:'100%', marginTop:10 }}>Run quick check</button>
        {message && <div style={{ marginTop:10, color:'var(--label-2)' }}>{message}</div>}
      </section>
    </main>
  )
}
