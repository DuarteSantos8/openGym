// What the spoken cues sound like (Settings → Timer alerts → Voice, v1.4.5): a style, which is a
// pack of lines per moment, written for openGym, translated like every other string, and said by
// the device's own voice (lib/speech.js). Nothing here imitates anyone: the personality is in
// the words, the voice is whichever one the phone has.
//
//   S.cueStyle   'plain' (the default: only the facts, as before), 'calm', 'drill', 'hype',
//                'deadpan', or 'own' for lines written by the person (S.cueLines)
//   S.cueLines   { [moment]: string[] }: the own lines, at most LINES_MAX per moment
//
// The moments:
//   restStart  after the next set is announced as a rest begins
//   lastSet    instead of restStart when that next set is the exercise's last work set
//   tenLeft    10 s before the end of a rest (rests of 20 s or more)
//   restOver   the rest ran out
//   record     a set just earned a record trophy (lib/set-records.js)
//
// A clip of one's own for a moment (lib/voice-clips.js) is played instead of that moment's line.
// The count of a hold ("3", "2", "1", "Go!") is not a moment: it stays a number in every style.
import { t } from './i18n-core.js'

export const MOMENTS = ['restStart', 'tenLeft', 'restOver', 'lastSet', 'record']
export const STYLE_IDS = ['plain', 'calm', 'drill', 'hype', 'deadpan', 'own']
export const LINES_MAX = 8
export const LINE_MAX = 120

export const STYLE_COPY = {
  plain: ['Just the facts', 'The set, the time, nothing else.'],
  calm: ['Calm coach', 'Soft words, steady breathing.'],
  drill: ['Drill sergeant', 'Loud, strict, secretly proud of you.'],
  hype: ['Hype man', 'ALL CAPS ENERGY.'],
  deadpan: ['Deadpan', 'Dry as a rice cake.'],
  own: ['Your own lines', 'Written by you, said by your phone.'],
}

export const MOMENT_COPY = {
  restStart: 'When a rest starts',
  tenLeft: '10 seconds left',
  restOver: 'When the rest is over',
  lastSet: 'Before the last set',
  record: 'New record',
}

// The English source of every line; t() finds each one's translation (locales/*.js).
export const PACKS = {
  plain: {
    restStart: [],
    tenLeft: ['10 seconds'],
    restOver: ['Rest is over'],
    lastSet: [],
    record: [],
  },
  calm: {
    restStart: ['Breathe. You earned this break.', 'Shoulders down, slow breaths.'],
    tenLeft: ['Ten seconds. Ease back in.', 'Ten seconds left. No rush, just ready.'],
    restOver: ['Whenever you’re ready. Now is good.', 'Back to it, nice and steady.'],
    lastSet: ['Last set. Make it a tidy one.', 'Final set. Good form all the way.'],
    record: ['That’s a new record. Quietly brilliant.', 'New personal best. Well done, really.'],
  },
  drill: {
    restStart: ['Rest is a privilege, not a hobby.', 'Hydrate. Do not get comfortable.'],
    tenLeft: ['Ten seconds, recruit. On your feet.', 'Ten seconds. The bar misses you.'],
    restOver: ['Break’s over. Move it!', 'Back on the bar. That was not a request.'],
    lastSet: ['Last set. Leave nothing in the tank!', 'Final set. Make it count, soldier!'],
    record: ['New record. I am almost impressed.', 'Personal best! Don’t let it go to your head.'],
  },
  hype: {
    restStart: ['LET’S GO! YOU’RE ON FIRE!', 'WHAT A SET! CATCH YOUR BREATH, CHAMP!'],
    tenLeft: ['TEN SECONDS! GET HYPED!', 'TEN SECONDS! THE BAR IS CALLING YOUR NAME!'],
    restOver: ['LET’S GO! ONE MORE, CHAMP!', 'BACK TO WORK! YOU CAN DO IT!'],
    lastSet: ['LAST SET! EMPTY THE TANK!', 'FINAL SET! THIS IS YOUR MOMENT!'],
    record: ['NEW RECORD! ARE YOU KIDDING ME?!', 'PERSONAL BEST! SOMEBODY CALL THE NEWS!'],
  },
  deadpan: {
    restStart: ['Rest. The weights aren’t going anywhere.', 'Nice set. Probably.'],
    tenLeft: ['Ten seconds. Brace yourself, emotionally.', 'Ten seconds. I’d start getting up.'],
    restOver: ['Rest is over. I don’t make the rules. I do, actually.', 'Time to lift the heavy thing again.'],
    lastSet: ['Last set. Then you can sit down forever.', 'Final set. Try to look like you meant it.'],
    record: ['New record. I’ll alert absolutely nobody.', 'Personal best. The weights have filed a complaint.'],
  },
}

