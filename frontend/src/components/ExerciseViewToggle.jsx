import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Switches exercise lists between rows and picture cards. Pickers keep it beside Search; the
// approved Library places its labelled variant under More. Default icon-only behavior elsewhere
// is unchanged; a visible Cards/List label also stays in sync with the accessible name.
export default function ExerciseViewToggle({ showLabel = false }) {
  const cards = useStore(s => s.S.exerciseView === 'cards')
  const update = useStore(s => s.update)
  const action = cards ? t('List') : t('Cards')
  return <button className={'iconbtn ex-view-btn' + (cards ? ' on' : '') + (showLabel ? ' with-label' : '')} aria-label={showLabel ? action : t('Cards')} aria-pressed={cards}
    onClick={() => update(s => { s.exerciseView = cards ? 'list' : 'cards' })}><Icon name="grid" />{showLabel && <span>{action}</span>}</button>
}
