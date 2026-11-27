import Icon from './Icon.jsx'
import { muscleHeadLabel } from '../lib/exercises.js'

// The header over a bucket of a search's results (lib/exercises.js muscleGroups): what mainly
// trains the muscle, what works it on the side, and the rest, each with its own small glyph.
const ICON = { main: 'target', also: 'plus', other: 'magnifier' }

export default function MuscleHead({ kind, name }) {
  return <h4 className={'sec muscle-label muscle-label-' + kind}><Icon name={ICON[kind] || ICON.other} />{muscleHeadLabel(kind, name)}</h4>
}
