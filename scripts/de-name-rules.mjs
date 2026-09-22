// The German exercise-name rules, in one place. Imported by translate-de-exercise-names.mjs,
// which checks every batch during translation and sends violations back to the model as a
// correction, and by frontend/src/lib/de-exercise-names.test.js, which fails the build. The two
// callers share this definition deliberately: inline copies are how a rule drifts unseen.
//
// Every `fix` quotes the offending word. A generic instruction ("use the German term") is
// ignored by a small model often enough to stall a stage; naming the text is what lands.

// German ships as a stage: the catalogue entries done with equipment, and not the body-weight
// ones, which keep their English title through the per-exercise fallback in exerciseNameFor.
// The builder, the translator and the test all read the staged set from here, so "which
// exercises does German cover" has exactly one answer.
export const BODY_WEIGHT = 'body weight'
export const stagedExercises = EXDB => EXDB.filter(exercise => exercise.eq && exercise.eq !== BODY_WEIGHT)

// Equipment is identity: a barbell row and a dumbbell row are different exercises, so the
// German name has to carry the same equipment the catalogue records. Keyed by the EXDB `eq`
// field rather than by words in the English title, which names the same machine differently
// from one entry to the next ("lever seated calf raise" is a leverage machine). The required
// terms are the ones frontend/src/locales/de.js already shows in the equipment filter — a name
// that called a Kabelzug a "Seilzug" would read as a different machine from the one the filter
// offers.
export const EQUIPMENT_TERMS = [
  ['upper body ergometer', /Oberkörper-?Ergometer/iu, 'Oberkörper-Ergometer'],
  ['olympic barbell', /Olympia-?(Langhantel|Stange)/iu, 'Olympia-Langhantel'],
  ['elliptical machine', /Crosstrainer/iu, 'Crosstrainer'],
  ['stepmill machine', /Treppenmaschine|Stepper/iu, 'Treppenmaschine'],
  ['leverage machine', /Hebelmaschine|Maschine|Gerät/iu, 'Hebelmaschine'],
  ['resistance band', /Widerstandsband|Fitnessband|Band/iu, 'Widerstandsband'],
  ['stability ball', /Gymnastikball/iu, 'Gymnastikball'],
  ['stationary bike', /Ergometer|Fahrradergometer/iu, 'Ergometer'],
  ['medicine ball', /Medizinball/iu, 'Medizinball'],
  ['skierg machine', /SkiErg/iu, 'SkiErg'],
  ['smith machine', /Multipresse/iu, 'Multipresse'],
  ['wheel roller', /Bauchroller|Bauchrad/iu, 'Bauchroller'],
  ['sled machine', /Schlitten/iu, 'Schlitten'],
  ['ez barbell', /SZ-?(Stange|Hantel)/iu, 'SZ-Stange'],
  ['bosu ball', /Bosu/iu, 'Bosu-Ball'],
  ['kettlebell', /Kettlebell/iu, 'Kettlebell'],
  ['trap bar', /Trap-?(Stange|Bar)/iu, 'Trap-Stange'],
  ['dumbbell', /Kurzhantel/iu, 'Kurzhantel'],
  ['barbell', /Langhantel/iu, 'Langhantel'],
  ['cable', /Kabelzug|Kabel/iu, 'Kabelzug'],
  ['roller', /Rolle|Roller/iu, 'Rolle'],
  ['hammer', /Hammer/iu, 'Hammer'],
  ['rope', /Seil|Rope/iu, 'Seil'],
  ['tire', /Reifen/iu, 'Reifen'],
  ['band', /Band/iu, 'Band'],
]

// Qualifiers that change what the exercise is, rather than how it is described. Dropping
// "assisted" or "one arm" silently turns the name into another exercise that already exists in
// the catalogue. Variants are generous on purpose: only the distinction has to survive.
export const QUALIFIER_TERMS = [
  ['assisted', /assistiert|unterstützt/iu, 'assistiert'],
  ['weighted', /Zusatzgewicht|gewichtet|mit Gewicht/iu, 'mit Zusatzgewicht'],
  ['one arm|single arm|one-arm|single-arm', /einarmig|einem Arm/iu, 'einarmig'],
  ['one leg|single leg|one-leg|single-leg', /einbeinig|einem Bein/iu, 'einbeinig'],
  ['seated', /sitzend|Sitzen|Sitz/iu, 'sitzend'],
  ['standing', /stehend|Stehen|Stand/iu, 'stehend'],
  ['lying', /liegend|Liegen/iu, 'liegend'],
  ['kneeling', /kniend|Knien/iu, 'kniend'],
  ['incline', /Schräg|schräg/u, 'Schrägbank'],
  ['decline', /Negativ|negativ/u, 'Negativbank'],
]

