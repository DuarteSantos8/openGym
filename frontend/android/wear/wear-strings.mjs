#!/usr/bin/env node
// Writes the Wear OS app's strings (wear/src/main/res/values*/strings.xml) in every language the
// app speaks. Words the app already has come from its own locale packs (frontend/src/locales), so
// the watch says "Done" exactly as the phone does; phrases the Apple Watch already says come from
// its strings (ios/App/Watch/<lang>.lproj, written by ios/ci/watch-strings.mjs); the few only this
// watch says are below. Run it after changing any of them, and commit what it writes:
//
//   node frontend/android/wear/wear-strings.mjs
//
// Copy tone (CONTRIBUTING.md): plain, human, a bit witty, never an em dash.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = join(here, '..', '..')
const res = join(here, 'src', 'main', 'res')
const watchStrings = join(frontend, 'ios', 'App', 'Watch')

// app pack → [Android values folder(s), Apple Watch .lproj or null]
const LANGS = {
  de: [['values-de'], 'de'], fr: [['values-fr'], 'fr'], es: [['values-es'], 'es'], it: [['values-it'], 'it'],
  pt: [['values-pt'], 'pt-PT'], 'pt-BR': [['values-pt-rBR'], 'pt-BR'], pl: [['values-pl'], 'pl'],
  hu: [['values-hu'], 'hu'], tr: [['values-tr'], 'tr'], ru: [['values-ru'], 'ru'], uk: [['values-uk'], 'uk'],
  ar: [['values-ar'], 'ar'], hi: [['values-hi'], 'hi'], bn: [['values-bn'], 'bn'], th: [['values-th'], 'th'],
  ko: [['values-ko'], 'ko'], sv: [['values-sv'], null], zh: [['values-zh'], 'zh-Hans'],
  'zh-TW': [['values-zh-rTW', 'values-zh-rHK'], 'zh-Hant'],
}

// resource name → the app's key, for words the app already has.
const FROM_APP = {
  today: 'Today', start_workout: 'Start workout', done: 'Done', warmup: 'Warm-up', reps: 'Reps',
  rest: 'Rest', skip: 'Skip', finish_workout: 'Finish workout', finish_workout_q: 'Finish workout?',
  finish_and_save: 'Finish and save', discard_workout: 'Discard workout', continue_workout: 'Continue workout',
  cancel: 'Cancel', rest_over: 'Rest’s over. Next set!', left: 'Left', right: 'Right', bodyweight: 'Bodyweight',
  superset: 'Superset', weight: 'Weight', sets: 'Sets', volume: 'Volume', time: 'Time', skip_set: 'Skip set',
  prs: 'PRs', routines: 'Routines', heart_rate: 'Heart rate', week_streak: 'Week streak', allow: 'Allow',
  not_now: 'Not now', workout: 'Workout', less: 'Less', more: 'More',
}
// Built from an app word.
const COMPOSED = { last_time: ['Last time', w => `${w}: %1$s`] }

// resource name → the Apple Watch's key (its %@ and %lld become Android's %1$s / %1$d).
const FROM_WATCH = {
  no_workout: 'No workout running', not_synced: 'Not synced yet', all_sets_done: 'All sets done',
  next_set: 'Next: %@, set %lld', set_of: 'Set %lld of %lld', sets_of: '%lld of %lld sets', hold: 'Hold',
  stop: 'Stop', start_hold: 'Start hold', workout_saved: 'Workout saved', added_weight: 'Added weight',
  saved_later: 'Saved on the watch, syncs later', all_done_q: 'All done?',
}
// The Apple Watch has no Swedish yet: these are this watch's own.
const SV_WATCH = {
  no_workout: 'Inget pass pågår', not_synced: 'Inte synkat än', all_sets_done: 'Alla set klara',
  next_set: 'Nästa: %1$s, set %2$d', set_of: 'Set %1$d av %2$d', sets_of: '%1$d av %2$d set', hold: 'Håll',
  stop: 'Stopp', start_hold: 'Starta håll', workout_saved: 'Passet sparat', added_weight: 'Extra vikt',
  saved_later: 'Sparat på klockan, synkas senare', all_done_q: 'Klart?',
}

