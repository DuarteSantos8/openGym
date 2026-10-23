import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { exOr } from '../lib/exercises.js'
import { exerciseNameText } from '../lib/format.js'
import { exerciseChips } from '../lib/exercise-chips.js'
import { revealChip } from '../lib/use-sheet-keyboard.js'
import { t } from '../lib/i18n.js'
import { sectionColor, sectionLabel } from '../lib/workout-sections.js'

// The chip row at the top of a running workout (#323, the "coloured dots" of #163): one numbered
// chip per exercise, a superset as one chip, filled as far as it is done (empty, half, full), so
// the state reads without the colour too. The current one wears the accent ring. A tap jumps
// there; what "there" means is the view's call (onPick), since Cards, List and Focus each go to
// an exercise differently.
//
// The row has one fixed height whatever happens in it, so ticking a set or typing a weight never
// moves the page under your thumb, and it scrolls sideways on its own (the .chips strip rules in
// index.css), never the page.
// Functions, so each word is a literal t() call the string checks can see.
const STATE_WORD = { done: () => t('Finished'), partial: () => t('Started'), todo: () => t('Not started yet'), skipped: () => t('Skipped') }

export default function WorkoutChips({ entries, sections = [], cur, onPick }) {
  const strip = useRef(null)
  const chips = exerciseChips(entries, cur)
  const phases = chips.map(chip => {
    const entry = entries[chip.unit[0]]
    return (sections || []).find(section => section.id === entry.sectionId) || entry.section
  })
  const curKey = chips.find(c => c.current)?.key
  // Keep the current chip in view along the strip, as the filter strips do (useRevealActiveChip):
  // after a tap, a swipe to the next card, or the marker moving on. Only the strip scrolls.
  useEffect(() => {
    const el = strip.current
    const chip = el?.querySelector?.('[aria-current]')
    if (chip) revealChip(el, chip)
  }, [curKey, chips.length])
  if (!chips.length) return null
  return <nav ref={strip} className={'chips wchips' + (phases.some(Boolean) ? ' has-phases' : '')} aria-label={t('Exercises in this workout')}>
    {chips.map((c, index) => {
      const phase = phases[index]
      const continues = !!phase?.id && phases[index + 1]?.id === phase.id
      const names = c.unit.map(idx => exerciseNameText(exOr(entries[idx].id))).join(' + ')
      const label = c.unit.length > 1
        ? t('Superset {0}: {1} ({2})', c.n, names, STATE_WORD[c.state]())
        : t('Exercise {0}: {1} ({2})', c.n, names, STATE_WORD[c.state]())
      return <button key={c.key} type="button" className={'wchip ' + c.state + (c.current ? ' cur' : '')}
        data-unit-key={c.key} aria-current={c.current ? 'step' : undefined} aria-label={phase ? label + ' · ' + sectionLabel(phase, t) : label} title={names}
        onClick={() => onPick(c)}>
        <span>{c.n}</span>{c.unit.length > 1 && <Icon name="link" />}
        {phase && <span className={'wchip-phase' + (continues ? ' continues' : '')} aria-hidden="true"
          data-phase-id={phase.id} style={{ '--phase-color': sectionColor(phase) }} />}
      </button>
    })}
  </nav>
}
