// A finished workout as plain text, for "Copy as text" in its detail sheet (Discord 'Improvement
// ideas'): something to paste into a chat, a coach's spreadsheet or a notes app. The sets are the
// same labels the history shows, so a drop-set or a rest-pause set reads the same in both.
// i18n-core rather than i18n, like history.js: nothing here needs the React half.
import { setLabel, sessionSections, workoutVolume } from './history.js'
import { EXIDX } from './exercises.js'
import { hasCompletedWork, isWarmupRow } from './workout-model.js'
import { fmtDate, fmtNum, fmtVol, durPart, capWords } from './format.js'
import { t, exerciseNameClass } from './i18n-core.js'

/**
 * `unit` is the profile's, `nameOf(entry)` the exercise's display name, `speedUnit` the one cardio
 * is shown in (lib/speed.js; km/h when absent). Blocks are separated by a blank line: the heading,
 * then each exercise (a superset's under one "Superset" line, its members together), then the
 * session note.
 */
export function workoutText(w, { unit, nameOf, speedUnit }) {
  const facts = [
    ...durPart((w.end || 0) - (w.start || 0)),
    fmtVol(w.vol ?? workoutVolume(w), unit),
    ...(w.bw ? [t('Body weight') + ' ' + fmtNum(w.bw) + ' ' + unit] : []),
  ]
  const blocks = [[[w.name, fmtDate(w.d, true, true)].filter(Boolean).join(' — '), facts.join(' · ')].join('\n')]
  // Work sets only: the text is what you trained, the work the volume above counts. Warm-ups are
  // left out of volume, records and progression everywhere else, and listed here with nothing to
  // tell them apart they would read as sets of their own.
  const lines = entry => {
    const sets = (entry.sets || []).filter(s => hasCompletedWork(s) && !isWarmupRow(s))
    if (!sets.length) return null
    // Title case the way the screen shows it (exerciseNameClass): an English name gets it, a
    // translated one keeps its own casing, which German's capitalised nouns depend on.
    const name = nameOf(entry)
    return [exerciseNameClass(EXIDX[entry.id]) ? capWords(name) : name, sets.map(s => setLabel(entry.id, s, entry.target, speedUnit)).join(', '), ...(entry.note ? [entry.note] : [])]
  }
  // Grouped the way the detail sheet groups it (sessionSections): per routine first, so a
  // superset is only ever paired inside one routine's section, in the order the sheet lists them.
  const entries = w.entries || []
  for (const group of sessionSections(entries).flatMap(section => section.units)) {
    const members = group.map(i => lines(entries[i])).filter(Boolean)
    if (!members.length) continue
    blocks.push([...(members.length > 1 ? [t('Superset')] : []), ...members.flat()].join('\n'))
  }
  if (w.note) blocks.push(w.note)
  return blocks.join('\n\n')
}