// Only this watch says these ("phone", not "iPhone"; the crown is not a Digital Crown).
const OWN = {
  open_phone_once: {
    en: 'Open openGym on your phone once and your routines show up here.',
    de: 'Öffne openGym einmal auf dem Handy, dann tauchen deine Routinen hier auf.',
    fr: 'Ouvre openGym une fois sur ton téléphone et tes routines apparaissent ici.',
    es: 'Abre openGym una vez en tu móvil y tus rutinas aparecerán aquí.',
    it: 'Apri openGym una volta sul telefono e le tue routine compaiono qui.',
    pt: 'Abre o openGym uma vez no telemóvel e as tuas rotinas aparecem aqui.',
    'pt-BR': 'Abra o openGym uma vez no celular e suas rotinas aparecem aqui.',
    pl: 'Otwórz raz openGym na telefonie, a twoje plany pojawią się tutaj.',
    hu: 'Nyisd meg egyszer az openGymet a telefonon, és itt lesznek a rutinjaid.',
    tr: 'openGym’i telefonunda bir kez aç, rutinlerin burada görünür.',
    ru: 'Откройте openGym на телефоне один раз, и ваши программы появятся здесь.',
    uk: 'Відкрий openGym на телефоні один раз, і твої програми з’являться тут.',
    ar: 'افتح openGym على هاتفك مرة واحدة وستظهر تمارينك الروتينية هنا.',
    hi: 'फ़ोन पर openGym एक बार खोलें, आपके रूटीन यहाँ दिखेंगे।',
    bn: 'ফোনে openGym একবার খুলুন, আপনার রুটিন এখানে দেখা যাবে।',
    th: 'เปิด openGym บนโทรศัพท์สักครั้ง แล้วรูทีนของคุณจะแสดงที่นี่',
    ko: '휴대폰에서 openGym을 한 번 열면 루틴이 여기에 나타나요.',
    sv: 'Öppna openGym på telefonen en gång så dyker dina rutiner upp här.',
    zh: '在手机上打开一次 openGym，你的训练计划就会出现在这里。',
    'zh-TW': '在手機上打開一次 openGym，你的訓練計畫就會出現在這裡。',
  },
  start_on_phone: {
    en: 'Start one on your phone and it shows up here.',
    de: 'Starte eins auf dem Handy, dann taucht es hier auf.',
    fr: 'Lances-en une sur ton téléphone et elle apparaît ici.',
    es: 'Empieza uno en tu móvil y aparecerá aquí.',
    it: 'Avviane uno sul telefono e compare qui.',
    pt: 'Começa um no telemóvel e aparece aqui.',
    'pt-BR': 'Comece um no celular e ele aparece aqui.',
    pl: 'Zacznij trening na telefonie, a pojawi się tutaj.',
    hu: 'Indíts egyet a telefonon, és itt megjelenik.',
    tr: 'Telefonunda bir tane başlat, burada görünür.',
    ru: 'Начните её на телефоне, и она появится здесь.',
    uk: 'Почни його на телефоні, і воно з’явиться тут.',
    ar: 'ابدأ تمرينًا على هاتفك وسيظهر هنا.',
    hi: 'फ़ोन पर एक शुरू करें, यह यहाँ दिखेगा।',
    bn: 'ফোনে একটি শুরু করুন, এখানে দেখা যাবে।',
    th: 'เริ่มบนโทรศัพท์ แล้วจะแสดงที่นี่',
    ko: '휴대폰에서 시작하면 여기에 나타나요.',
    sv: 'Starta ett på telefonen så dyker det upp här.',
    zh: '在手机上开始，它就会出现在这里。',
    'zh-TW': '在手機上開始，它就會出現在這裡。',
  },
  ended_on_phone: {
    en: 'Ended on your phone', de: 'Am Handy beendet', fr: 'Terminée sur ton téléphone', es: 'Terminado en tu móvil',
    it: 'Terminato sul telefono', pt: 'Terminado no telemóvel', 'pt-BR': 'Encerrado no celular', pl: 'Zakończono na telefonie',
    hu: 'A telefonon befejezve', tr: 'Telefonda bitirildi', ru: 'Завершено на телефоне', uk: 'Завершено на телефоні',
    ar: 'انتهى على الهاتف', hi: 'फ़ोन पर खत्म हुआ', bn: 'ফোনে শেষ হয়েছে', th: 'จบบนโทรศัพท์แล้ว', ko: '휴대폰에서 끝났어요',
    sv: 'Avslutat på telefonen', zh: '已在手机上结束', 'zh-TW': '已在手機上結束',
  },
  log_on_phone: {
    en: 'Log this one on your phone.', de: 'Das hier trägst du am Handy ein.', fr: 'Celle-ci se note sur ton téléphone.',
    es: 'Este se registra en tu móvil.', it: 'Questo si registra sul telefono.', pt: 'Este regista-se no telemóvel.',
    'pt-BR': 'Este você registra no celular.', pl: 'To zapisz na telefonie.', hu: 'Ezt a telefonon rögzítsd.',
    tr: 'Bunu telefonda kaydet.', ru: 'Это записывается на телефоне.', uk: 'Це записуй на телефоні.',
    ar: 'سجّل هذا على هاتفك.', hi: 'इसे फ़ोन पर दर्ज करें।', bn: 'এটা ফোনে লিখুন।', th: 'อันนี้บันทึกบนโทรศัพท์',
    ko: '이건 휴대폰에서 기록하세요.', sv: 'Logga det här på telefonen.', zh: '这个请在手机上记录。', 'zh-TW': '這個請在手機上記錄。',
  },
  crown_hint: {
    en: 'Turn the crown to change it.', de: 'Dreh an der Krone, um es zu ändern.', fr: 'Tourne la couronne pour le changer.',
    es: 'Gira la corona para cambiarlo.', it: 'Ruota la corona per cambiarlo.', pt: 'Roda a coroa para alterar.',
    'pt-BR': 'Gire a coroa para mudar.', pl: 'Obróć koronkę, by zmienić.', hu: 'Forgasd a koronát a módosításhoz.',
    tr: 'Değiştirmek için kronu çevir.', ru: 'Поверните колёсико, чтобы изменить.', uk: 'Поверни коліщатко, щоб змінити.',
    ar: 'أدر التاج للتغيير.', hi: 'बदलने के लिए क्राउन घुमाएँ।', bn: 'বদলাতে ক্রাউন ঘোরান।', th: 'หมุนเม็ดมะยมเพื่อเปลี่ยน',
    ko: '바꾸려면 크라운을 돌리세요.', sv: 'Vrid på kronan för att ändra.', zh: '转动表冠来更改。', 'zh-TW': '轉動錶冠來更改。',
  },
  quick_start: {
    en: 'Quick start', de: 'Schnellstart', fr: 'Démarrage rapide', es: 'Inicio rápido', it: 'Avvio rapido', pt: 'Início rápido',
    'pt-BR': 'Início rápido', pl: 'Szybki start', hu: 'Gyors indítás', tr: 'Hızlı başlat', ru: 'Быстрый старт', uk: 'Швидкий старт',
    ar: 'بدء سريع', hi: 'क्विक स्टार्ट', bn: 'দ্রুত শুরু', th: 'เริ่มด่วน', ko: '빠른 시작', sv: 'Snabbstart', zh: '快速开始', 'zh-TW': '快速開始',
  },
  rest_day: {
    en: 'Nothing planned. Your call.', de: 'Nichts geplant. Deine Entscheidung.', fr: 'Rien de prévu. À toi de voir.',
    es: 'Nada planeado. Tú decides.', it: 'Niente in programma. Decidi tu.', pt: 'Nada planeado. Tu decides.',
    'pt-BR': 'Nada planejado. Você decide.', pl: 'Nic nie zaplanowano. Twój wybór.', hu: 'Nincs terv. Rajtad áll.',
    tr: 'Plan yok. Karar senin.', ru: 'Ничего не запланировано. Решать вам.', uk: 'Нічого не заплановано. Тобі вирішувати.',
    ar: 'لا شيء مخطط. القرار لك.', hi: 'कुछ तय नहीं। आपकी मर्ज़ी।', bn: 'কিছু পরিকল্পনা নেই। আপনার সিদ্ধান্ত।',
    th: 'ไม่มีแผน คุณเลือกเอง', ko: '계획 없음. 마음대로 하세요.', sv: 'Inget planerat. Ditt val.', zh: '今天没计划。你说了算。',
    'zh-TW': '今天沒計畫。你說了算。',
  },
  tile_desc: {
    en: 'Your streak and today’s plan.', de: 'Deine Serie und der Plan für heute.', fr: 'Ta régularité et le programme du jour.',
    es: 'Tu racha y el plan de hoy.', it: 'La tua costanza e il piano di oggi.', pt: 'A tua sequência e o plano de hoje.',
    'pt-BR': 'Sua sequência e o plano de hoje.', pl: 'Twoja seria tygodni i plan na dziś.', hu: 'A heti sorozatod és a mai terv.',
    tr: 'Serin ve bugünün planı.', ru: 'Ваша серия недель и план на сегодня.', uk: 'Твоя серія тижнів і план на сьогодні.',
    ar: 'سلسلتك وخطة اليوم.', hi: 'आपकी स्ट्रीक और आज का प्लान।', bn: 'আপনার স্ট্রিক আর আজকের পরিকল্পনা।',
    th: 'สถิติต่อเนื่องและแผนของวันนี้', ko: '연속 기록과 오늘의 계획.', sv: 'Din svit och dagens plan.',
    zh: '你的连续周数和今天的计划。', 'zh-TW': '你的連續週數和今天的計畫。',
  },
  complication_desc: {
    en: 'Your sets so far, or your streak.', de: 'Deine Sätze bisher oder deine Serie.', fr: 'Tes séries faites, ou ta régularité.',
    es: 'Tus series hasta ahora, o tu racha.', it: 'Le serie fatte finora, o la tua costanza.', pt: 'As séries feitas até agora, ou a tua sequência.',
    'pt-BR': 'Suas séries até agora, ou sua sequência.', pl: 'Twoje dotychczasowe serie albo seria tygodni.',
    hu: 'Az eddigi sorozataid vagy a heti sorozatod.', tr: 'Şimdiye kadarki setlerin ya da serin.',
    ru: 'Подходы на сейчас или ваша серия недель.', uk: 'Твої підходи досі або серія тижнів.', ar: 'مجموعاتك حتى الآن، أو سلسلتك.',
    hi: 'अब तक के सेट, या आपकी स्ट्रीक।', bn: 'এখন পর্যন্ত আপনার সেট, বা আপনার স্ট্রিক।', th: 'เซ็ตที่ทำแล้ว หรือสถิติต่อเนื่องของคุณ',
    ko: '지금까지 한 세트, 또는 연속 기록.', sv: 'Dina set hittills, eller din svit.', zh: '目前完成的组数，或你的连续周数。',
    'zh-TW': '目前完成的組數，或你的連續週數。',
  },
  notif_running: {
    en: 'Workout running. Tap to jump back in.', de: 'Training läuft. Tippen und weiter geht’s.', fr: 'Séance en cours. Touche pour y revenir.',
    es: 'Entreno en curso. Toca para volver.', it: 'Allenamento in corso. Tocca per tornarci.', pt: 'Treino a decorrer. Toca para voltar.',
    'pt-BR': 'Treino em andamento. Toque para voltar.', pl: 'Trening trwa. Stuknij, by wrócić.', hu: 'Edzés folyamatban. Koppints a visszatéréshez.',
    tr: 'Antrenman sürüyor. Geri dönmek için dokun.', ru: 'Тренировка идёт. Нажмите, чтобы вернуться.', uk: 'Тренування триває. Торкнись, щоб повернутися.',
    ar: 'التمرين جارٍ. اضغط للعودة.', hi: 'वर्कआउट चल रहा है। वापस जाने के लिए टैप करें।', bn: 'ওয়ার্কআউট চলছে। ফিরে যেতে ট্যাপ করুন।',
    th: 'กำลังฝึกอยู่ แตะเพื่อกลับไป', ko: '운동 중이에요. 탭해서 돌아가요.', sv: 'Passet pågår. Tryck för att hoppa in igen.',
    zh: '训练进行中。点按返回。', 'zh-TW': '訓練進行中。點一下返回。',
  },
  hr_why: {
    en: 'Allow heart rate to see your pulse on every set.', de: 'Erlaube den Puls, dann siehst du ihn bei jedem Satz.',
    fr: 'Autorise la fréquence cardiaque pour voir ton pouls à chaque série.', es: 'Permite el pulso para verlo en cada serie.',
    it: 'Consenti il battito per vederlo a ogni serie.', pt: 'Permite a frequência cardíaca para veres o pulso em cada série.',
    'pt-BR': 'Permita a frequência cardíaca para ver seu pulso em cada série.', pl: 'Zezwól na tętno, by widzieć je przy każdej serii.',
    hu: 'Engedélyezd a pulzust, hogy minden sorozatnál lásd.', tr: 'Her sette nabzını görmek için kalp atış hızına izin ver.',
    ru: 'Разрешите пульс, чтобы видеть его в каждом подходе.', uk: 'Дозволь пульс, щоб бачити його в кожному підході.',
    ar: 'اسمح بقراءة النبض لتراه في كل مجموعة.', hi: 'हर सेट पर अपनी धड़कन देखने के लिए हार्ट रेट की अनुमति दें।',
    bn: 'প্রতিটি সেটে পালস দেখতে হার্ট রেটের অনুমতি দিন।', th: 'อนุญาตอัตราการเต้นของหัวใจเพื่อดูชีพจรทุกเซ็ต',
    ko: '세트마다 심박수를 보려면 허용하세요.', sv: 'Tillåt puls för att se den vid varje set.', zh: '允许读取心率，每组都能看到脉搏。',
    'zh-TW': '允許讀取心率，每組都能看到脈搏。',
  },
  phone_away: {
    en: 'Phone out of reach. Your sets wait here.', de: 'Handy außer Reichweite. Deine Sätze warten hier.',
    fr: 'Téléphone hors de portée. Tes séries attendent ici.', es: 'Móvil fuera de alcance. Tus series esperan aquí.',
    it: 'Telefono fuori portata. Le tue serie aspettano qui.', pt: 'Telemóvel fora de alcance. As tuas séries esperam aqui.',
    'pt-BR': 'Celular fora de alcance. Suas séries esperam aqui.', pl: 'Telefon poza zasięgiem. Twoje serie czekają tutaj.',
    hu: 'A telefon hatótávon kívül. A sorozataid itt várnak.', tr: 'Telefon menzil dışında. Setlerin burada bekliyor.',
    ru: 'Телефон вне зоны. Ваши подходы ждут здесь.', uk: 'Телефон поза зоною. Твої підходи чекають тут.',
    ar: 'الهاتف خارج النطاق. مجموعاتك تنتظر هنا.', hi: 'फ़ोन पहुँच से बाहर है। आपके सेट यहीं इंतज़ार कर रहे हैं।',
    bn: 'ফোন নাগালের বাইরে। আপনার সেট এখানে অপেক্ষা করছে।', th: 'โทรศัพท์อยู่นอกระยะ เซ็ตของคุณรออยู่ที่นี่',
    ko: '휴대폰이 멀리 있어요. 세트는 여기서 기다려요.', sv: 'Telefonen är utom räckhåll. Dina set väntar här.',
    zh: '手机不在范围内。你的组数先存在这里。', 'zh-TW': '手機不在範圍內。你的組數先存在這裡。',
  },
}

