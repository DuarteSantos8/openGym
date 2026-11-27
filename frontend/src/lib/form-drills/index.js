// The Form check drills (README.md). One import line per drill: the order is the order
// drillFor() asks them in, so a more particular drill goes before a broader one.
// index.test.js runs the whole catalogue through every drill: no exercise matches two.
import squat from './squat.js'
import splitSquat from './split-squat.js'
import romanianDeadlift from './romanian-deadlift.js'
import pullUp from './pull-up.js'
import invertedRow from './inverted-row.js'
import chestSupportedRow from './chest-supported-row.js'
import rearFly from './rear-fly.js'
import pushUp from './push-up.js'
import dip from './dip.js'
import overheadPress from './overhead-press.js'
import tricepsPushdown from './triceps-pushdown.js'
import curl from './curl.js'
import lateralRaise from './lateral-raise.js'
import sidePlank from './side-plank.js'
import plank from './plank.js'
import sideLunge from './side-lunge.js'
import hangingLegRaise from './hanging-leg-raise.js'
import seatedCableRow from './seated-cable-row.js'
import uprightRow from './upright-row.js'
import straightArmPulldown from './straight-arm-pulldown.js'
import frontRaise from './front-raise.js'
import hipAbduction from './hip-abduction.js'
import wallSit from './wall-sit.js'

export const DRILLS = [
  squat, splitSquat, sideLunge, romanianDeadlift, hipAbduction,
  pullUp, hangingLegRaise, invertedRow, chestSupportedRow, seatedCableRow, rearFly, uprightRow, straightArmPulldown,
  pushUp, dip, overheadPress, tricepsPushdown,
  curl, lateralRaise, frontRaise,
  sidePlank, plank, wallSit,
]

const BY_ID = new Map(DRILLS.map(d => [d.id, d]))

/** The drill with this id, or null. */
export const drillById = id => BY_ID.get(id) || null

/** The drill that judges this catalogue exercise ({ id, n, cat }), or null when none does. */
// Exercises a drill's name test lets in but its signal cannot judge (a lower back "curl", a bird dog
// "plank", fly and raise variants on rings, straps or a landmine, lunges with a second movement).
const NOT_JUDGED = new Set(['1352', '1148', '9002', '4923', '1090', '1130', '3237', '4161', '3581'])
export const drillFor = ex => (ex && NOT_JUDGED.has(String(ex.id)) ? null : DRILLS.find(d => d.matches(ex)) || null)

/** The drill's standard: `standard` when it is one of the drill's, else its default; null for no drill. */
export function standardFor(drillOrId, standard) {
  const drill = typeof drillOrId === 'string' ? drillById(drillOrId) : drillOrId
  if (!drill) return null
  return drill.standards.some(s => s.id === standard) ? standard : drill.defaultStandard
}

const KINDS = ['reps', 'hold']
const VIEW_NAMES = ['side', 'diagonal', 'front']

/** What is wrong with a drill definition against the contract in README.md: a list of sentences, empty when nothing. */
export function checkDrill(d) {
  const out = []
  if (!d || typeof d !== 'object') return ['not an object']
  if (!/^[a-z][a-z0-9-]*$/.test(d.id || '')) out.push('id: lower-case letters, digits and dashes')
  if (typeof d.name !== 'string' || !d.name) out.push('name: an English string')
  if (!KINDS.includes(d.kind)) out.push('kind: reps or hold')
  if (!Array.isArray(d.views) || !d.views.length || d.views.some(v => !VIEW_NAMES.includes(v))) out.push('views: side, diagonal and/or front, best first')
  if (typeof d.setup !== 'string' || !d.setup) out.push('setup: an English string')
  if (typeof d.matches !== 'function') out.push('matches: a function')
  if (!Array.isArray(d.standards) || !d.standards.length || d.standards.some(s => !s || !s.id || !s.label)) out.push('standards: [{ id, label }], at least one')
  else if (!d.standards.some(s => s.id === d.defaultStandard)) out.push('defaultStandard: one of the standards')
  if (!d.misses || typeof d.misses !== 'object' || Object.values(d.misses).some(m => !m || !m.line || !m.say || !m.row)) out.push('misses: { reason: { line, say, row } }')
  if (typeof d.create !== 'function') out.push('create: a function')
  return out
}

/** The English strings a drill declares (name, setup, standards, misses), for the locale test. */
export function drillStrings(d) {
  return [d.name, d.setup, ...d.standards.map(s => s.label), ...Object.values(d.misses).flatMap(m => [m.line, m.say, m.row])]
}
