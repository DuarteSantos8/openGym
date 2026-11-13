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
  ko: [['values-ko'], 'ko'], sv: [['values-sv'], 'sv'], zh: [['values-zh'], 'zh-Hans'],
  'zh-TW': [['values-zh-rTW', 'values-zh-rHK'], 'zh-Hant'],
  // 1.4.5: the Apple Watch speaks these too now, so the watch has all 24 of the app's languages.
  // Indonesian twice: Android's resources still know it by its old code "in" as well.
  cs: [['values-cs'], 'cs'], fa: [['values-fa'], 'fa'], id: [['values-in', 'values-id'], 'id'],
  lt: [['values-lt'], 'lt'], vi: [['values-vi'], 'vi'],
  da: [['values-da'], 'da'],
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
  // Forgotten workouts (1.4.5), the phone's own words.
  still_training: 'Still training?', left_gym: 'Looks like you left the gym', keep_going: 'Keep going', finish_now: 'Finish now',
}
// Built from an app word.
const COMPOSED = {
  last_time: ['Last time', w => `${w}: %1$s`],
  // The phone's sentences, with the time it ends by itself where the phone has {0}.
  idle_ends_at: ['Nothing logged for a while. If you’re done, it ends by itself at {0}, saved at your last set.', w => w.replace('{0}', '%1$s')],
  left_ends_at: ['Finish the workout now? Otherwise it ends by itself at {0}.', w => w.replace('{0}', '%1$s')],
}