// Terminology the prompt asks for but no rule enforces, because the idiomatic German name is
// often built from a different word than the muscle it trains ("lat pulldown" is a Latzug, not
// a Latissimus-anything). Enforcing these produced false failures on correct names.
export const PREFERRED_TERMS = [
  ['glutes', 'Gesäß'], ['hamstrings', 'Beinbeuger'], ['quads', 'Beinstrecker'],
  ['lats', 'Latissimus (im Namen meist „Latzug")'], ['abs', 'Bauch'], ['calves', 'Waden'],
  ['delts', 'Schultern'], ['triceps', 'Trizeps'], ['biceps', 'Bizeps'],
  ['press', 'Drücken'], ['row', 'Rudern'], ['squat', 'Kniebeuge'], ['deadlift', 'Kreuzheben'],
  ['curl', 'Curl'], ['raise', 'Heben'], ['extension', 'Strecken'], ['fly', 'Fliegende'],
  ['pull-up', 'Klimmzug'], ['push-up', 'Liegestütz'], ['lunge', 'Ausfallschritt'],
  ['crunch', 'Crunch'], ['plank', 'Plank'], ['stretch', 'Dehnung'],
]

// Words that are the established German term too, so finding them in both names is not a leak.
// This list is the escape hatch from the inverted check below — every entry is a decision.
const LOANWORDS = new Set([
  'bosu', 'burpee', 'burpees', 'crunch', 'crunches', 'curl', 'curls', 'dip', 'dips',
  'ergometer', 'hack', 'hammer', 'kettlebell', 'kettlebells', 'pilates', 'plank', 'planks',
  'romanian', 'scott', 'sit-up', 'sit-ups', 'skierg', 'smith', 'sprint', 'sprints', 'step',
  'stepper', 'sumo', 'trap', 'yoga', 'v', 't', 'x', 'z', 'l', 'band', 'bands',
  // Hyphenated as one token by `words`, so listing the parts is not enough — 'step' and 'v' are
  // both above and neither matched "step-up" or "v-up". German gyms say these exactly as Sit-up
  // is said, which is why that one was already here.
  'step-up', 'step-ups', 'v-up', 'v-ups',
  // Plain German nouns that happen to be spelled the same in English, so the inverted check reads
  // a correct German name as a leak. "Arm" is the one that stalled a batch: the model wrote
  // "gebeugter Arm" and was told three times to write the German word, which it already had.
  // Only the singulars — German pluralises these differently (Arme, Hände), so an English plural
  // in a German name really is a leak.
  'arm', 'ball', 'hand', 'finger', 'rotation', 'position',
  // Eponyms. A surname is the same word in every language, so flagging one is always a false
  // positive — there is no "German word instead" for the model to write.
  'arnold', 'bradford', 'cossack', 'cuban', 'frankenstein', 'hyght', 'jefferson', 'jm',
  'london', 'otis', 'pallof', 'pendlay', 'rocky', 'russian', 'svend', 'tate', 'thibaudeau',
  'turkish', 'zercher', 'zottman',
  // Anglicisms German gyms use untranslated. Deliberately short: Kniebeuge, Drücken, Rudern and
  // Heben stay enforced, so this concedes the names that have no German form in use, not the
  // ones a translation exists for.
  'twist', 'twists', 'twisting', 'twisted', 'pullover', 'split', 'drag', 'goblet', 'thruster',
  'kickback', 'kickbacks', 'skull', 'crusher', 'skullcrusher', 'good', 'morning',
  // Attachment names, said as-is on a German gym floor. 'ez-bar' is deliberately absent: the
  // equipment rule requires SZ-Stange for that machine, and the two would contradict each other.
  't-bar', 'v-bar', 'landmine',
  // Found by surveying the titles still untranslated rather than by stalling on each in turn:
  // Kettlebell Swing, Ball Slam, Donkey Wadenheben, Sissy Squat and the POV camera-angle entries
  // all keep the English word on a German gym floor. Translatable neighbours are deliberately
  // absent — shrug, swing's cousin jump, throw and catch all have German forms the model produces.
  'pov', 'slam', 'swing', 'donkey', 'sissy',
  // Anatomical terms German takes from Latin unchanged, which is what stalled the pronation
  // batch: "Pronation" IS the German word, so no correction the model can make will satisfy a
  // rule that calls it English. The colloquial English forms stay flagged — 'glutes' and 'abs'
  // are not here, because Gesäß and Bauch exist and PREFERRED_TERMS asks for them.
  'pronation', 'supination', 'hyperextension', 'flexor', 'adductor', 'deltoid',
  'pectoralis', 'gluteus', 'piriformis', 'rectus', 'femoris', 'tibialis', 'posterior', 'major',
  // German gyms say Battle Ropes, not Kampfseile; the rope rule accepts either word for that
  // reason. Everything else on this list is a term with no German equivalent in use.
  'battle', 'battling', 'rope', 'ropes',
])

