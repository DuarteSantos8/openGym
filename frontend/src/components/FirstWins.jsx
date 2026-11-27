// First wins on Home (EP25, lib/wins.js): for a Beginner, the five things worth being proud of
// in the first month, ticked as they happen. It goes away by itself once all five are in, and
// with the Motivation module like every other streak and badge.
import { t } from '../lib/i18n.js'
import { winsSummary } from '../lib/wins.js'
import Icon from './Icon.jsx'
import CardHead from './CardHead.jsx'
import '../views/onboarding.css'

// Literals inside t(), so check-source-strings.mjs sees them.
const WIN_COPY = {
  first: () => t('First workout logged'),
  'two-in-week': () => t('Two workouts in one week'),
  five: w => t('{0} workouts logged', w.n),
  'two-weeks': () => t('Two weeks in a row'),
  ten: w => t('{0} workouts logged', w.n),
}

export default function FirstWins({ S }) {
  const { done, total, wins } = winsSummary(S)
  if (done >= total) return null
  return <div className="card iv-wins" data-wins={done}>
    <CardHead icon="medal" tint="var(--yellow)" title={t('First wins')} sub={t('{0} of {1} done', done, total)} />
    <ul>
      {wins.map(w => <li key={w.id} className={w.done ? 'done' : ''} data-win={w.id}>
        <Icon name={w.done ? 'checkCircle' : 'dot'} aria-hidden="true" />
        <span>{WIN_COPY[w.id](w)}{w.done && <span className="vh"> ({t('Done')})</span>}</span>
      </li>)}
    </ul>
  </div>
}
