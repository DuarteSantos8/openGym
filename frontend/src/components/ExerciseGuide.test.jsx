// @vitest-environment happy-dom
// Form guidance on the exercise sheet (EP23).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExerciseGuide from './ExerciseGuide.jsx'
import { EXIDX } from '../lib/exercises.js'
import { _setLangState } from '../lib/i18n-core.js'
import de from '../locales/de.js'
import { guideFor } from '../lib/exercise-guide.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, container
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); root = container = null })
function mount(node) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(node))
}

describe('ExerciseGuide', () => {
  it('shows cues, mistakes with their fixes, where to feel it and how to breathe', () => {
    mount(<ExerciseGuide ex={EXIDX['1760']} />)
    const g = guideFor('1760')
    expect(container.querySelectorAll('.iv-guide-cues li').length).toBe(g.cues.length)
    const first = container.querySelector('.iv-guide-mistakes li')
    expect(first.querySelector('.iv-guide-wrong').textContent).toBe(g.mistakes[0][0])
    expect(first.querySelector('.iv-guide-fix').textContent).toBe(g.mistakes[0][1])
    const facts = [...container.querySelectorAll('.iv-guide-facts dd')].map(x => x.textContent)
    expect(facts).toEqual([g.feel, g.breathing])
    expect(container.querySelector('.iv-guide-foot').textContent).toBe('General guidance. Stop if something hurts.')
  })

  it('labels English instructions only when the current locale lacks guide text', () => {
    _setLangState('de', de, null, null)
    try {
      mount(<ExerciseGuide ex={EXIDX['0652']} />)
      expect(container.querySelector('.iv-guide-cues li').textContent).toBe(de[guideFor('0652').cues[0]])
      expect(container.textContent).not.toContain(de['instructions in English'])
      act(() => root.render(<ExerciseGuide ex={EXIDX['1760']} />))
      expect(container.textContent).toContain(de['instructions in English'])
    } finally {
      _setLangState('en', {}, null, null)
    }
  })

  it('offers the easier and the harder version by name and opens the one tapped', () => {
    const onOpen = vi.fn()
    mount(<ExerciseGuide ex={EXIDX['1760']} onOpen={onOpen} />)
    const rungs = [...container.querySelectorAll('[data-rung]')]
    expect(rungs.map(r => r.dataset.rung)).toEqual(['1197', '0043'])
    expect(rungs[0].textContent).toContain('Easier:')
    expect(rungs[0].textContent.toLowerCase()).toContain('squat')
    expect(rungs[1].textContent).toContain('Harder:')
    act(() => rungs[1].click())
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].id).toBe('0043')
  })

  it('shows no ladder where there is none', () => {
    mount(<ExerciseGuide ex={EXIDX['0294']} />)
    expect(container.querySelector('.iv-guide')).toBeTruthy()
    expect(container.querySelector('.iv-guide-ladder')).toBe(null)
  })

  it('never calls a draft reviewed', () => {
    mount(<ExerciseGuide ex={EXIDX['0025']} />)
    expect(container.textContent).not.toContain('Reviewed by')
  })

  it('renders nothing for an exercise without a guide, or for none at all', () => {
    const unguided = Object.values(EXIDX).find(e => !guideFor(e.id))
    mount(<ExerciseGuide ex={unguided} />)
    expect(container.innerHTML).toBe('')
    act(() => root.render(<ExerciseGuide ex={null} />))
    expect(container.innerHTML).toBe('')
  })
})
