import { describe, expect, it } from 'vitest'
import {
  addCategory, addContainer, addCustomUnit, moveMeal, removeCategory,
  removeContainer, removeCustomUnit, removeMeal, setMealName, waterToMl,
} from './settings-lists.js'

describe('water containers', () => {
  it('converts the unit you typed to whole ml', () => {
    expect(waterToMl(16, 'oz')).toBe(473)
    expect(waterToMl(1.5, 'L')).toBe(1500)
    expect(waterToMl(0.25, 'G')).toBe(946)
    expect(waterToMl(330, 'ml')).toBe(330)
  })

  it('adds one with a fresh id and cleans what is stored to the hub\'s fields', () => {
    const stored = [{ id: 1, name: 'Mug', volumeMl: 300, color: 'red' }]
    expect(addContainer(stored, { name: ' Bottle ', amount: 500, unit: 'ml' }, 1700)).toEqual({
      list: [{ id: '1', name: 'Mug', volumeMl: 300 }, { id: '1700', name: 'Bottle', volumeMl: 500 }],
    })
  })

  it('refuses a missing name, a volume outside 1 to 10000 ml, and a 21st', () => {
    expect(addContainer([], { name: '  ', amount: 500, unit: 'ml' })).toEqual({ error: 'name' })
    expect(addContainer([], { name: 'x'.repeat(41), amount: 500, unit: 'ml' })).toEqual({ error: 'name' })
    expect(addContainer([], { name: 'Bottle', amount: null, unit: 'ml' })).toEqual({ error: 'volume' })
    expect(addContainer([], { name: 'Bottle', amount: 0.2, unit: 'ml' })).toEqual({ error: 'volume' })
    expect(addContainer([], { name: 'Tank', amount: 11, unit: 'L' })).toEqual({ error: 'volume' })
    const full = Array.from({ length: 20 }, (_, i) => ({ id: String(i), name: 'c', volumeMl: 100 }))
    expect(addContainer(full, { name: 'Bottle', amount: 500, unit: 'ml' })).toEqual({ error: 'full' })
  })

  it('removes by id', () => {
    expect(removeContainer([{ id: '1', name: 'a', volumeMl: 1 }, { id: '2', name: 'b', volumeMl: 2 }], '1')).toEqual([{ id: '2', name: 'b', volumeMl: 2 }])
  })
})

describe('categories', () => {
  it('stores a name alone as a string and a labelled one as { name, label }', () => {
    expect(addCategory([], { name: ' Dairy ', label: '' }).list).toEqual(['Dairy'])
    expect(addCategory(['Dairy'], { name: 'Fruit', label: ' 🍎 ' }).list).toEqual(['Dairy', { name: 'Fruit', label: '🍎' }])
  })

  it('cleans a stored entry to a name or { name, label }', () => {
    expect(addCategory([{ name: 'Veg', label: '', id: 4 }, { name: 'Fish', label: '🐟', emoji: 'x' }], { name: 'Meat', label: '' }).list)
      .toEqual(['Veg', { name: 'Fish', label: '🐟' }, 'Meat'])
  })

  it('refuses an empty or repeated name, a long label and a 101st', () => {
    expect(addCategory([], { name: ' ', label: '' })).toEqual({ error: 'name' })
    expect(addCategory(['Dairy'], { name: 'Dairy', label: '' })).toEqual({ error: 'duplicate' })
    expect(addCategory([{ name: 'Dairy', label: '🥛' }], { name: 'Dairy', label: '' })).toEqual({ error: 'duplicate' })
    expect(addCategory([], { name: 'Dairy', label: 'x'.repeat(17) })).toEqual({ error: 'label' })
    expect(addCategory(Array.from({ length: 100 }, (_, i) => 'c' + i), { name: 'More', label: '' })).toEqual({ error: 'full' })
  })

  it('removes by name whichever shape it is stored in', () => {
    expect(removeCategory(['A', { name: 'B', label: '🅱' }, 'C'], 'B')).toEqual(['A', 'C'])
  })
})

describe('custom units', () => {
  it('stores { abbr, full } with the full name defaulting to the abbreviation', () => {
    expect(addCustomUnit([], { abbr: ' shot ', full: ' shot glass ' }).list).toEqual([{ abbr: 'shot', full: 'shot glass' }])
    expect(addCustomUnit([], { abbr: 'scoop', full: '' }).list).toEqual([{ abbr: 'scoop', full: 'scoop' }])
  })

  it('cleans a stored unit to { abbr, full }', () => {
    expect(addCustomUnit([{ abbr: 'stick', grams: 8 }], { abbr: 'pinch', full: '' }).list)
      .toEqual([{ abbr: 'stick', full: 'stick' }, { abbr: 'pinch', full: 'pinch' }])
  })

  it('refuses a built-in unit, a repeat in any case, and a long abbreviation or name', () => {
    expect(addCustomUnit([], { abbr: 'ML', full: '' })).toEqual({ error: 'builtin' })
    expect(addCustomUnit([], { abbr: 'fl oz', full: '' })).toEqual({ error: 'builtin' })
    expect(addCustomUnit([{ abbr: 'Shot', full: 'x' }], { abbr: 'shot', full: '' })).toEqual({ error: 'duplicate' })
    expect(addCustomUnit([], { abbr: '', full: 'x' })).toEqual({ error: 'abbr' })
    expect(addCustomUnit([], { abbr: 'x'.repeat(17), full: '' })).toEqual({ error: 'abbr' })
    expect(addCustomUnit([], { abbr: 'x', full: 'y'.repeat(61) })).toEqual({ error: 'full' })
  })

  it('removes by abbreviation', () => {
    expect(removeCustomUnit([{ abbr: 'a', full: 'A' }, { abbr: 'b', full: 'B' }], 'a')).toEqual([{ abbr: 'b', full: 'B' }])
  })
})

describe('meal names', () => {
  const names = ['Breakfast', 'Lunch', 'Dinner']

  it('renames, adds at the end, moves and removes, keeping the rest in order', () => {
    expect(setMealName(names, 1, ' Brunch ').list).toEqual(['Breakfast', 'Brunch', 'Dinner'])
    expect(setMealName(names, 3, 'Supper').list).toEqual([...names, 'Supper'])
    expect(moveMeal(names, 2, -1).list).toEqual(['Breakfast', 'Dinner', 'Lunch'])
    expect(moveMeal(names, 0, 1).list).toEqual(['Lunch', 'Breakfast', 'Dinner'])
    expect(removeMeal(names, 0).list).toEqual(['Lunch', 'Dinner'])
  })

  it('keeps at least one meal, at most twelve, and a name of 1 to 40 characters', () => {
    expect(removeMeal(['Only'], 0)).toEqual({ error: 'last' })
    expect(setMealName(names, 1, '  ')).toEqual({ error: 'name' })
    expect(setMealName(names, 1, 'x'.repeat(41))).toEqual({ error: 'name' })
    expect(setMealName(Array.from({ length: 12 }, (_, i) => 'm' + i), 12, 'More')).toEqual({ error: 'full' })
    expect(moveMeal(names, 0, -1)).toEqual({ error: 'slot' })
    expect(moveMeal(names, 2, 1)).toEqual({ error: 'slot' })
  })
})
