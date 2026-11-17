// "Still training?" and "Looks like you left the gym" (lib/forgotten-phone.js, which opens and
// closes this card): the in-app side of Settings → Workout → Forgotten workouts.
import { t } from '../lib/i18n.js'
import { keepGoing, finishFromPrompt, discardFromPrompt } from '../lib/forgotten-phone.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

export function ForgottenPrompt({ state, deadline, copy, clock, close }) {
  const left = state === 'left'
  const act = fn => () => { close?.(); fn() }
  return <div className="fgt" data-forgotten={state} role="alertdialog" aria-labelledby="fgt-t" aria-describedby="fgt-s">
    <div className="fgt-i" aria-hidden="true"><Icon name={left ? 'mapPin' : 'clock'} /></div>
    <h3 id="fgt-t">{left ? copy.leftTitle : copy.askTitle}</h3>
    <p id="fgt-s" className="fgt-s">
      {left ? t('Finish the workout now? Otherwise it ends by itself at {0}.', clock(deadline))
        : t('Nothing logged for a while. If you’re done, it ends by itself at {0}, saved at your last set.', clock(deadline))}
    </p>
    <div className="fgt-b">
      {left
        ? <>
          <Button variant="primary" icon="flag" onClick={act(finishFromPrompt)}>{copy.finishNow}</Button>
          <Button variant="tinted" onClick={act(() => keepGoing())}>{copy.keep}</Button>
          <Button variant="plain" className="danger" onClick={act(discardFromPrompt)}>{copy.discard}</Button>
        </>
        : <>
          <Button variant="primary" onClick={act(() => keepGoing())}>{copy.keep}</Button>
          <Button variant="tinted" icon="flag" onClick={act(finishFromPrompt)}>{copy.finish}</Button>
        </>}
    </div>
  </div>
}

/** For lib/forgotten-phone.js: opens the card over whatever is on screen. */
export const openForgottenPrompt = useUI => props =>
  useUI.getState().openSheet(close => <ForgottenPrompt {...props} close={close} />, { kind: 'center' })
