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

// Equipment exercises whose German name is written but not yet signed off by a native speaker:
// either the reviewer marked the name itself unsure, or it carries terminology the review left
// open (the half-declined "Reverses …", and the English "Clean"). They are deliberately NOT in
// the pack — the per-exercise fallback in exerciseNameFor keeps their English title — so that
// what ships is only what a German speaker has actually read. Reviewing one means deleting its
// id here and adding its name to de.json; the test enforces that the two stay in step.
export const AWAITING_REVIEW = new Set([
  '0009', '0014', '0023', '0024', '0028', '0029', '0031', '0034', '0035', '0036',
  '0037', '0038', '0046', '0048', '0051', '0052', '0059', '0060', '0070', '0072',
  '0074', '0079', '0080', '0081', '0082', '0085', '0087', '0089', '0095', '0097',
  '0098', '0099', '0103', '0104', '0105', '0106', '0107', '0110', '0111', '0112',
  '0113', '0114', '0125', '0126', '0127', '0128', '0162', '0164', '0172', '0174',
  '0188', '0195', '0197', '0198', '0200', '0205', '0209', '0211', '0221', '0223',
  '0224', '0225', '0237', '0238', '0241', '0242', '0247', '0287', '0288', '0299',
  '0309', '0310', '0311', '0321', '0324', '0335', '0344', '0346', '0347', '0349',
  '0358', '0359', '0371', '0373', '0377', '0381', '0410', '0431', '0436', '0438',
  '0445', '0450', '0455', '0525', '0562', '0609', '0640', '0641', '0741', '0742',
  '0743', '0749', '0750', '0755', '0757', '0759', '0762', '0763', '0764', '0768',
  '0772', '0774', '0777', '0811', '0818', '0830', '0833', '0844', '0851', '0856',
  '0859', '0968', '0969', '0971', '0976', '0978', '0979', '0981', '0986', '0991',
  '0992', '0994', '1001', '1008', '1013', '1015', '1016', '1017', '1022', '1201',
  '1256', '1257', '1282', '1283', '1291', '1296', '1312', '1316', '1317', '1339',
  '1341', '1342', '1354', '1361', '1380', '1383', '1384', '1388', '1389', '1394',
  '1411', '1412', '1414', '1417', '1433', '1435', '1436', '1456', '1457', '1459',
  '1461', '1462', '1496', '1545', '1582', '1618', '1619', '1620', '1621', '1629',
  '1635', '1639', '1640', '1645', '1660', '1667', '1700', '1707', '1710', '1714',
  '1728', '1733', '1738', '1743', '1744', '1751', '1752', '1754', '1755', '1760',
  '1767', '2133', '2136', '2137', '2138', '2139', '2142', '2143', '2187', '2203',
  '2204', '2209', '2397', '2401', '2402', '2405', '2407', '2414', '2459', '2464',
  '2705', '2706', '2796', '2805', '2808', '2812', '2987', '3017', '3142', '3194',
  '3235', '3237', '3305', '3313', '3541', '3542', '3635', '3643', '3888',
])

export const stagedExercises = EXDB =>
  EXDB.filter(exercise => exercise.eq && exercise.eq !== BODY_WEIGHT && !AWAITING_REVIEW.has(exercise.id))

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
  'arm', 'ball', 'hand', 'finger', 'rotation', 'position', 'hang',
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

