import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { ACCENTS } from './lib/format.js'
import { setNav } from './lib/nav.js'
import { startFlow } from './sheets.jsx'
import TabBar from './components/TabBar.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Settings from './views/Settings.jsx'

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = theme === 'light' ? 'light' : 'dark'
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f4f7' : '#0c0e12'
}

function Shell() {
  const navigate = useNavigate()
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])

  const authed = user || isGuest
  if (!ready && !authed) return <div id="app"><div style={{ paddingTop: '42vh', textAlign: 'center', fontSize: '2.2rem' }}>🏋️</div></div>

  return (
    <>
      <div id="app" className="vfade" key={location.hash}>
        {!authed ? <Login /> : (
          <Routes>
            <Route path="/home" element={<Home />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/plan/r/:id" element={<RoutineEdit />} />
            <Route path="/workout" element={<Workout />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/history" element={<History />} />
            <Route path="/library" element={<Library />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/home" replace />} />
          </Routes>
        )}
      </div>
      <TabBar onStart={startFlow} />
      <RestTimer />
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
