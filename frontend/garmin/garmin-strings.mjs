#!/usr/bin/env node
// Writes the Garmin watch app's strings (garmin/resources*/strings/strings.xml) in every language
// both the app and Connect IQ speak. Nothing is translated twice: the watch says what the Wear OS
// watch says (android/wear/src/main/res/values*/strings.xml, itself made from the app's packs and
// the Apple Watch's strings by wear-strings.mjs), two more words come from the app's own packs,
// and the three phrases only this watch says are below. Run it after changing any of them, and
// commit what it writes:
//
//   node frontend/garmin/garmin-strings.mjs
//
// Connect IQ has no Hindi or Bengali, and one Portuguese (the app's pt, which pt-BR builds on).
// A watch set to one of those, or to any language not here, gets English.
//
// Copy tone (CONTRIBUTING.md): plain, human, a bit witty, never an em dash.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..')
const wearRes = join(frontend, 'android', 'wear', 'src', 'main', 'res')

// Connect IQ language → [Wear OS values folder, app pack].
const LANGS = {
  eng: ['values', null], deu: ['values-de', 'de'], fre: ['values-fr', 'fr'], spa: ['values-es', 'es'],
  ita: ['values-it', 'it'], por: ['values-pt', 'pt'], pol: ['values-pl', 'pl'], hun: ['values-hu', 'hu'],
  tur: ['values-tr', 'tr'], rus: ['values-ru', 'ru'], ukr: ['values-uk', 'uk'], ara: ['values-ar', 'ar'],
  tha: ['values-th', 'th'], kor: ['values-ko', 'ko'], swe: ['values-sv', 'sv'], zhs: ['values-zh', 'zh'],
  zht: ['values-zh-rTW', 'zh-TW'],
}

// The Wear OS strings this watch uses.
const FROM_WEAR = [
  'app_name', 'done', 'skip', 'skip_set', 'rest', 'rest_over', 'today', 'start_workout', 'quick_start', 'routines',
  'finish_workout', 'finish_workout_q', 'finish_and_save', 'discard_workout', 'continue_workout', 'workout_saved',
  'ended_on_phone', 'set_of', 'sets', 'volume', 'time', 'heart_rate', 'week_streak', 'warmup', 'left', 'right',
  'superset', 'weight', 'reps', 'hold', 'bodyweight', 'not_synced', 'open_phone_once', 'rest_day', 'start_on_phone',
  'no_workout', 'workout', 'last_time', 'next_set', 'log_on_phone', 'phone_away', 'saved_later', 'all_sets_done', 'prs',
]
// resource name → the app's key.
const FROM_APP = { discard_q: 'Discard workout?', next_exercise: 'Next exercise' }

