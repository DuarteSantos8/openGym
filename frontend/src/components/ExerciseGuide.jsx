// Form guidance on the exercise sheet (EP23): what to think about, what usually goes wrong, where
// you should feel it, how to breathe, and the way to an easier or a harder version. Shown only
// for an exercise that has a guide (content/exercise-guides.js); every other sheet is unchanged.
//
// Loaded on demand from sheets.jsx, so the text is not in the app's first download.
import { lazy, Suspense } from 'react'
import { t, hasTranslation, getLang, baseLang, exerciseNameFor, exerciseNameClass } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { guideFor, ladderFor, isReviewed } from '../lib/exercise-guide.js'
import { hasPose } from './mannequin/poses.js'
import { Button } from './ui.jsx'
import '../views/onboarding.css'

// The movement demo for the guide's pattern (EP26-T01): the rig when the device can show it, and
// a still key pose with the words that go with it when it cannot. Loaded on demand, so the 3D
// code and the poses stay out of the app's first download.
const MannequinDemo = lazy(() => import('./mannequin/MannequinDemo.jsx'))

export default function ExerciseGuide({ ex, onOpen }) {
  const g = guideFor(ex?.id)
  if (!g) return null
  const { easier, harder } = ladderFor(ex.id, id => !exOr(id).missing)
  const hasEnglishText = baseLang(getLang()) !== 'en' &&
    [...g.cues, ...g.mistakes.flat(), g.feel, g.breathing].some(line => !hasTranslation(line))
  const rung = (id, label) => {
    const other = exOr(id)
    return <Button variant="tinted" className="iv-guide-rung" data-rung={id} onClick={() => onOpen?.(other)}>
      <span>{label}</span> <span className={exerciseNameClass(other)}>{exerciseNameFor(other)}</span>
    </Button>
  }
  return <div className="iv-guide" data-guide={ex.id}>
    <h4 className="sec">{t('Do it well')}{hasEnglishText && <span className="dim" style={{ textTransform: 'none', letterSpacing: 0 }}> · {t('instructions in English')}</span>}</h4>
    <ul className="iv-guide-cues">{g.cues.map((c, i) => <li key={i}>{t(c)}</li>)}</ul>

    {hasPose(g.pattern) && <Suspense fallback={null}>
      <MannequinDemo key={g.pattern} pattern={g.pattern} />
    </Suspense>}

    <h4 className="sec">{t('Common mistakes')}</h4>
    <ul className="iv-guide-mistakes">
      {g.mistakes.map(([wrong, fix], i) => <li key={i}>
        <span className="iv-guide-wrong">{t(wrong)}</span>
        <span className="iv-guide-fix">{t(fix)}</span>
      </li>)}
    </ul>

    <dl className="iv-guide-facts">
      <dt>{t('Where you should feel it')}</dt><dd>{t(g.feel)}</dd>
      <dt>{t('Breathing')}</dt><dd>{t(g.breathing)}</dd>
    </dl>

    {(easier || harder) && <div className="iv-guide-ladder">
      {easier && rung(easier, t('Easier:'))}
      {harder && rung(harder, t('Harder:'))}
    </div>}

    <p className="small dim iv-guide-foot">
      {isReviewed(g) ? t('Reviewed by {0}.', g.reviewer) + ' ' : ''}{t('General guidance. Stop if something hurts.')}
    </p>
  </div>
}