// Swiss spellings of words this codebase writes with ß. DATE_LOCALES maps de to de-DE, and
// de-CH is derived from de by replacing ß with ss (i18n-core.js) — so the base pack has to be
// the ß one, or the Swiss locale derives nothing and the two spellings drift apart again.
// No trailing boundary: German compounds ("Gesässdehnung", "Fussgelenk") are exactly where the
// Swiss form hides. "Masse" is left out on purpose — it is legitimate German for mass, and only
// vowel length tells it apart from Maße, which is why the derivation runs ß → ss and never back.
const SWISS_FORMS = /\b(gesäss|füsse|fuss|gross|aussen|schliess|strasse)\w*/iu

const words = s => s.toLowerCase().match(/[a-zäöüß][a-zäöüß-]*/giu) || []

// Returns [] for a name that breaks nothing. `exercise` is an EXDB entry (its `n` and `eq` are
// what the rules read). Each violation is { rule, fix }; `fix` is written as an instruction that
// quotes the actual text, because that is what a 12B model acts on.
export function checkName(exercise, german) {
  const english = exercise.n
  const equipment = exercise.eq
  const violations = []
  const add = (rule, fix) => violations.push({ rule, fix })
  const name = typeof german === 'string' ? german : ''

  if (!name.trim()) return [{ rule: 'empty', fix: `Translate "${english}" — the name is empty.` }]
  if (name !== name.trim()) add('whitespace', `Remove the leading or trailing space from "${name}".`)
  if (/[.!?]$/u.test(name)) add('punctuation', `Remove the final "${name.slice(-1)}" from "${name}" — a name is not a sentence.`)
  if (/[()]/u.test(name)) add('parentheses', `Remove the parentheses from "${name}" — the app appends the English title itself.`)
  if (name[0] !== name[0].toLocaleUpperCase('de')) add('capitalisation', `Start "${name}" with a capital letter.`)

  const swiss = name.match(SWISS_FORMS)
  if (swiss) add('sharp-s', `Write "${swiss[0]}" with ß, not ss — the app derives the Swiss spelling itself.`)

  const [, required, term] = EQUIPMENT_TERMS.find(([eq]) => eq === equipment) || []
  if (required && !required.test(name)) {
    add('equipment', `"${english}" is done with a ${equipment}: the German name must say "${term}". "${name}" does not.`)
  }
  for (const [pattern, required, term] of QUALIFIER_TERMS) {
    if (!new RegExp(`(^|[^a-z])(${pattern})([^a-z]|$)`, 'iu').test(english)) continue
    if (!required.test(name)) add('qualifier', `"${english}" is ${pattern.split('|')[0]}: the German name must say "${term}". "${name}" does not.`)
  }

  // Inverted English-leak check: anything the German name shares with the English one is a leak
  // unless it is on the loanword list. An enumerated list of forbidden English words missed a
  // different word every time it was written.
  const englishWords = new Set(words(english))
  for (const word of new Set(words(name))) {
    if (!englishWords.has(word) || LOANWORDS.has(word)) continue
    add('english', `"${word}" is still English in "${name}". Write the German word instead.`)
  }
  return violations
}

// The terminology block the translator puts in its prompt. Built from the tables above so the
// prompt and the checks can never describe different rules.
export function promptGlossary() {
  const line = ([english, , term]) => `- ${english} → ${term}`
  return [
    'EQUIPMENT (identity — always carry it over):',
    ...EQUIPMENT_TERMS.map(line),
    '',
    'QUALIFIERS (identity — always carry them over):',
    ...QUALIFIER_TERMS.map(([english, , term]) => `- ${english.split('|')[0]} → ${term}`),
    '',
    'PREFERRED TERMS (use unless the idiomatic German name is built differently):',
    ...PREFERRED_TERMS.map(([english, term]) => `- ${english} → ${term}`),
  ].join('\n')
}