// Only this watch says these.
const OWN = {
  next_on_phone: {
    eng: 'Next exercise is on its way from your phone.', deu: 'Die nächste Übung kommt gleich vom Handy.',
    fre: 'Le prochain exercice arrive de ton téléphone.', spa: 'El siguiente ejercicio viene de camino desde tu móvil.',
    ita: 'Il prossimo esercizio sta arrivando dal telefono.', por: 'O próximo exercício vem a caminho do telemóvel.',
    pol: 'Następne ćwiczenie jest już w drodze z telefonu.', hun: 'A következő gyakorlat már úton van a telefonról.',
    tur: 'Sıradaki egzersiz telefonundan yolda.', rus: 'Следующее упражнение уже летит с телефона.',
    ukr: 'Наступна вправа вже летить з телефона.', ara: 'التمرين التالي في الطريق من هاتفك.',
    tha: 'ท่าถัดไปกำลังมาจากโทรศัพท์', kor: '다음 운동이 휴대폰에서 오는 중이에요.',
    swe: 'Nästa övning är på väg från telefonen.', zhs: '下一个动作正从手机赶来。', zht: '下一個動作正從手機趕來。',
  },
  waiting_phone: {
    eng: 'Waiting for your phone. Open openGym there if it takes a while.',
    deu: 'Warte aufs Handy. Öffne dort openGym, falls es dauert.',
    fre: 'On attend ton téléphone. Ouvre openGym dessus si ça traîne.',
    spa: 'Esperando a tu móvil. Abre openGym allí si tarda.',
    ita: 'In attesa del telefono. Apri openGym lì se ci mette tanto.',
    por: 'À espera do telemóvel. Abre lá o openGym se demorar.',
    pol: 'Czekam na telefon. Otwórz tam openGym, jeśli to potrwa.',
    hun: 'Várok a telefonra. Ha sokáig tart, nyisd meg ott az openGymet.',
    tur: 'Telefonun bekleniyor. Uzun sürerse orada openGym’i aç.',
    rus: 'Ждём телефон. Если долго, откройте там openGym.',
    ukr: 'Чекаю на телефон. Якщо довго, відкрий там openGym.',
    ara: 'بانتظار هاتفك. افتح openGym عليه إذا تأخر.',
    tha: 'กำลังรอโทรศัพท์ ถ้านานไป ให้เปิด openGym บนโทรศัพท์',
    kor: '휴대폰을 기다리는 중이에요. 오래 걸리면 거기서 openGym을 열어 주세요.',
    swe: 'Väntar på telefonen. Öppna openGym där om det dröjer.',
    zhs: '正在等手机。太久的话，在手机上打开 openGym。', zht: '正在等手機。太久的話，在手機上打開 openGym。',
  },
  record_gc: {
    eng: 'Also save to Garmin Connect', deu: 'Auch in Garmin Connect speichern', fre: 'Enregistrer aussi dans Garmin Connect',
    spa: 'Guardar también en Garmin Connect', ita: 'Salva anche in Garmin Connect', por: 'Guardar também no Garmin Connect',
    pol: 'Zapisuj też w Garmin Connect', hun: 'Mentés a Garmin Connectbe is', tur: 'Garmin Connect’e de kaydet',
    rus: 'Сохранять и в Garmin Connect', ukr: 'Зберігати й у Garmin Connect', ara: 'احفظ في Garmin Connect أيضًا',
    tha: 'บันทึกลง Garmin Connect ด้วย', kor: 'Garmin Connect에도 저장', swe: 'Spara även i Garmin Connect',
    zhs: '同时保存到 Garmin Connect', zht: '同時儲存到 Garmin Connect',
  },
}

/* ---------- reading the sources ---------- */

// Android's escaping undone, XML entities kept as they are (they go back into XML).
const unescapeAndroid = s => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\@/g, '@').replace(/\\\?/g, '?').replace(/\\\\/g, '\\')
function readWear (folder) {
  const out = {}
  const xml = readFileSync(join(wearRes, folder, 'strings.xml'), 'utf8')
  for (const m of xml.matchAll(/<string name="([a-z0-9_]+)">([\s\S]*?)<\/string>/g)) out[m[1]] = unescapeAndroid(m[2])
  return out
}
const loadPack = async lang => (await import(pathToFileURL(join(frontend, 'src', 'locales', `${lang}.js`)).href)).default
const xmlEscape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Android's "%1$s" and "%2$d" → Monkey C's Lang.format "$1$" and "$2$".
const ciqFormat = s => s.replace(/%(\d)\$[sd]/g, '$$$1$$')

function check (lang, name, value) {
  if (value == null || value === '') throw new Error(`${lang} ${name}: missing`)
  if (/—/.test(value)) throw new Error(`${lang} ${name}: no em dashes in app copy`)
  if (/%\d?\$?[sd@]/.test(value)) throw new Error(`${lang} ${name}: a placeholder Monkey C cannot fill: ${value}`)
  return value
}

/* ---------- writing ---------- */

for (const [lang, [folder, pack]] of Object.entries(LANGS)) {
  const wear = readWear(folder)
  const base = lang === 'eng' ? wear : readWear('values')
  const app = pack ? await loadPack(pack) : {}
  const strings = {}
  for (const k of FROM_WEAR) strings[k] = check(lang, k, ciqFormat(wear[k] ?? base[k]))
  for (const [k, key] of Object.entries(FROM_APP)) strings[k] = check(lang, k, xmlEscape(app[key] || key))
  for (const [k, by] of Object.entries(OWN)) strings[k] = check(lang, k, xmlEscape(by[lang]))
  const dir = join(here, lang === 'eng' ? 'resources' : `resources-${lang}`, 'strings')
  mkdirSync(dir, { recursive: true })
  const body = Object.keys(strings).sort().map(k => `    <string id="${k}">${strings[k]}</string>`).join('\n')
  writeFileSync(join(dir, 'strings.xml'), `<!-- openGym on Garmin, ${lang}. Written by frontend/garmin/garmin-strings.mjs: change that, not this. -->
<strings>
${body}
</strings>
`)
}
console.log(`garmin strings: ${Object.keys(LANGS).length} languages`)
