import { isCustomEx } from '../lib/exercises.js'
import { mediaOf, cleanUrl } from '../lib/media-refs.js'
import { t } from '../lib/i18n.js'
import { nameIn } from '../lib/a11y-name.js'
import { exerciseNameText } from '../lib/format.js'
import { Thumb } from './Media.jsx'
import Icon from './Icon.jsx'

// Whether an exercise has anything for the workout's media slot to show: the dataset's animation
// for a built-in, its own photo, video or link for a custom one (CustomMedia.jsx).
export const hasWorkoutMedia = ex => !!ex && (isCustomEx(ex) ? !!(mediaOf(ex) || cleanUrl(ex.url)) : !!ex.gif)

// The small picture next to the exercise name when animations are set to Small (v1.3.11): the
// sets get the screen, and a tap brings the full animation back (the same gifSize switch as the
// animation's own Minimize, so it sticks like that one does).
// `dense`: the compact layout's smaller still, whose tap opens How to do it instead.
export default function WorkoutThumb({ ex, onExpand, dense = false, sayAs }) {
  const label = dense ? t('How to do it') : t('Expand')
  // The list views show one per exercise, so the name says whose it is (P4).
  return <button type="button" className={'wthumb' + (dense ? ' dense' : '')} aria-label={nameIn(sayAs || exerciseNameText(ex), label)} title={label} onClick={onExpand}>
    <Thumb ex={ex} />
    {!dense && <span className="wthumb-x" aria-hidden="true"><Icon name="expand" /></span>}
  </button>
}
