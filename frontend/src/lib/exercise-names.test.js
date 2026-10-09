import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { EXDB } from './exercises-data.js'
import V13_IDS from './catalogue-v13-ids.json' with { type: 'json' }
import { checkName, stagedExercises } from '../../../scripts/de-name-rules.mjs'
import {
  EXERCISE_NAME_LANGS, _setLangState, derivePack, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

// Every translated-name pack, checked the same way. The packs are generated from
// catalogue/i18n/<lang>.json and may be partial (anything missing shows the English title), so
// coverage and the language rules below are pinned on the 1,324 entries of the v1.3 catalogue,
// whose names were curated and reviewed. Names for the v1.4 additions only have to be well formed.
const packs = import.meta.glob('../exercise-names/*.js', { eager: true, import: 'default' })
const EXIDX = new Map(EXDB.map(exercise => [exercise.id, exercise]))
const LEGACY_IDS = new Set(V13_IDS)
const legacy = EXDB.filter(exercise => LEGACY_IDS.has(exercise.id))
const catalogueNames = lang => {
  const rows = JSON.parse(readFileSync(new URL(`../../../catalogue/i18n/${lang}.json`, import.meta.url), 'utf8'))
  return Object.fromEntries(Object.entries(rows).filter(([, row]) => row.name).map(([id, row]) => [id, row.name]))
}

const MALE = /(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu
const FEMALE = /(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu

// What the v1.3 names were held to, per language.
//   covers:   the v1.3 entries the pack translates in full
//   keep:     [English, translated] — a qualifier or piece of equipment in the English title that
//             has to survive translation, since it changes which exercise it is
//   forbid:   words a name must not contain (English left untranslated, rejected calques)
//   require:  a pattern every name has to match
//   distinct: no two different v1.3 exercises share a name
//   loanword: "burpee" is the local term too, so it shows without the English repeated
const LANGS = {
  // German ships as a stage: the equipment entries, without the body-weight ones and the ones
  // awaiting native review. The naming rules live in scripts/de-name-rules.mjs, shared with
  // the translator so a rule cannot drift between the two.
  de: { covers: stagedExercises(legacy), check: checkName },
  es: {
    covers: legacy,
    keep: [
      [/assisted/iu, /asistid/iu],
      [/weighted/iu, /(?:peso|lastre)/iu],
      [MALE, /masculin/iu],
      [FEMALE, /femenin/iu],
      [/barbell/iu, /barra/iu],
      [/dumbbell/iu, /mancuerna/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /smith/iu],
      [/stability ball/iu, /balón de estabilidad/iu],
      [/medicine ball/iu, /balón medicinal/iu],
      [/\bbands?\b/iu, /banda/iu],
      [/\bcables?\b/iu, /polea/iu],
    ],
  },
  fr: {
    covers: legacy,
    loanword: true,
    forbid: /(?:^|[^\p{L}])(?:barbell|dumbbell|cable|stability ball|medicine ball|assisted|weighted)(?=$|[^\p{L}])/iu,
    keep: [
      [/assisted/iu, /assisté/iu],
      [/weighted/iu, /lesté/iu],
      [MALE, /masculin/iu],
      [FEMALE, /féminin/iu],
      [/barbell/iu, /barre/iu],
      [/dumbbell/iu, /haltère/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /multipower/iu],
      [/stability ball/iu, /ballon de stabilité/iu],
      [/exercise ball/iu, /ballon de stabilité/iu],
      [/medicine ball/iu, /médecine-ball/iu],
      [/cable/iu, /câble/iu],
      [/band/iu, /élastique/iu],
    ],
  },
  hu: { covers: legacy, distinct: true },
  it: {
    covers: legacy,
    loanword: true,
    forbid: /(?:^|[^\p{L}])(?:barbell|dumbbell|cable|stability ball|medicine ball|assisted|weighted)(?=$|[^\p{L}])/iu,
    keep: [
      [/assisted/iu, /assistit/iu],
      [/weighted/iu, /con peso/iu],
      [MALE, /maschil/iu],
      [FEMALE, /femminil/iu],
      [/barbell/iu, /bilancier/iu],
      [/dumbbell/iu, /manubri/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /multipower/iu],
      [/stability ball/iu, /fitball/iu],
      [/exercise ball/iu, /fitball/iu],
      [/medicine ball/iu, /palla medica/iu],
      [/band/iu, /fascia elastica/iu],
    ],
  },
  pl: {
    covers: legacy,
    loanword: true,
    distinct: true,
    forbid: /(?:^|[^\p{L}])(?:barbell|dumbbell|cable|band|stability ball|exercise ball|medicine ball|assisted|weighted)(?=$|[^\p{L}])/iu,
    keep: [
      [/assisted/iu, /asyst|wspomag/iu],
      [/weighted/iu, /obciąż/iu],
      [MALE, /mężczyzn/iu],
      [FEMALE, /kobiet/iu],
      [/barbell/iu, /sztang/iu],
      [/dumbbell/iu, /hantl/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /smitha/iu],
      [/stability ball/iu, /pił[kc]\p{L}* gimnastyczn/iu],
      [/exercise ball/iu, /pił[kc]\p{L}* gimnastyczn/iu],
      [/medicine ball/iu, /pił[kc]\p{L}* lekarsk/iu],
      [/band/iu, /gum/iu],
      [/ez[- ]bar/iu, /łaman/iu],
      [/bosu/iu, /bosu/iu],
      [/trap bar/iu, /trap bar/iu],
    ],
  },
  'pt-BR': {
    covers: legacy,
    // European Portuguese where Brazil says it differently.
    forbid: /(?:^|[^\p{L}])(?:abdómen|anca|gémeos|ecrã|ginásio|banda|piso|omoplata|pegada inversa|pegada invertida)(?=$|[^\p{L}])/iu,
    keep: [
      [/assisted/iu, /assistid/iu],
      [/weighted/iu, /(?:peso|carga|lastro|ponderad)/iu],
      [MALE, /masculin/iu],
      [FEMALE, /feminin/iu],
      [/barbell/iu, /barra/iu],
      [/dumbbell/iu, /halter/iu],
      [/kettlebell/iu, /kettlebell/iu],
      [/smith/iu, /smith/iu],
      [/stability ball/iu, /bola de estabilidade/iu],
      [/medicine ball/iu, /bola medicinal/iu],
    ],
  },
  ru: {
    covers: legacy,
    // Cyrillic somewhere in the title: a name left in English would otherwise pass every other
    // check while showing "barbell bench press (barbell bench press)".
    require: /\p{Script=Cyrillic}/u,
    // Transliterated calques the glossary rejects in favour of the term gyms actually use.
    forbid: /(?:^|[^\p{L}])(?:керл|завиток|череполом|хруст|сит-ап|пуш-ап|пул-ап|чин-ап|кеттлбелл|ассистированн\p{L}*|проповедник|мёртвая тяга)(?=$|[^\p{L}])/iu,
    keep: [
      // "ez bar"/"ez barbell" is the EZ bar, and an olympic barbell is named for the bar too,
      // so a plain "barbell" is the only one that has to say штанга.
      [/ez[\s-]bar/iu, /ez-гриф/iu],
      [/(?<!ez[\s-])(?<!olympic )barbell/iu, /штанг/iu],
      [/olympic barbell/iu, /(?:олимпийск|штанг)/iu],
      [/dumbbell/iu, /гантел/iu],
      [/kettlebell/iu, /гир/iu],
      [/smith/iu, /смит/iu],
      [/trap bar/iu, /трэп-гриф/iu],
      [/stability ball/iu, /фитбол/iu],
      [/medicine ball/iu, /медбол/iu],
      [/assisted/iu, /(?:поддержк|самопомощ)/iu],
      [/weighted/iu, /отягощен/iu],
      [MALE, /муж/iu],
      [FEMALE, /жен/iu],
    ],
  },
}

test('every curated language still ships a name pack, and every pack is enabled', () => {
  for (const lang of Object.keys(LANGS)) expect(EXERCISE_NAME_LANGS, lang).toContain(lang)
  for (const path of Object.keys(packs)) {
    const lang = path.match(/([^/]+)\.js$/)[1]
    expect(EXERCISE_NAME_LANGS, path).toContain(lang)
  }
})

for (const lang of EXERCISE_NAME_LANGS) {
  describe(`${lang} exercise names`, () => {
    const pack = packs[`../exercise-names/${lang}.js`]
    const rules = LANGS[lang] || {}
    // The rules hold the curated names: the v1.3 ones, for German only the reviewed stage.
    const v13 = (rules.covers || legacy).filter(exercise => pack[exercise.id])
    afterEach(() => _setLangState('en', {}, null, null))

    test('is built from catalogue/i18n, for known exercises only, with non-empty names', () => {
      expect(pack).toEqual(catalogueNames(lang))
      for (const [id, name] of Object.entries(pack)) {
        expect(EXIDX.has(id), `unknown exercise ${id}`).toBe(true)
        expect(typeof name === 'string' && name.trim(), id).toBeTruthy()
        expect(name, id).toBe(name.trim())
      }
    })

    if (rules.covers) {
      test('covers the v1.3 catalogue', () => {
        expect(rules.covers.length).toBeGreaterThan(0)
        for (const exercise of rules.covers) expect(pack[exercise.id]?.trim(), exercise.id).toBeTruthy()
      })
    }

    if (rules.forbid || rules.require) {
      test('leaves nothing untranslated in the v1.3 names', () => {
        for (const exercise of v13) {
          if (rules.forbid) expect(pack[exercise.id], exercise.id).not.toMatch(rules.forbid)
          if (rules.require) expect(pack[exercise.id], exercise.id).toMatch(rules.require)
        }
      })
    }

    if (rules.keep) {
      test('preserves identity-changing qualifiers and equipment in the v1.3 names', () => {
        for (const exercise of v13) {
          for (const [english, translated] of rules.keep) {
            if (english.test(exercise.n)) expect(pack[exercise.id], `${exercise.id}: ${exercise.n}`).toMatch(translated)
          }
        }
      })
    }

    if (rules.check) {
      test('every v1.3 name obeys the naming rules', () => {
        const broken = []
        for (const exercise of v13) {
          const violations = rules.check(exercise, pack[exercise.id])
          if (violations.length) broken.push(`${exercise.id} "${pack[exercise.id]}": ${violations.map(v => v.rule).join(', ')}`)
        }
        expect(broken).toEqual([])
      })
    }

    if (rules.distinct) {
      test('gives different v1.3 exercises different names', () => {
        const seen = new Map()
        for (const exercise of v13) {
          const name = pack[exercise.id]
          const other = seen.get(name)
          if (other) expect(other.n, `${name}: ${other.id} vs ${exercise.id}`).toBe(exercise.n)
          else seen.set(name, exercise)
        }
      })
    }

    test('shows the translation first with the English title in parentheses, and can hide or replace it', () => {
      // One whose name differs from the English, or the loanword rule below takes over.
      const exercise = EXDB.find(e => pack[e.id] && pack[e.id].toLocaleLowerCase(lang) !== e.n.toLocaleLowerCase('en'))
      const name = pack[exercise.id]
      _setLangState(lang, {}, null, pack)
      expect(exerciseNameFor(exercise)).toBe(`${name} (${exercise.n})`)
      expect(exerciseNameSearchText(exercise)).toContain(name)
      expect(exerciseNameSearchText(exercise)).toContain(exercise.n)
      _setLangState(lang, {}, null, pack, false)
      expect(exerciseNameFor(exercise)).toBe(name)
      _setLangState(lang, {}, null, pack, true, true)
      expect(exerciseNameFor(exercise)).toBe(exercise.n)
    })

    test('falls back to the English title, never translates custom exercises or changes other languages', () => {
      const exercise = EXDB.find(e => pack[e.id])
      const { [exercise.id]: _, ...without } = pack
      _setLangState(lang, {}, null, without)
      expect(exerciseNameFor(exercise)).toBe(exercise.n)
      const custom = { id: 'custom-1', n: 'My own exercise' }
      _setLangState(lang, {}, null, pack)
      expect(exerciseNameFor(custom)).toBe('My own exercise')
      _setLangState('en', {}, null, null)
      expect(exerciseNameFor(exercise)).toBe(exercise.n)
    })

    if (rules.loanword) {
      test('keeps loanword names without duplicating the English title', () => {
        _setLangState(lang, {}, null, pack)
        expect(exerciseNameFor(EXIDX.get('1160'))).toBe('burpee')
      })
    }
  })
}

// de-CH derives from the German pack by replacing ß with ss, so the base pack must be the ß one
// or the Swiss locale derives nothing. A name written with ss there would pass every other test.
test('de-CH derives the Swiss spelling from the German pack', () => {
  const de = packs['../exercise-names/de.js']
  const withSharpS = Object.entries(de).filter(([, name]) => name.includes('ß'))
  expect(withSharpS.length).toBeGreaterThan(0)
  const swiss = derivePack('de-CH', de)
  for (const [id, name] of withSharpS) {
    expect(swiss[id], id).toBe(name.replaceAll('ß', 'ss'))
    expect(swiss[id], id).not.toContain('ß')
  }
})
