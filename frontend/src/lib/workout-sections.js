// Shared read contract is packaged with both the web build and standalone Coach API.
import { SECTION_PRESETS, cleanSection, cleanSections, sectionFields, sameSection, validOccurrenceId } from '../../../api/coach/core/workout-sections.js'
import { uid } from './format.js'
export * from '../../../api/coach/core/workout-sections.js'
const newId = uid
const rowsOf = container => container?.ex || container?.entries || []

export const SECTION_COLORS = [
  ['Amber', '#ffb340'], ['Teal', '#45c9b0'], ['Blue', '#6da9ff'], ['Violet', '#b59bff'],
  ['Cyan', '#60cde3'], ['Pink', '#ef91b7'], ['Orange', '#ef986b'], ['Grey', '#a7adb7'],
]
const colorByType = { warmup: 0, mobility: 1, work: 2, accessory: 3, cooldown: 4, stretch: 5, custom: 7 }
export const sectionColor = section => /^#[0-9a-f]{6}$/i.test(section?.color || '')
  ? section.color : SECTION_COLORS[colorByType[section?.type] ?? 7][1]

// Only editable routines/sessions are synchronised. Finished records keep their snapshots.
export function syncSections(container) {
  if (container?.sections != null) container.sections = cleanSections(container.sections)
  if (!container?.sections?.length) return
  const rows = rowsOf(container)
  const current = rows[container.cur]
  const seen = new Set()
  for (const entry of rows) {
    const section = container.sections.find(s => s.id === entry.sectionId) || container.sections.at(-1)
    entry.sectionId = section.id
    entry.section = { ...section }
    if (!validOccurrenceId(entry.occurrenceId) || seen.has(entry.occurrenceId)) entry.occurrenceId = newId()
    seen.add(entry.occurrenceId)
    if (entry.target) Object.assign(entry.target, sectionFields(entry, container))
  }
  const rank = new Map(container.sections.map((s, i) => [s.id, i]))
  rows.sort((a, b) => rank.get(a.sectionId) - rank.get(b.sectionId))
  if (current) container.cur = rows.indexOf(current)
}

export function addSection(container, preset) {
  const section = cleanSection({ ...preset, id: newId() })
  if ((container.sections?.length || 0) >= 50) throw new Error('Too many workout phases')
  if (!container.sections?.length) {
    container.sections = []
    if (rowsOf(container).length) {
      const main = { ...SECTION_PRESETS[2], id: newId() }
      container.sections.push(main)
      rowsOf(container).forEach(e => { e.sectionId = main.id })
    }
  }
  container.sections.push(section)
  syncSections(container)
  return section.id
}

export function updateSection(container, id, patch) {
  const index = container.sections?.findIndex(s => s.id === id) ?? -1
  if (index < 0) return false
  container.sections[index] = cleanSection({ ...container.sections[index], ...patch, id })
  syncSections(container)
  return true
}

export function moveSection(container, id, direction) {
  const index = container.sections?.findIndex(s => s.id === id) ?? -1
  const next = index + direction
  if (index < 0 || ![-1, 1].includes(direction) || next < 0 || next >= container.sections.length) return false
  ;[container.sections[index], container.sections[next]] = [container.sections[next], container.sections[index]]
  syncSections(container)
  return true
}

export function reorderSection(container, id, targetId) {
  const from = container.sections?.findIndex(section => section.id === id) ?? -1
  const to = container.sections?.findIndex(section => section.id === targetId) ?? -1
  if (from < 0 || to < 0 || from === to) return false
  const [section] = container.sections.splice(from, 1)
  container.sections.splice(to, 0, section)
  syncSections(container)
  return true
}

export function assignSection(container, occurrenceId, sectionId) {
  const rows = rowsOf(container), entry = rows.find(e => e.occurrenceId === occurrenceId)
  if (!entry || !container.sections?.some(s => s.id === sectionId)) return false
  const index = rows.indexOf(entry)
  let first = index, last = index
  if (entry.sg) {
    while (first > 0 && rows[first - 1].sg === entry.sg && sameSection(rows[first - 1], entry)) first--
    while (last + 1 < rows.length && rows[last + 1].sg === entry.sg && sameSection(rows[last + 1], entry)) last++
  }
  rows.slice(first, last + 1).forEach(e => { e.sectionId = sectionId })
  syncSections(container)
  return true
}

export function removeSection(container, id, destination) {
  if (!container.sections?.some(s => s.id === id)) return false
  const remaining = container.sections.filter(s => s.id !== id)
  if (remaining.length && !remaining.some(s => s.id === destination)) return false
  container.sections = remaining
  for (const entry of rowsOf(container)) {
    if (remaining.length) { if (entry.sectionId === id) entry.sectionId = destination }
    else {
      delete entry.sectionId; delete entry.section
      if (entry.target) { delete entry.target.sectionId; delete entry.target.section }
    }
  }
  if (!remaining.length) delete container.sections
  else syncSections(container)
  return true
}

export function remapSections(container) {
  if (!container.sections?.length) return container
  const ids = new Map(container.sections.map(s => [s.id, newId()]))
  container.sections.forEach(s => { s.id = ids.get(s.id) })
  rowsOf(container).forEach(e => { e.sectionId = ids.get(e.sectionId); e.occurrenceId = newId(); delete e.section })
  syncSections(container)
  return container
}
