import { t } from '../../lib/i18n.js'
import { useOnboarding } from '../../lib/onboarding/contexts.js'
import { nextIsDone } from '../../lib/onboarding/flow.js'
import { Button } from '../ui.jsx'

// About you's Next, off until the picker is touched. On the last step of a detour it says Done:
// it goes back to the end, not on to Training. Saves the body answers on the way.
export default function NextButton({ screen, ready }) {
  const { state, saveHubStep, next } = useOnboarding()
  return (
    <Button variant="primary" disabled={!ready} onClick={() => { saveHubStep('body'); next(screen) }}>
      {nextIsDone(screen, state.detour) ? t('Done') : t('Next')}
    </Button>
  )
}
