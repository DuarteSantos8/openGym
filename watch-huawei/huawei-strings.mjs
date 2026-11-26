#!/usr/bin/env node
// Writes the Huawei watch's words, entry/src/main/js/MainAbility/common/texts.js, in every language
// the phone app has. Nothing is translated twice: the watch says what the Wear OS watch says
// (frontend/android/wear/src/main/res/values*/strings.xml, made from the app's packs and the Apple
// Watch's strings), two words come from the app's own packs, two phrases from the Garmin watch's
// generated strings (same wording as that watch), and the few only this watch says are below.
// Run it after changing any of them, and commit what it writes:
//
//   node watch-huawei/huawei-strings.mjs
//
// Copy tone (CONTRIBUTING.md): plain, human, never an em dash. Huawei's own i18n/*.json only follows
// the watch's language, so it is not used for these.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', 'frontend')
const wearRes = join(frontend, 'android', 'wear', 'src', 'main', 'res')
export const OUT = join(here, 'entry', 'src', 'main', 'js', 'MainAbility', 'common', 'texts.js')

// the app's language -> [Wear OS values folder, Garmin resources folder (or null)]
export const LANGS = {
  en: ['values', 'resources'], de: ['values-de', 'resources-deu'], fr: ['values-fr', 'resources-fre'], es: ['values-es', 'resources-spa'],
  it: ['values-it', 'resources-ita'], pt: ['values-pt', 'resources-por'], 'pt-BR': ['values-pt-rBR', null], pl: ['values-pl', 'resources-pol'],
  hu: ['values-hu', 'resources-hun'], tr: ['values-tr', 'resources-tur'], ru: ['values-ru', 'resources-rus'], uk: ['values-uk', 'resources-ukr'],
  ar: ['values-ar', 'resources-ara'], hi: ['values-hi', null], bn: ['values-bn', null], th: ['values-th', 'resources-tha'],
  ko: ['values-ko', 'resources-kor'], sv: ['values-sv', 'resources-swe'], zh: ['values-zh', 'resources-zhs'], 'zh-TW': ['values-zh-rTW', 'resources-zht'],
  cs: ['values-cs', 'resources-ces'], id: ['values-id', 'resources-ind'], lt: ['values-lt', 'resources-lit'], da: ['values-da', 'resources-dan'],
  vi: ['values-vi', 'resources-vie'], fa: ['values-fa', null],
}

// What the screens say, in the order the table keeps them.
const FROM_WEAR = [
  'all_sets_done', 'all_synced', 'cancel', 'continue_workout', 'discard_workout', 'discard_workout_q', 'done', 'edit', 'effort',
  'ended_on_phone', 'exercises', 'finish_and_save', 'finish_workout', 'finish_workout_q', 'go', 'hold', 'hr_avg_max', 'how_hard',
  'keep_going', 'last_time', 'left', 'left_gym', 'log_on_phone', 'next_set_btn', 'no_set_for', 'no_workout', 'not_synced', 'overview',
  'phone_out_of_reach', 'previous_set', 'quick_start', 'reps', 'rest', 'rest_day', 'right', 'routines', 'save', 'set_of', 'sets',
  'sets_of', 'skip', 'skip_set', 'start_hold', 'start_on_phone', 'start_workout', 'still_training', 'stop', 'time', 'today',
  'up_next', 'up_next_set', 'volume', 'waiting_sync', 'warmup', 'workout_saved',
  // step 1: the weigh-in, the check-in, "Added weight", the Overview's superset heading
  'added_weight', 'weight', 'body_weight', 'save_and_start', 'start_without_weighin', 'superset',
  'checkin_title', 'checkin_skip', 'checkin_sleep', 'checkin_sleep_lo', 'checkin_sleep_hi', 'checkin_energy', 'checkin_energy_lo', 'checkin_energy_hi',
  'checkin_sore', 'checkin_sore_lo', 'checkin_sore_hi',
  // step 2: the Metrics pages, the medal, the streak, the phone's reach
  'add_birth_year', 'avg', 'band_over', 'band_to', 'band_under', 'heart_rate', 'hours', 'max', 'min', 'min_minutes', 'muscles', 'n_more',
  'n_sets', 'new_record', 'no_age_set', 'no_effort_yet', 'no_sets_yet', 'phone_connected', 'phone_gone', 'records', 'week_streak', 'zones',
]
// (the app's packs have the set menu's words in every language; the Wear OS strings of this branch do not yet)
const FROM_APP = { next_exercise: 'Next exercise', paused: 'Paused', add_set: 'Add set', remove_set: 'Remove set' }
const FROM_GARMIN = ['next_on_phone', 'waiting_phone']
export const KEYS = FROM_WEAR.concat(Object.keys(FROM_APP), FROM_GARMIN, ['menu', 'open_phone_once', 'read_failed', 'try_again']).sort()

