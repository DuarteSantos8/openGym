// Accessible names for controls that repeat down a list (P4, 1.4.5).
//
// A routine has a "Remove" per exercise, a workout a "Decrease" per set, History a "Details" per
// row. On screen the row says which one a button belongs to; a screen reader moving from button
// to button hears the same word five times. So the name carries what the button acts on, and the
// visible text stays as it is: the name goes into aria-label only.
//
// Two shapes, to keep the locale packs small:
//   - a sentence that already exists, with the thing in it: t('Remove {0}', said(name)),
//     t('Move {0} up', said(name)), t('Delete {0}', said(name)).
//   - everything else: nameIn(thing, label), "Barbell Curl: More", "Set 2: Weight (kg)". The
//     thing comes first, so swiping down a list the difference is heard at once, and no language
//     has to bend a control's label into a sentence (cases, word order).
//
// In Arabic and Persian the inserted name is its own isolated run (lib/bidi.js), so a Latin
// exercise name or "80 kg" does not turn the words around it; elsewhere it goes in untouched.
import { t } from './i18n-core.js'
import { isoRun } from './bidi.js'

/** A name as it goes into a template's placeholder: isolated in a right-to-left language. */
export const said = name => isoRun(name == null ? '' : String(name))

/** `label` for one thing in a list: "Set 2: Weight (kg)". Without one of the two, the other. */
export const nameIn = (thing, label) => {
  if (thing == null || thing === '') return label ?? ''
  if (label == null || label === '') return String(thing)
  return t('{0}: {1}', said(thing), label)
}