// German puts the equipment in a trailing phrase ("Bankdrücken mit Langhantel", "Rudern am
// Kabelzug") or into a compound ("Kurzhantel-Curl"). Leading it as a bare noun — "Kurzhantel
// Schrägbank einarmige Fliegende" — is the English word order with German words in it, which is
// what an English-title-per-line translation produces unless something rejects it. Built from
// EQUIPMENT_TERMS so the nouns the equipment rule demands are exactly the ones checked here.
const EQUIPMENT_NOUNS = [...new Set(EQUIPMENT_TERMS.map(([, , term]) => term))]
const LEADING_EQUIPMENT = new RegExp(`^(${EQUIPMENT_NOUNS.join('|')})(?=\\s)`, 'u')
// The same calque one word later: "Abwechselndes Kettlebell Drücken" leads with an adjective, so
// the anchored rule above never sees it. Mid-name the tell is a following CAPITALISED word — a
// noun stacked against the equipment — while "mit Kettlebell und zwei Armen" is ordinary German.
const STACKED_EQUIPMENT = new RegExp(`(?:^|[^-\\w])(${EQUIPMENT_NOUNS.join('|')})\\s+([A-ZÄÖÜ]\\w+)`, 'u')

// German lowercases an adjective or participle wherever it is not the first word. The model
// capitalises them mid-name because the English title capitalises nothing and it is copying
// position, not grammar. A closed list, matched only as a whole word with an inflectional
// ending, so the noun compounds these stems also appear in ("Schrägbank", "Sitzbank") are
// untouched.
const ADJECTIVE_STEMS = [
  'sitzend', 'stehend', 'liegend', 'kniend', 'hängend', 'assistiert', 'gewichtet',
  'einarmig', 'zweiarmig', 'beidarmig', 'einbeinig', 'zweibeinig', 'gebeugt', 'gestreckt',
  'vorgebeugt', 'abwechselnd', 'gedreht', 'umgekehrt', 'reverse', 'seitlich', 'vertikal',
  'horizontal', 'lateral', 'unilateral', 'bilateral', 'breit', 'eng', 'weit', 'hoch', 'tief',
  'schräg', 'negativ', 'innere?', 'äußere?', 'vorder', 'hinter', 'steifbeinig', 'fixiert',
  // Added after reading the built pack: these slipped through because the stem list was written
  // from the glossary rather than from what the model actually produced.
  'militärisch', 'rückwärtig', 'aufrecht', 'überkreuzt', 'angezogen', 'neutral', 'proniert',
  'supiniert', 'gebogen', 'erhöht', 'gerade', 'voll', 'tief', 'kontralateral', 'invers',
]
const MID_NAME_ADJECTIVE = new RegExp(`^(${ADJECTIVE_STEMS.join('|')})(e|er|es|en|em)?$`, 'u')

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

  // The catalogue marks variants "v. 2" and the pack had picked up three spellings of it
  // ("Version 2", "V. 2", and the marker stranded mid-name). One spelling, always last.
  const version = name.match(/\b(?:[Vv]\.\s*|[Vv]ersion\s+|Variante\s+)(\d+)\b/u)
  if (version && !name.endsWith(`v. ${version[1]}`)) {
    add('version', `Write the variant marker in "${name}" as "v. ${version[1]}" at the very end of the name.`)
  }

  const leading = name.match(LEADING_EQUIPMENT)
  const stacked = leading ? null : name.match(STACKED_EQUIPMENT)
  if (leading) {
    add('word-order', `"${name}" starts with "${leading[1]}" as a bare noun, which is the English word order. Name the movement first and put the equipment in a trailing phrase ("… mit ${leading[1]}", "… am ${leading[1]}") or join it into one compound word with a hyphen.`)
  } else if (stacked) {
    add('word-order', `"${name}" puts "${stacked[1]} ${stacked[2]}" side by side as two bare nouns, which is the English word order. Write "${stacked[2]} … mit ${stacked[1]}" instead, or join the two with a hyphen.`)
  }

  const midCap = name.split(/\s+/).slice(1)
    .find(word => /^[A-ZÄÖÜ]/u.test(word) && MID_NAME_ADJECTIVE.test(word.toLocaleLowerCase('de')))
  if (midCap) {
    add('mid-capitalisation', `"${midCap}" is an adjective in "${name}" and German only capitalises it as the first word. Write it as "${midCap.toLocaleLowerCase('de')}".`)
  }

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
