// Workout sections group whole exercises. They are independent of a set's warmup/work phase.
export const SECTION_PRESETS = [
  { type: 'warmup', label: 'Warm-up', countsAsWork: false },
  { type: 'mobility', label: 'Mobility', countsAsWork: false },
  { type: 'work', label: 'Main work', countsAsWork: true },
  { type: 'accessory', label: 'Accessory', countsAsWork: true },
  { type: 'cooldown', label: 'Cooldown', countsAsWork: false },
  { type: 'stretch', label: 'Stretching', countsAsWork: false },
]
export const sectionOf = (entry, container) => container?.sections?.find(s => s.id === entry?.sectionId)
  || entry?.section || entry?.target?.section || null
export const countsAsWork = (entry, container) => sectionOf(entry, container)?.countsAsWork !== false
export const sameSection = (a, b) => (a?.sectionId || '') === (b?.sectionId || '')
export const validOccurrenceId = id => typeof id === 'string' && !!id.trim() && id.length <= 100
// Translate only unchanged built-in names; a user's name stays exactly as entered.
export const sectionLabel = (section, translate) => SECTION_PRESETS.some(p => p.type === section.type && p.label === section.label)
  ? translate(section.label) : section.label

export function cleanSection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 100
    || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80
    || ![...SECTION_PRESETS.map(s => s.type), 'custom'].includes(value.type)
    || typeof value.countsAsWork !== 'boolean') throw new Error('Invalid workout phase')
  if (value.color !== undefined && (typeof value.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.color))) throw new Error('Invalid phase colour')
  return { id: value.id, type: value.type, label: value.label.trim(), countsAsWork: value.countsAsWork,
    ...(value.color !== undefined ? { color: value.color.toLowerCase() } : {}) }
}

export function cleanSections(values) {
  if (!Array.isArray(values) || values.length > 50) throw new Error('Invalid workout phases')
  const sections = values.map(cleanSection)
  if (new Set(sections.map(s => s.id)).size !== sections.length) throw new Error('Duplicate workout phase')
  return sections
}

export function sectionFields(entry, container) {
  const section = sectionOf(entry, container)
  return {
    ...(validOccurrenceId(entry?.occurrenceId) ? { occurrenceId: entry.occurrenceId } : {}),
    ...(section ? { sectionId: section.id, section: cleanSection(section) } : {}),
  }
}