// Only this watch says these (and the languages the Garmin strings do not have).
const MENU = {
  en: 'Menu', de: 'Menü', fr: 'Menu', es: 'Menú', it: 'Menu', pt: 'Menu', 'pt-BR': 'Menu', pl: 'Menu', hu: 'Menü', tr: 'Menü', ru: 'Меню',
  uk: 'Меню', ar: 'القائمة', hi: 'मेन्यू', bn: 'মেনু', th: 'เมนู', ko: '메뉴', sv: 'Meny', zh: '菜单', 'zh-TW': '選單', cs: 'Nabídka',
  id: 'Menu', lt: 'Meniu', da: 'Menu', vi: 'Menu', fa: 'منو',
}
// The page's one message when the stored workout cannot be read, and its button.
const READ_FAILED = {
  en: 'Could not read your workout. Nothing was changed.', de: 'Training konnte nicht gelesen werden. Nichts wurde geändert.',
  fr: 'Impossible de lire ton entraînement. Rien n’a été modifié.', es: 'No se pudo leer tu entrenamiento. No se cambió nada.',
  it: 'Impossibile leggere l’allenamento. Non è cambiato nulla.', pt: 'Não foi possível ler o treino. Nada foi alterado.',
  'pt-BR': 'Não foi possível ler o treino. Nada foi alterado.', pl: 'Nie udało się odczytać treningu. Nic nie zmieniono.',
  hu: 'Nem sikerült beolvasni az edzést. Semmi sem változott.', tr: 'Antrenman okunamadı. Hiçbir şey değişmedi.',
  ru: 'Не удалось прочитать тренировку. Ничего не изменено.', uk: 'Не вдалося прочитати тренування. Нічого не змінено.',
  ar: 'تعذّرت قراءة تمرينك. لم يتغير شيء.', hi: 'आपकी कसरत पढ़ी नहीं जा सकी। कुछ नहीं बदला।',
  bn: 'আপনার ওয়ার্কআউট পড়া যায়নি। কিছু বদলায়নি।', th: 'อ่านการออกกำลังกายไม่ได้ ไม่มีอะไรเปลี่ยนแปลง',
  ko: '운동 기록을 읽지 못했어요. 바뀐 것은 없어요.', sv: 'Det gick inte att läsa passet. Inget har ändrats.',
  zh: '无法读取你的训练。没有任何改动。', 'zh-TW': '無法讀取你的訓練。沒有任何變更。', cs: 'Trénink se nepodařilo přečíst. Nic se nezměnilo.',
  id: 'Latihan tidak bisa dibaca. Tidak ada yang diubah.', lt: 'Nepavyko perskaityti treniruotės. Niekas nepakeista.',
  da: 'Kunne ikke læse træningen. Intet er ændret.', vi: 'Không đọc được buổi tập. Không có gì bị thay đổi.', fa: 'خواندن تمرین ممکن نشد. چیزی تغییر نکرد.',
}
const TRY_AGAIN = {
  en: 'Try again', de: 'Nochmal versuchen', fr: 'Réessayer', es: 'Reintentar', it: 'Riprova', pt: 'Tentar de novo', 'pt-BR': 'Tentar de novo',
  pl: 'Spróbuj ponownie', hu: 'Újra', tr: 'Tekrar dene', ru: 'Повторить', uk: 'Повторити', ar: 'حاول مجددًا', hi: 'फिर कोशिश करें',
  bn: 'আবার চেষ্টা করুন', th: 'ลองอีกครั้ง', ko: '다시 시도', sv: 'Försök igen', zh: '重试', 'zh-TW': '重試', cs: 'Zkusit znovu',
  id: 'Coba lagi', lt: 'Bandyti dar kartą', da: 'Prøv igen', vi: 'Thử lại', fa: 'تلاش دوباره',
}
// The Garmin's "open Settings, then Garmin" with Huawei in its place, where that reads right.
const OPEN_OWN = {
  hu: 'A telefonodon az openGymben nyisd meg a Beállításokat, majd a Huawei-t.',
  tr: 'Telefonundaki openGym’de Ayarlar’ı, sonra Huawei’yi aç.',
  'pt-BR': 'No openGym do celular, abra Configurações e depois Huawei.',
  hi: 'फ़ोन पर openGym में सेटिंग खोलें, फिर Huawei।',
  bn: 'ফোনে openGym-এ সেটিংস খুলুন, তারপর Huawei।',
  fa: 'در openGym روی گوشی، تنظیمات را باز کنید و سپس Huawei را.',
}
const PHRASE_OWN = {
  'pt-BR': { next_on_phone: 'O próximo exercício está a caminho do celular.', waiting_phone: 'Esperando o celular. Abra o openGym nele se demorar.' },
  hi: { next_on_phone: 'अगला व्यायाम फ़ोन से आ रहा है।', waiting_phone: 'फ़ोन का इंतज़ार है। देर हो तो वहाँ openGym खोलें।' },
  bn: { next_on_phone: 'পরের ব্যায়াম ফোন থেকে আসছে।', waiting_phone: 'ফোনের জন্য অপেক্ষা করছি। দেরি হলে সেখানে openGym খুলুন।' },
  fa: { next_on_phone: 'تمرین بعدی از گوشی در راه است.', waiting_phone: 'منتظر گوشی هستم. اگر طول کشید، openGym را آنجا باز کنید.' },
}

