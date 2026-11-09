// @vitest-environment happy-dom
// The library's muscle and equipment sheets: tiles to pick one or several, the count the choice
// leaves on the button, Clear, and nothing changing until a choice is applied.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MuscleFilterSheet, EquipFilterSheet, equipLabel } from './FilterSheets.jsx'
import { MUSCLE_GROUPS, EQUIP_GROUPS } from '../lib/exercise-filters.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const tile = label => [...host.querySelectorAll('.fs-tile')].find(b => b.querySelector('.fs-name').textContent === label)
const press = el => act(() => el.click())

function mount(node) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(node))
}
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('MuscleFilterSheet', () => {
  let onApply, close
  const count = vi.fn(sel => 100 + sel.length)
  beforeEach(() => { onApply = vi.fn(); close = vi.fn(); count.mockClear() })
  const open = (selected = [], counts = {}) => mount(<MuscleFilterSheet selected={selected} counts={counts} count={count} body="male" onApply={onApply} close={close} />)

  it('lists every muscle under its group, upper body first', () => {
    open()
    expect([...host.querySelectorAll('.fs-sec')].map(h => h.textContent)).toEqual(['Upper body', 'Lower body', 'Other'])
    expect(host.querySelectorAll('.fs-tile')).toHaveLength(MUSCLE_GROUPS.flatMap(g => g.ids).length)
    expect(tile('Chest')).toBeTruthy()
    expect(tile('Quads')).toBeTruthy()
  })

  it('shows the count a choice leaves on the button, and applies several muscles at once', () => {
    open()
    expect(host.querySelector('.fs-show').textContent).toBe('Show results (100)')
    press(tile('Chest'))
    press(tile('Triceps'))
    expect(tile('Chest').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.fs-show').textContent).toBe('Show results (102)')
    expect(onApply).not.toHaveBeenCalled()   // nothing changes until it is applied
    press(host.querySelector('.fs-show'))
    expect(onApply).toHaveBeenCalledWith(['chest', 'triceps'])
    expect(close).toHaveBeenCalled()
  })

  it('a second tap takes a muscle off again', () => {
    open(['chest'])
    expect(tile('Chest').getAttribute('aria-pressed')).toBe('true')
    press(tile('Chest'))
    expect(tile('Chest').getAttribute('aria-pressed')).toBe('false')
  })

  it('Clear applies an empty choice and closes', () => {
    open(['chest'])
    press(host.querySelector('.fs-clear'))
    expect(onApply).toHaveBeenCalledWith([])
    expect(close).toHaveBeenCalled()
  })

  it('dims a muscle the search leaves nothing under, but keeps its tile', () => {
    open([], { chest: 12 })
    expect(tile('Chest').classList.contains('zero')).toBe(false)
    expect(tile('Quads').classList.contains('zero')).toBe(true)
    expect(tile('Quads')).toBeTruthy()
  })

  it('draws a muscle from behind only when it is a back one', () => {
    open()
    expect(tile('Triceps').querySelector('.fs-fig').classList.contains('back')).toBe(true)
    expect(tile('Chest').querySelector('.fs-fig').classList.contains('front')).toBe(true)
  })
})

describe('EquipFilterSheet', () => {
  it('has one tile per group, named in the language on screen', () => {
    mount(<EquipFilterSheet selected={[]} counts={{}} count={() => 0} onApply={vi.fn()} close={vi.fn()} />)
    expect(host.querySelectorAll('.fs-tile')).toHaveLength(EQUIP_GROUPS.length)
    expect([...host.querySelectorAll('.fs-name')].map(n => n.textContent)).toEqual(EQUIP_GROUPS.map(g => equipLabel(g.id)))
    expect(equipLabel('barbell')).toBe('Barbell')
    expect(equipLabel('none')).toBe('No equipment')
  })

  it('applies the chosen groups', () => {
    const onApply = vi.fn(), close = vi.fn()
    mount(<EquipFilterSheet selected={['dumbbell']} counts={{ dumbbell: 5, barbell: 5 }} count={s => s.length} onApply={onApply} close={close} />)
    press(tile('Barbell'))
    press(host.querySelector('.fs-show'))
    expect(onApply).toHaveBeenCalledWith(['dumbbell', 'barbell'])
  })
})