/* ---------- reading the sources ---------- */

const loadPack = async lang => (await import(pathToFileURL(join(frontend, 'src', 'locales', `${lang}.js`)).href)).default

function readLproj (name) {
  const f = join(watchStrings, `${name}.lproj`, 'Localizable.strings')
  if (!existsSync(f)) return {}
  const out = {}
  for (const m of readFileSync(f, 'utf8').matchAll(/^"((?:[^"\\]|\\.)*)" = "((?:[^"\\]|\\.)*)";$/gm)) out[m[1]] = m[2].replace(/\\"/g, '"')
  return out
}

// "%@, set %lld" → "%1$s, set %2$d": numbered, so a language may put them in another order.
function androidFormat (s) {
  let n = 0
  return s.replace(/%(@|lld|d)/g, (_, k) => `%${++n}$${k === '@' ? 's' : 'd'}`)
}

// Android's string resource escaping: apostrophes, quotes, a leading @ or ?, and XML.
const xmlEscape = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const resEscape = s => xmlEscape(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/^([@?])/, '\\$1')

const NO_DASH = /\u2014/
function check (lang, name, value) {
  if (NO_DASH.test(value)) throw new Error(`${lang} ${name}: no em dashes in app copy`)
  return value
}

function write (folder, strings, comment) {
  const dir = join(res, folder)
  mkdirSync(dir, { recursive: true })
  const body = Object.keys(strings).sort().map(k => `    <string name="${k}">${resEscape(strings[k])}</string>`).join('\n')
  writeFileSync(join(dir, 'strings.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- openGym on Wear OS, ${comment}. Written by frontend/android/wear/wear-strings.mjs: change that, not this. -->
<resources>
${body}
</resources>
`)
}

/* ---------- writing ---------- */

const enWatch = readLproj('en')
const en = { app_name: 'openGym' }
for (const [name, key] of Object.entries(FROM_APP)) en[name] = key
for (const [name, [key, fmt]] of Object.entries(COMPOSED)) en[name] = fmt(key)
for (const [name, key] of Object.entries(FROM_WATCH)) en[name] = androidFormat(enWatch[key] || key)
for (const [name, tr] of Object.entries(OWN)) en[name] = tr.en
for (const [k, v] of Object.entries(en)) check('en', k, v)
write('values', en, 'English')

const pt = await loadPack('pt')
const missing = []
for (const [lang, [folders, lproj]] of Object.entries(LANGS)) {
  const pack = lang === 'pt-BR' ? { ...pt, ...(await loadPack('pt-BR')) } : await loadPack(lang)
  const watch = lproj ? readLproj(lproj) : {}
  const out = {}
  for (const [name, key] of Object.entries(FROM_APP)) {
    // the app's word, else the Apple Watch's, else none (Android falls back to English)
    const v = pack[key] || watch[key]
    if (v) out[name] = v
    else missing.push(`${lang}:${name}`)
  }
  for (const [name, [key, fmt]] of Object.entries(COMPOSED)) if (pack[key]) out[name] = fmt(pack[key])
  for (const [name, key] of Object.entries(FROM_WATCH)) {
    const v = lproj ? watch[key] && androidFormat(watch[key]) : SV_WATCH[name]
    if (v) out[name] = v
    else missing.push(`${lang}:${name}`)
  }
  for (const [name, tr] of Object.entries(OWN)) {
    if (!tr[lang]) throw new Error(`${name} has no ${lang}`)
    out[name] = tr[lang]
  }
  for (const [k, v] of Object.entries(out)) check(lang, k, v)
  for (const f of folders) write(f, out, lang)
}
if (missing.length) console.log('falls back to English:', missing.join(' '))
console.log(`wrote ${Object.keys(LANGS).length + 1} languages, ${Object.keys(en).length} strings each`)
