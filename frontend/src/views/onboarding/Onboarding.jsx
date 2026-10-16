import { Navigate, Route, Routes } from 'react-router-dom'
import OnboardingLayout from '../../components/onboarding/OnboardingLayout.jsx'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { pathOf, resumeScreen } from '../../lib/onboarding/flow.js'
import { useStore } from '../../store/useStore.js'
import BornScreen from './BornScreen.jsx'
import FinishScreen from './FinishScreen.jsx'
import GoalScreen from './GoalScreen.jsx'
import HeightScreen from './HeightScreen.jsx'
import InviteScreen from './InviteScreen.jsx'
import NameScreen from './NameScreen.jsx'
import PasskeyScreen from './PasskeyScreen.jsx'
import PlanScreen from './PlanScreen.jsx'
import SexScreen from './SexScreen.jsx'
import StarterScreen from './StarterScreen.jsx'
import TrainingScreen from './TrainingScreen.jsx'
import WeightScreen from './WeightScreen.jsx'
import '../../onboarding.css'

// The first-run onboarding, a full-screen flow of its own (like Login and MobileOnboarding: no
// tab bar, no <Page>). The shell (App.jsx) hands it every /join and /onboarding route; the layout
// draws the one nav row, the thread and the screen frame for all of them.
//
//   /join/<code>  the invite landing (the hub's /join/<code> page sends the browser here)
//   /onboarding   resume at the first unanswered step
//   /onboarding/name, passkey, goal, sex, born, height, weight, training, plan, starter, finish
//
// `finish` is a PLACEHOLDER for the Summary (views/onboarding/FinishScreen.jsx).
// Where the hub says the person is, once it has answered: it knows what their data answers.
function Resume() {
  const { state, hub } = useOnboarding()
  const signedIn = useStore(s => !!s.user)
  if (!signedIn) return <Navigate to="/" replace />
  if (hub === 'loading') return null
  return <Navigate to={pathOf(resumeScreen(state.answers, state))} replace />
}

export default function Onboarding() {
  return (
    <OnboardingLayout>
      <Routes>
        <Route path="/join" element={<InviteScreen />} />
        <Route path="/join/:code" element={<InviteScreen />} />
        <Route path="/onboarding/name" element={<NameScreen />} />
        <Route path="/onboarding/passkey" element={<PasskeyScreen />} />
        <Route path="/onboarding/goal" element={<GoalScreen />} />
        <Route path="/onboarding/sex" element={<SexScreen />} />
        <Route path="/onboarding/born" element={<BornScreen />} />
        <Route path="/onboarding/height" element={<HeightScreen />} />
        <Route path="/onboarding/weight" element={<WeightScreen />} />
        <Route path="/onboarding/training" element={<TrainingScreen />} />
        <Route path="/onboarding/plan" element={<PlanScreen />} />
        <Route path="/onboarding/starter" element={<StarterScreen />} />
        <Route path="/onboarding/finish" element={<FinishScreen />} />
        <Route path="*" element={<Resume />} />
      </Routes>
    </OnboardingLayout>
  )
}