const entities = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
// Android's escaping undone, its numbered placeholders as ours ("%2$d" -> "{1}").
const unescapeAndroid = s => entities(s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\@/g, '@').replace(/\\\?/g, '?').replace(/\\\\/g, '\\'))
  .replace(/%(\d+)\$[sd]/g, (_, n) => '{' + (Number(n) - 1) + '}')

function readWear (folder) {
  const file = join(wearRes, folder, 'strings.xml')
  if (!existsSync(file)) throw new Error('missing ' + file)
  const out = {}
  for (const m of readFileSync(file, 'utf8').matchAll(/<string name="([a-z0-9_]+)">([\s\S]*?)<\/string>/g)) out[m[1]] = unescapeAndroid(m[2])
  return out
}
function readGarmin (folder) {
  const out = {}
  const xml = readFileSync(join(frontend, 'garmin', folder, 'strings', 'strings.xml'), 'utf8')
  for (const m of xml.matchAll(/<string id="([a-z_]+)">([\s\S]*?)<\/string>/g)) out[m[1]] = entities(m[2])
  return out
}
async function readPack (lang) {
  return (await import(pathToFileURL(join(frontend, 'src', 'locales', lang + '.js')).href)).default
}

function check (lang, key, value) {
  if (typeof value !== 'string' || !value) throw new Error(`${lang} ${key}: missing`)
  if (/—/.test(value)) throw new Error(`${lang} ${key}: no em dashes in app copy`)
  if (/\n/.test(value)) throw new Error(`${lang} ${key}: a line break would split the table`)
  if (/%\d?\$?[sd@]|\$\d\$/.test(value)) throw new Error(`${lang} ${key}: a placeholder the watch cannot fill: ${value}`)
  return value
}

export async function build () {
  const base = readWear('values')
  const out = {}
  for (const [lang, [folder, garmin]] of Object.entries(LANGS)) {
    const wear = readWear(folder)
    const pack = lang === 'en' ? {} : await readPack(lang)
    const gm = garmin ? readGarmin(garmin) : {}
    const row = {}
    for (const k of FROM_WEAR) row[k] = wear[k] ?? base[k]
    for (const [k, key] of Object.entries(FROM_APP)) row[k] = pack[key] || key
    for (const k of FROM_GARMIN) row[k] = (PHRASE_OWN[lang] || {})[k] ?? gm[k]
    row.menu = MENU[lang]
    row.read_failed = READ_FAILED[lang]
    row.try_again = TRY_AGAIN[lang]
    row.open_phone_once = OPEN_OWN[lang] ?? (gm.open_phone_once || '').replace(/Garmin/g, 'Huawei')
    for (const k of KEYS) check(lang, k, row[k])
    out[lang] = KEYS.map(k => row[k])
  }
  return out
}

export async function render () {
  const rows = await build()
  const head = '// The Huawei watch\'s words. Written by watch-huawei/huawei-strings.mjs: change that, not this.\n' +
    '// One line per word, in the order of KEYS, for each language; view.js splits the language in use.\n'
  const body = Object.entries(rows).map(([lang, row]) => ' ' + JSON.stringify(lang) + ': ' + JSON.stringify(row.join('\n'))).join(',\n')
  return head + 'export const KEYS = ' + JSON.stringify(KEYS) + '\nexport const TEXTS = {\n' + body + '\n}\n'
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, await render())
  console.log('wrote', OUT, 'for', Object.keys(LANGS).length, 'languages')
}
