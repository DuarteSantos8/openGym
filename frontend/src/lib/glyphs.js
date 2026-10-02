// Routine glyphs.
//
// Routines used to store a literal emoji in `r.emoji` ('💪', '🦵', …). The
// redesign stores an icon key instead, but the field keeps its name so existing
// synced state stays readable by both builds — no migration, no lost routines.
//
// glyphOf() accepts either form: a known icon key passes through, a legacy emoji
// is mapped, and anything unrecognised falls back to the default.

import { ICON_NAMES } from '../components/Icon.jsx'

export const DEFAULT_GLYPH = 'figureStrength'

// The picker offers glyphs that describe a TRAINING DAY — the split, the kit, or
// the kind of session. The first version offered trophy/medal/crown/flag/star,
// which say how a workout went, not what it is; nobody names a routine "crown".
// Grouped, because 20 loose icons is a wall — you scan the group first.
export const GLYPH_GROUPS = [
  { key: 'Strength',  items: ['figureStrength', 'arm', 'abs', 'legs', 'pullup'] },
  { key: 'Equipment', items: ['dumbbell', 'barbell', 'kettlebell', 'plate', 'machine'] },
  { key: 'Cardio',    items: ['figureRun', 'bike', 'swim', 'boxing', 'timer'] },
  { key: 'Recovery',  items: ['stretch', 'moon', 'heart', 'flame', 'bolt'] },
]
export const GLYPHS = GLYPH_GROUPS.flatMap(g => g.items)

// Legacy emoji → icon key, so routines created before the redesign keep a
// sensible glyph instead of all collapsing onto the default.
const LEGACY = {
  '💪': 'arm', '🦾': 'arm', '🫸': 'figureStrength', '🫷': 'pullup',
  '🏋️': 'dumbbell', '🏋': 'dumbbell', '🏋️‍♀️': 'dumbbell',
  '🦵': 'legs', '🍑': 'legs',
  '🔥': 'flame', '⚡': 'bolt', '💥': 'bolt', '🧨': 'bolt', '😤': 'flame',
  '🏃': 'figureRun', '🏃‍♀️': 'figureRun', '🚴': 'bike', '🏊': 'swim',
  '🤸': 'stretch', '🧘': 'stretch', '🧘‍♀️': 'stretch',
  '🥊': 'boxing', '🧗': 'pullup', '⛰️': 'figureRun', '🏔️': 'figureRun', '🚀': 'bolt',
  '🎯': 'target', '🏆': 'trophy', '🥇': 'medal', '⭐': 'star', '🌟': 'star',
  '👑': 'crown', '🛡️': 'shield', '⚔️': 'shield', '❤️‍🔥': 'heart',
  '🦍': 'kettlebell', '🐂': 'barbell', '🐻': 'kettlebell', '🦁': 'boxing',
  '🐺': 'figureRun', '🦈': 'swim', '🤖': 'machine',
}

// Every icon key a routine can hold: what the picker offers, what the first picker offered, and
// what an old emoji maps onto. The Coach keeps exactly these when a plan comes back
// (api/coach/core/glyphs.js; coach-parity.test.js holds the two lists together).
export const OLD_PICKER_GLYPHS = ['trophy', 'medal', 'crown', 'flag', 'star']
export const KNOWN_GLYPHS = [...new Set([...GLYPHS, ...OLD_PICKER_GLYPHS, ...Object.values(LEGACY)])]

export function glyphOf(v) {
  if (!v) return DEFAULT_GLYPH
  if (ICON_NAMES.includes(v)) return v
  if (LEGACY[v]) return LEGACY[v]
  // strip variation selectors / ZWJ sequences and retry the base emoji
  const base = [...v].filter(c => c !== '️' && c !== '‍')[0]
  return LEGACY[base] || DEFAULT_GLYPH
}
