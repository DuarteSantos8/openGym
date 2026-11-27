import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Switches exercise lists between rows and picture cards. Pickers keep it beside Search; the
// approved Library places its labelled variant under More. The icon-only button is a toggle named
// "Cards" with aria-pressed. The labelled one names the action it takes (Cards or List), so it
// carries no pressed state: "List, pressed" would announce a mode that is not on.
export default function ExerciseViewToggle({ showLabel = false }) {
  const cards = useStore(s => s.S.exerciseView === 'cards')
  const update = useStore(s => s.update)
  const action = cards ? t('List') : t('Cards')
  return <button className={'iconbtn ex-view-btn' + (cards ? ' on' : '') + (showLabel ? ' with-label' : '')} aria-label={showLabel ? action : t('Cards')} aria-pressed={showLabel ? undefined : cards}
    onClick={() => update(s => { s.exerciseView = cards ? 'list' : 'cards' })}><Icon name="grid" />{showLabel && <span>{action}</span>}</button>
}