/** The style a profile speaks in. */
export const cueStyleOf = S => (STYLE_IDS.includes(S?.cueStyle) ? S.cueStyle : 'plain')

const cleanLine = l => String(l ?? '').replace(/\s+/g, ' ').trim().slice(0, LINE_MAX)

/** The own lines of a moment, cleaned (blank ones dropped, at most LINES_MAX). */
export function ownLines (S, moment) {
  const map = S?.cueLines
  const raw = map && typeof map === 'object' && !Array.isArray(map) ? map[moment] : null
  return (Array.isArray(raw) ? raw : []).map(cleanLine).filter(Boolean).slice(0, LINES_MAX)
}

/** The lines a style has for a moment, in the app's language. */
export function packLines (style, moment) {
  return (PACKS[style]?.[moment] || []).map(l => t(l))
}

/** The lines a profile would say at a moment, in the app's language. */
export function linesFor (S, moment) {
  const style = cueStyleOf(S)
  return style === 'own' ? ownLines(S, moment) : packLines(style, moment)
}

// The line said last per moment, so the same one does not come twice in a row.
const lastSaid = {}
/** One of the moment's lines, never the one said just before when there is a choice; '' for none. */
export function pickLine (S, moment, rnd = Math.random) {
  const lines = linesFor(S, moment)
  if (!lines.length) return ''
  const pool = lines.length > 1 ? lines.filter(l => l !== lastSaid[moment]) : lines
  const line = pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))]
  lastSaid[moment] = line
  return line
}
export function _resetPicks () { for (const k of Object.keys(lastSaid)) delete lastSaid[k] }

/**
 * Sets a moment's own lines on a store draft and makes the style 'own'. The first edit of a pack
 * starts the own lines from that pack, every moment of it, in the language on screen, so editing
 * one line of Hype man keeps the other four moments shouting.
 */
export function setOwnLines (s, moment, lines) {
  if (!MOMENTS.includes(moment)) return
  const style = cueStyleOf(s)
  const map = style === 'own' && s.cueLines && typeof s.cueLines === 'object' && !Array.isArray(s.cueLines)
    ? { ...s.cueLines }
    : Object.fromEntries(MOMENTS.map(m => [m, packLines(style, m)]))
  map[moment] = (Array.isArray(lines) ? lines : []).map(cleanLine).filter(Boolean).slice(0, LINES_MAX)
  s.cueLines = map
  s.cueStyle = 'own'
}

/** Whether the profile has own lines written (kept while another style is picked). */
export const hasOwnLines = S => MOMENTS.some(m => ownLines(S, m).length > 0)

/** Starts the own lines from a pack on a store draft (replacing any there were), style 'own'. */
export function startOwnFrom (s, style) {
  s.cueLines = Object.fromEntries(MOMENTS.map(m => [m, PACKS[style] ? packLines(style, m) : []]))
  s.cueStyle = 'own'
}

/** A line for the Settings preview: what a style says at the end of a rest. */
export const sampleLine = S => linesFor(S, 'restOver')[0] || linesFor(S, 'restStart')[0] || t('Rest is over')
