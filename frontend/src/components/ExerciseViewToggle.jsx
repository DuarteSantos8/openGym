import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// The button beside the search field that switches the exercise lists (Library, picker, muscle
// explorer) between rows and picture cards. Not in the header: on a phone the Library header
// already leaves its title little room next to "By muscle" (Library.test.jsx), while the search
// row is full-width everywhere a list is, and sits right above the list it changes.
export default function ExerciseViewToggle() {
  const cards = useStore(s => s.S.exerciseView === 'cards')
  const update = useStore(s => s.update)
  return <button className={'iconbtn ex-view-btn' + (cards ? ' on' : '')} aria-label={t('Cards')} aria-pressed={cards}
    onClick={() => update(s => { s.exerciseView = cards ? 'list' : 'cards' })}><Icon name="grid" /></button>
}