// resource name → the Apple Watch's key (its %@ and %lld become Android's %1$s / %1$d).
const FROM_WATCH = {
  avg: 'avg', max: 'max', min: 'min', no_effort_yet: 'No effort rated yet',
  no_workout: 'No workout running', not_synced: 'Not synced yet', all_sets_done: 'All sets done',
  set_of: 'Set %lld of %lld', sets_of: '%lld of %lld sets', hold: 'Hold',
  stop: 'Stop', start_hold: 'Start hold', workout_saved: 'Workout saved', added_weight: 'Added weight',
  all_done_q: 'All done?',
  // The 1.4.5 redesign: the same words as the Apple Watch's.
  exercises: 'Exercises', save: 'Save', previous_set: 'Previous set', next_set_btn: 'Next set', overview: 'Overview',
  discard_workout_q: 'Discard workout?', up_next: 'Up next', up_next_set: '%@, set %lld', how_hard: 'How hard was that set?',
  waiting_sync: 'Waiting to sync', all_synced: 'All synced', go: 'Go!', personal_records: 'Personal records',
  quick_checkin: 'Quick check-in', save_and_start: 'Save & start workout', start_without_weighin: 'Start without weighing in',
  body_weight: 'Body weight', effort: 'Effort', hold_to_finish: 'Hold to finish', no_set_for: 'No set for %lld min. Still at it?',
  skipped_waiting: 'A skipped set is still waiting.', skip_set_q: 'Skip this set?', hr_avg_max: '%lld avg · %lld max',
  edit: 'Edit', tap_to_change: 'Tap to change it.', none: 'None', calories: 'Calories',
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

// 1.4.5: the five languages the watch learned, and the few lines only Wear OS says in the redesign
// ("phone", not "iPhone"; a remote for the music instead of Apple's Now Playing).
Object.assign(OWN.open_phone_once, {"cs": "Otevři jednou openGym v telefonu a tvoje rutiny se tu objeví.", "fa": "یک بار openGym را روی گوشی باز کن تا روال‌هایت اینجا بیایند.", "id": "Buka openGym sekali di ponselmu, rutinitasmu akan muncul di sini.", "lt": "Kartą atidaryk openGym telefone ir tavo rutinos atsiras čia.", "vi": "Mở openGym trên điện thoại một lần là các bài tập của bạn sẽ hiện ở đây."})
Object.assign(OWN.start_on_phone, {"cs": "Spusť ho v telefonu a objeví se tady.", "fa": "روی گوشی شروعش کن تا اینجا بیاید.", "id": "Mulai di ponselmu, nanti muncul di sini.", "lt": "Pradėk telefone ir jis atsiras čia.", "vi": "Bắt đầu trên điện thoại là nó hiện ở đây."})
Object.assign(OWN.ended_on_phone, {"cs": "Ukončeno v telefonu", "fa": "روی گوشی تمام شد", "id": "Diakhiri di ponsel", "lt": "Baigta telefone", "vi": "Đã kết thúc trên điện thoại"})
Object.assign(OWN.log_on_phone, {"cs": "Tohle zapiš v telefonu.", "fa": "این یکی را روی گوشی ثبت کن.", "id": "Yang ini dicatat di ponsel.", "lt": "Šitą įrašyk telefone.", "vi": "Bài này ghi trên điện thoại nhé."})
Object.assign(OWN.crown_hint, {"cs": "Otoč korunkou a změníš to.", "fa": "برای تغییر، تاج را بچرخان.", "id": "Putar mahkota untuk mengubahnya.", "lt": "Pasuk karūnėlę, kad pakeistum.", "vi": "Xoay núm để thay đổi."})
Object.assign(OWN.quick_start, {"cs": "Rychlý start", "fa": "شروع سریع", "id": "Mulai cepat", "lt": "Greitas startas", "vi": "Bắt đầu nhanh"})
Object.assign(OWN.rest_day, {"cs": "Nic v plánu. Je to na tobě.", "fa": "برنامه‌ای نیست. تصمیم با خودت.", "id": "Tidak ada rencana. Terserah kamu.", "lt": "Nieko nesuplanuota. Tu sprendi.", "vi": "Không có kế hoạch. Tùy bạn."})
Object.assign(OWN.tile_desc, {"cs": "Tvoje řada týdnů a dnešní plán.", "fa": "رکورد پیوسته‌ات و برنامهٔ امروز.", "id": "Rentetanmu dan rencana hari ini.", "lt": "Tavo serija ir šiandienos planas.", "vi": "Chuỗi tuần của bạn và kế hoạch hôm nay."})
Object.assign(OWN.complication_desc, {"cs": "Dosavadní série, nebo tvoje řada týdnů.", "fa": "ست‌های تا الان، یا رکورد پیوسته‌ات.", "id": "Set kamu sejauh ini, atau rentetanmu.", "lt": "Tavo atlikti priėjimai arba serija.", "vi": "Số hiệp đến giờ, hoặc chuỗi tuần của bạn."})
Object.assign(OWN.notif_running, {"cs": "Trénink běží. Klepni a jsi zpátky.", "fa": "تمرین در جریان است. برای برگشتن بزن.", "id": "Latihan berjalan. Ketuk untuk kembali.", "lt": "Treniruotė vyksta. Bakstelėk, kad grįžtum.", "vi": "Đang tập. Chạm để quay lại."})
Object.assign(OWN.hr_why, {"cs": "Povol tep a uvidíš ho u každé série.", "fa": "اجازهٔ ضربان قلب بده تا در هر ست نبضت را ببینی.", "id": "Izinkan detak jantung untuk melihat denyutmu di tiap set.", "lt": "Leisk pulsą ir matysi jį kiekviename priėjime.", "vi": "Cho phép nhịp tim để xem mạch ở mỗi hiệp."})
Object.assign(OWN.phone_away, {"cs": "Telefon je mimo dosah. Tvoje série počkají tady.", "fa": "گوشی در دسترس نیست. ست‌هایت اینجا منتظرند.", "id": "Ponsel di luar jangkauan. Set kamu menunggu di sini.", "lt": "Telefonas nepasiekiamas. Tavo priėjimai laukia čia.", "vi": "Điện thoại ngoài tầm. Các hiệp của bạn chờ ở đây."})
OWN.phone_out_of_reach = {"en": "Phone out of reach", "de": "Handy außer Reichweite", "fr": "Téléphone hors de portée", "es": "Móvil fuera de alcance", "it": "Telefono fuori portata", "pt": "Telemóvel fora de alcance", "pt-BR": "Celular fora de alcance", "pl": "Telefon poza zasięgiem", "hu": "A telefon hatótávon kívül", "tr": "Telefon menzil dışında", "ru": "Телефон вне зоны", "uk": "Телефон поза зоною", "ar": "الهاتف خارج النطاق", "hi": "फ़ोन पहुँच से बाहर", "bn": "ফোন নাগালের বাইরে", "th": "โทรศัพท์อยู่นอกระยะ", "ko": "휴대폰이 멀리 있어요", "sv": "Telefonen utom räckhåll", "zh": "手机不在范围内", "zh-TW": "手機不在範圍內", "cs": "Telefon mimo dosah", "fa": "گوشی در دسترس نیست", "id": "Ponsel di luar jangkauan", "lt": "Telefonas nepasiekiamas", "vi": "Điện thoại ngoài tầm"}
OWN.media_title = {"en": "Music", "de": "Musik", "fr": "Musique", "es": "Música", "it": "Musica", "pt": "Música", "pt-BR": "Música", "pl": "Muzyka", "hu": "Zene", "tr": "Müzik", "ru": "Музыка", "uk": "Музика", "ar": "الموسيقى", "hi": "संगीत", "bn": "গান", "th": "เพลง", "ko": "음악", "sv": "Musik", "zh": "音乐", "zh-TW": "音樂", "cs": "Hudba", "fa": "موسیقی", "id": "Musik", "lt": "Muzika", "vi": "Nhạc"}
OWN.media_prev = {"en": "Previous track", "de": "Vorheriger Titel", "fr": "Morceau précédent", "es": "Canción anterior", "it": "Brano precedente", "pt": "Faixa anterior", "pt-BR": "Faixa anterior", "pl": "Poprzedni utwór", "hu": "Előző szám", "tr": "Önceki parça", "ru": "Предыдущий трек", "uk": "Попередній трек", "ar": "المقطع السابق", "hi": "पिछला ट्रैक", "bn": "আগের ট্র্যাক", "th": "เพลงก่อนหน้า", "ko": "이전 곡", "sv": "Föregående låt", "zh": "上一首", "zh-TW": "上一首", "cs": "Předchozí skladba", "fa": "آهنگ قبلی", "id": "Lagu sebelumnya", "lt": "Ankstesnis takelis", "vi": "Bài trước"}
OWN.media_play = {"en": "Play or pause", "de": "Abspielen oder Pause", "fr": "Lecture ou pause", "es": "Reproducir o pausar", "it": "Riproduci o pausa", "pt": "Reproduzir ou pausar", "pt-BR": "Tocar ou pausar", "pl": "Odtwórz lub wstrzymaj", "hu": "Lejátszás vagy szünet", "tr": "Oynat veya duraklat", "ru": "Воспроизвести или пауза", "uk": "Відтворити або пауза", "ar": "تشغيل أو إيقاف مؤقت", "hi": "चलाएँ या रोकें", "bn": "চালান বা থামান", "th": "เล่นหรือหยุดชั่วคราว", "ko": "재생 또는 일시정지", "sv": "Spela eller pausa", "zh": "播放或暂停", "zh-TW": "播放或暫停", "cs": "Přehrát nebo pozastavit", "fa": "پخش یا توقف", "id": "Putar atau jeda", "lt": "Groti arba pristabdyti", "vi": "Phát hoặc tạm dừng"}
OWN.media_next = {"en": "Next track", "de": "Nächster Titel", "fr": "Morceau suivant", "es": "Canción siguiente", "it": "Brano successivo", "pt": "Faixa seguinte", "pt-BR": "Próxima faixa", "pl": "Następny utwór", "hu": "Következő szám", "tr": "Sonraki parça", "ru": "Следующий трек", "uk": "Наступний трек", "ar": "المقطع التالي", "hi": "अगला ट्रैक", "bn": "পরের ট্র্যাক", "th": "เพลงถัดไป", "ko": "다음 곡", "sv": "Nästa låt", "zh": "下一首", "zh-TW": "下一首", "cs": "Další skladba", "fa": "آهنگ بعدی", "id": "Lagu berikutnya", "lt": "Kitas takelis", "vi": "Bài tiếp"}
OWN.media_quieter = {"en": "Quieter", "de": "Leiser", "fr": "Moins fort", "es": "Más bajo", "it": "Più piano", "pt": "Mais baixo", "pt-BR": "Mais baixo", "pl": "Ciszej", "hu": "Halkabban", "tr": "Daha kısık", "ru": "Тише", "uk": "Тихіше", "ar": "أخفض", "hi": "धीमा", "bn": "আস্তে", "th": "เบาลง", "ko": "작게", "sv": "Tystare", "zh": "调低音量", "zh-TW": "調低音量", "cs": "Tišeji", "fa": "آهسته‌تر", "id": "Lebih pelan", "lt": "Tyliau", "vi": "Nhỏ hơn"}
OWN.media_louder = {"en": "Louder", "de": "Lauter", "fr": "Plus fort", "es": "Más alto", "it": "Più forte", "pt": "Mais alto", "pt-BR": "Mais alto", "pl": "Głośniej", "hu": "Hangosabban", "tr": "Daha yüksek", "ru": "Громче", "uk": "Гучніше", "ar": "أعلى", "hi": "तेज़", "bn": "জোরে", "th": "ดังขึ้น", "ko": "크게", "sv": "Högre", "zh": "调高音量", "zh-TW": "調高音量", "cs": "Hlasitěji", "fa": "بلندتر", "id": "Lebih keras", "lt": "Garsiau", "vi": "To hơn"}

// 1.4.5 Now playing (MediaControls.kt): where the music is, and one tap to the system's Media Controls.
OWN.media_now_playing = {"en": "Now playing", "de": "Läuft gerade", "fr": "En cours de lecture", "es": "Sonando ahora", "it": "In riproduzione", "pt": "A tocar", "pt-BR": "Tocando agora", "pl": "Teraz gra", "hu": "Most szól", "tr": "Şimdi çalıyor", "ru": "Сейчас играет", "uk": "Зараз грає", "ar": "قيد التشغيل", "hi": "अभी चल रहा है", "bn": "এখন বাজছে", "th": "กำลังเล่น", "ko": "지금 재생 중", "sv": "Spelas nu", "zh": "正在播放", "zh-TW": "正在播放", "cs": "Právě hraje", "fa": "در حال پخش", "id": "Sedang diputar", "lt": "Dabar groja", "vi": "Đang phát"}
OWN.media_on_watch = {"en": "Playing on your watch", "de": "Läuft auf deiner Uhr", "fr": "Ça joue sur ta montre", "es": "Suena en tu reloj", "it": "Suona sull’orologio", "pt": "A tocar no relógio", "pt-BR": "Tocando no relógio", "pl": "Gra na zegarku", "hu": "Az órádon szól", "tr": "Saatinde çalıyor", "ru": "Играет на часах", "uk": "Грає на годиннику", "ar": "يعمل على ساعتك", "hi": "आपकी घड़ी पर चल रहा है", "bn": "আপনার ঘড়িতে বাজছে", "th": "กำลังเล่นบนนาฬิกา", "ko": "워치에서 재생 중", "sv": "Spelas på klockan", "zh": "正在手表上播放", "zh-TW": "正在手錶上播放", "cs": "Hraje na hodinkách", "fa": "روی ساعتت پخش می‌شود", "id": "Diputar di jam tanganmu", "lt": "Groja laikrodyje", "vi": "Đang phát trên đồng hồ"}
OWN.media_phone_hint = {"en": "Music on your phone? Media Controls has it.", "de": "Musik auf dem Handy? Die hat Mediensteuerung.", "fr": "Musique sur le téléphone ? Commandes multimédias s’en occupe.", "es": "¿Música en el móvil? Está en Controles multimedia.", "it": "Musica sul telefono? Ci pensa Controlli multimediali.", "pt": "Música no telemóvel? Está nos Controlos de multimédia.", "pt-BR": "Música no celular? Está nos Controles de mídia.", "pl": "Muzyka w telefonie? Ma ją Sterowanie multimediami.", "hu": "Zene a telefonon? A Médiavezérlőben van.", "tr": "Müzik telefonda mı? Medya Kontrolleri’nde.", "ru": "Музыка на телефоне? Она в «Управлении медиа».", "uk": "Музика на телефоні? Вона в «Керуванні медіа».", "ar": "الموسيقى على هاتفك؟ ستجدها في عناصر التحكم بالوسائط.", "hi": "फ़ोन पर संगीत? वह मीडिया कंट्रोल में है।", "bn": "ফোনে গান? মিডিয়া কন্ট্রোলে আছে।", "th": "เพลงอยู่บนโทรศัพท์? ไปที่ตัวควบคุมสื่อ", "ko": "휴대폰 음악이라면 미디어 컨트롤에서요.", "sv": "Musik på telefonen? Den finns i Mediekontroller.", "zh": "音乐在手机上？去“媒体控制”。", "zh-TW": "音樂在手機上？去「媒體控制」。", "cs": "Hudba v telefonu? Najdeš ji v Ovládání médií.", "fa": "موسیقی روی گوشی است؟ در کنترل رسانه پیدایش می‌کنی.", "id": "Musik di ponsel? Ada di Kontrol Media.", "lt": "Muzika telefone? Ji yra medijos valdikliuose.", "vi": "Nhạc trên điện thoại? Có trong Điều khiển phương tiện."}
OWN.media_open = {"en": "Open Media Controls", "de": "Mediensteuerung öffnen", "fr": "Ouvrir les commandes multimédias", "es": "Abrir Controles multimedia", "it": "Apri Controlli multimediali", "pt": "Abrir Controlos de multimédia", "pt-BR": "Abrir Controles de mídia", "pl": "Otwórz Sterowanie multimediami", "hu": "Médiavezérlő megnyitása", "tr": "Medya Kontrolleri’ni aç", "ru": "Открыть «Управление медиа»", "uk": "Відкрити «Керування медіа»", "ar": "فتح عناصر التحكم بالوسائط", "hi": "मीडिया कंट्रोल खोलें", "bn": "মিডিয়া কন্ট্রোল খুলুন", "th": "เปิดตัวควบคุมสื่อ", "ko": "미디어 컨트롤 열기", "sv": "Öppna Mediekontroller", "zh": "打开媒体控制", "zh-TW": "開啟媒體控制", "cs": "Otevřít Ovládání médií", "fa": "باز کردن کنترل رسانه", "id": "Buka Kontrol Media", "lt": "Atidaryti medijos valdiklius", "vi": "Mở Điều khiển phương tiện"}

// Zones page (ZonesPage.kt): same English as the Apple Watch keys, so they fold into the shared table when #1108 lands.
OWN.zones = {"en": "Zones", "de": "Zonen", "fr": "Zones", "es": "Zonas", "it": "Zone", "pt": "Zonas", "pt-BR": "Zonas", "pl": "Strefy", "hu": "Zónák", "tr": "Bölgeler", "ru": "Зоны", "uk": "Зони", "ar": "النطاقات", "hi": "ज़ोन", "bn": "জোন", "th": "โซน", "ko": "구간", "sv": "Zoner", "zh": "区间", "zh-TW": "區間", "cs": "Zóny", "fa": "ناحیه‌ها", "id": "Zona", "lt": "Zonos", "vi": "Vùng", "da": "Zoner"}
OWN.no_age_set = {"en": "No age set", "de": "Kein Alter angegeben", "fr": "Âge non défini", "es": "Sin edad", "it": "Età non impostata", "pt": "Sem idade definida", "pt-BR": "Sem idade definida", "pl": "Brak wieku", "hu": "Nincs megadott életkor", "tr": "Yaş ayarlanmadı", "ru": "Возраст не указан", "uk": "Вік не вказано", "ar": "لم يُحدَّد العمر", "hi": "उम्र सेट नहीं है", "bn": "বয়স দেওয়া নেই", "th": "ยังไม่ได้ตั้งอายุ", "ko": "나이가 설정되지 않음", "sv": "Ingen ålder angiven", "zh": "未设置年龄", "zh-TW": "未設定年齡", "cs": "Věk není nastaven", "fa": "سنی تنظیم نشده", "id": "Usia belum diatur", "lt": "Amžius nenustatytas", "vi": "Chưa đặt tuổi", "da": "Ingen alder angivet"}
OWN.add_birth_year = {"en": "Add your year of birth in the phone app", "de": "Geburtsjahr in der Handy-App eintragen", "fr": "Ajoute ton année de naissance dans l’app du téléphone", "es": "Añade tu año de nacimiento en la app del móvil", "it": "Aggiungi l’anno di nascita nell’app sul telefono", "pt": "Adiciona o ano de nascimento na app do telemóvel", "pt-BR": "Adicione o ano de nascimento no app do celular", "pl": "Dodaj rok urodzenia w aplikacji na telefonie", "hu": "Add meg a születési éved a telefonos appban", "tr": "Doğum yılını telefon uygulamasında ekle", "ru": "Укажи год рождения в приложении на телефоне", "uk": "Вкажи рік народження в застосунку на телефоні", "ar": "أضف سنة ميلادك في تطبيق الهاتف", "hi": "फ़ोन ऐप में अपना जन्म वर्ष जोड़ें", "bn": "ফোন অ্যাপে জন্মসাল যোগ করুন", "th": "เพิ่มปีเกิดในแอปบนโทรศัพท์", "ko": "휴대폰 앱에서 출생 연도를 추가하세요", "sv": "Lägg till ditt födelseår i telefonappen", "zh": "在手机应用中添加出生年份", "zh-TW": "在手機 App 中新增出生年份", "cs": "Přidej rok narození v aplikaci v telefonu", "fa": "سال تولدت را در برنامهٔ گوشی اضافه کن", "id": "Tambahkan tahun lahirmu di aplikasi ponsel", "lt": "Įrašyk gimimo metus telefono programėlėje", "vi": "Thêm năm sinh trong ứng dụng trên điện thoại", "da": "Tilføj dit fødselsår i telefonappen"}
OWN.zone_n = {"en": "Zone %1$d", "de": "Zone %1$d", "fr": "Zone %1$d", "es": "Zona %1$d", "it": "Zona %1$d", "pt": "Zona %1$d", "pt-BR": "Zona %1$d", "pl": "Strefa %1$d", "hu": "%1$d. zóna", "tr": "Bölge %1$d", "ru": "Зона %1$d", "uk": "Зона %1$d", "ar": "النطاق %1$d", "hi": "ज़ोन %1$d", "bn": "জোন %1$d", "th": "โซน %1$d", "ko": "%1$d구간", "sv": "Zon %1$d", "zh": "区间 %1$d", "zh-TW": "區間 %1$d", "cs": "Zóna %1$d", "fa": "ناحیه %1$d", "id": "Zona %1$d", "lt": "%1$d zona", "vi": "Vùng %1$d", "da": "Zone %1$d"}
OWN.band_to = {"en": "%1$d to %2$d", "de": "%1$d bis %2$d", "fr": "%1$d à %2$d", "es": "%1$d a %2$d", "it": "da %1$d a %2$d", "pt": "%1$d a %2$d", "pt-BR": "%1$d a %2$d", "pl": "od %1$d do %2$d", "hu": "%1$d és %2$d között", "tr": "%1$d ile %2$d arası", "ru": "от %1$d до %2$d", "uk": "від %1$d до %2$d", "ar": "من %1$d إلى %2$d", "hi": "%1$d से %2$d", "bn": "%1$d থেকে %2$d", "th": "%1$d ถึง %2$d", "ko": "%1$d에서 %2$d", "sv": "%1$d till %2$d", "zh": "%1$d 到 %2$d", "zh-TW": "%1$d 到 %2$d", "cs": "od %1$d do %2$d", "fa": "%1$d تا %2$d", "id": "%1$d sampai %2$d", "lt": "nuo %1$d iki %2$d", "vi": "%1$d đến %2$d", "da": "%1$d til %2$d"}
OWN.band_under = {"en": "under %1$d", "de": "unter %1$d", "fr": "moins de %1$d", "es": "menos de %1$d", "it": "sotto %1$d", "pt": "abaixo de %1$d", "pt-BR": "abaixo de %1$d", "pl": "poniżej %1$d", "hu": "%1$d alatt", "tr": "%1$d altı", "ru": "ниже %1$d", "uk": "нижче %1$d", "ar": "أقل من %1$d", "hi": "%1$d से कम", "bn": "%1$d এর কম", "th": "ต่ำกว่า %1$d", "ko": "%1$d 미만", "sv": "under %1$d", "zh": "低于 %1$d", "zh-TW": "低於 %1$d", "cs": "pod %1$d", "fa": "کمتر از %1$d", "id": "di bawah %1$d", "lt": "žemiau %1$d", "vi": "dưới %1$d", "da": "under %1$d"}
OWN.band_over = {"en": "%1$d and up", "de": "ab %1$d", "fr": "%1$d et plus", "es": "%1$d o más", "it": "da %1$d in su", "pt": "%1$d ou mais", "pt-BR": "%1$d ou mais", "pl": "%1$d i więcej", "hu": "%1$d vagy több", "tr": "%1$d ve üzeri", "ru": "%1$d и выше", "uk": "%1$d і вище", "ar": "%1$d فأكثر", "hi": "%1$d और अधिक", "bn": "%1$d ও বেশি", "th": "%1$d ขึ้นไป", "ko": "%1$d 이상", "sv": "%1$d och uppåt", "zh": "%1$d 及以上", "zh-TW": "%1$d 及以上", "cs": "%1$d a více", "fa": "%1$d و بیشتر", "id": "%1$d ke atas", "lt": "%1$d ir daugiau", "vi": "từ %1$d trở lên", "da": "%1$d og op"}
OWN.zone_current = {"en": "current", "de": "aktuell", "fr": "actuelle", "es": "actual", "it": "attuale", "pt": "atual", "pt-BR": "atual", "pl": "bieżąca", "hu": "jelenlegi", "tr": "geçerli", "ru": "текущая", "uk": "поточна", "ar": "الحالي", "hi": "मौजूदा", "bn": "বর্তমান", "th": "ปัจจุบัน", "ko": "현재", "sv": "aktuell", "zh": "当前", "zh-TW": "目前", "cs": "aktuální", "fa": "فعلی", "id": "saat ini", "lt": "dabartinė", "vi": "hiện tại", "da": "aktuel"}

// Danish (#1039): the lines only Wear OS says.
for (const [k, v] of Object.entries({"open_phone_once": "Åbn openGym på telefonen én gang, så dukker dine rutiner op her.", "start_on_phone": "Start en på telefonen, så dukker den op her.", "ended_on_phone": "Afsluttet på telefonen", "log_on_phone": "Log den her på telefonen.", "crown_hint": "Drej på kronen for at ændre det.", "quick_start": "Hurtig start", "rest_day": "Intet planlagt. Det er dit valg.", "tile_desc": "Din streak og dagens plan.", "complication_desc": "Dine sæt indtil nu, eller din streak.", "notif_running": "Træning i gang. Tryk for at hoppe ind igen.", "hr_why": "Tillad puls for at se den ved hvert sæt.", "phone_away": "Telefonen er uden for rækkevidde. Dine sæt venter her.", "phone_out_of_reach": "Telefonen uden for rækkevidde", "media_title": "Musik", "media_prev": "Forrige nummer", "media_play": "Afspil eller pause", "media_next": "Næste nummer", "media_quieter": "Lavere", "media_louder": "Højere", "media_now_playing": "Afspilles nu", "media_on_watch": "Afspilles på dit ur", "media_phone_hint": "Musik på telefonen? Den findes i Mediekontroller.", "media_open": "Åbn Mediekontroller"})) OWN[k].da = v

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
const en = { app_name: 'openGym Beta' }
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
    const v = watch[key] && androidFormat(watch[key])
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
