#!/usr/bin/env node
// Writes the Apple Watch app's strings (ios/App/Watch/<lang>.lproj/Localizable.strings) in every
// language the app speaks. Words the app already has come from its own locale packs
// (frontend/src/locales), so the watch says "Done" exactly as the phone does; the few phrases only
// the watch uses are below. Run it after changing either, and commit what it writes:
//
//   node frontend/ios/ci/watch-strings.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const out = join(root, 'ios', 'App', 'Watch')
const widgets = join(root, 'ios', 'App', 'WatchWidgets')

// app pack → watch .lproj
const LANGS = {
  de: 'de', fr: 'fr', es: 'es', it: 'it', pt: 'pt-PT', 'pt-BR': 'pt-BR', pl: 'pl', hu: 'hu', tr: 'tr',
  ru: 'ru', uk: 'uk', ar: 'ar', hi: 'hi', bn: 'bn', th: 'th', ko: 'ko', zh: 'zh-Hans', 'zh-TW': 'zh-Hant',
  cs: 'cs', fa: 'fa', id: 'id', lt: 'lt', sv: 'sv', vi: 'vi',
  da: 'da',
}

const LOAN_WARMUP = new Set(['de', 'fr', 'es', 'it', 'pt-PT', 'pt-BR', 'pl', 'hu', 'sv', 'da', 'id', 'lt'])
// The watch's key (what the Swift source says) → the app's key, for words the app already has.
const FROM_APP = {
  'Today': 'Today',
  'Start workout': 'Start workout',
  'Done': 'Done',
  'Warm-up': 'Warm-up',
  'Remove': 'Remove',
  'Undo': 'Undo',
  'Reps': 'Reps',
  'Rest': 'Rest',
  'Skip': 'Skip',
  'Finish workout': 'Finish workout',
  'Discard workout': 'Discard workout',
  'Continue workout': 'Continue workout',
  'Cancel': 'Cancel',
  'Rest’s over. Next set!': 'Rest’s over. Next set!',
  'Left': 'Left',
  'Right': 'Right',
  'Superset': 'Superset',
  'Weight': 'Weight',
  'Sets': 'Sets',
  'Volume': 'Volume',
  'Time': 'Time',
  'Skip set': 'Skip set',
  'Personal records': 'PRs',
  'Quick check-in': 'Quick check-in',
  'Save & start workout': 'Save & start workout',
  'Start without weighing in': 'Start without weighing in',
  'Body weight': 'Body weight',
  'Effort': 'Effort',
  'None': 'None',
  'Exercises': 'Exercises',
  'Save': 'Save',
  'Previous set': 'Previous set',
  'Next set': 'Next set',
  'Edit': 'Edit',
  'Overview': 'Overview',
  'Discard workout?': 'Discard workout?',
  'Up next': 'Up next',
  'How hard was that set?': 'How hard was that set?',
  'Waiting to sync': 'Waiting to sync',
  'All synced': 'All synced',
  'Go!': 'Go!',
  // Forgotten workouts (1.4.5), the phone's words.
  'Still training?': 'Still training?',
  'Looks like you left the gym': 'Looks like you left the gym',
  'Keep going': 'Keep going',
  'Finish now': 'Finish now',
  'Taken to failure': 'Taken to failure',
  'Drop set': 'Drop set',
  'More': 'More',
}
// Built from an app word: "Last time: %@".
const COMPOSED = {
  // The set menu: the phone's "Set {0}" and its short "Add" ("Add set" is too wide under 75 pt in German).
  'Set %lld': ['Set {0}', w => w.replace('{0}', '%lld')],
  'Add set': ['Add', w => w],
  // The word under the Warm-up disc: 56 pt wide at 12 pt, so the loan word where the local one is longer (as the mockup's German).
  'Warm-up disc': ['Warm-up', (w, l) => LOAN_WARMUP.has(l) ? 'Warm-up' : w],
  'Last time: %@': ['Last time', w => `${w}: %@`],
  // The phone's sentence with the time it ends by itself in the place of {0}.
  'Nothing logged for a while. If you’re done, it ends by itself at %@, saved at your last set.':
    ['Nothing logged for a while. If you’re done, it ends by itself at {0}, saved at your last set.', w => w.replace('{0}', '%@')],
  'Finish the workout now? Otherwise it ends by itself at %@.':
    ['Finish the workout now? Otherwise it ends by itself at {0}.', w => w.replace('{0}', '%@')],
}

// Only the watch says these. %@ is a name, %lld a number, as the Swift source interpolates them.
const OWN = {
  'No workout running': {
    de: 'Kein Training läuft', fr: 'Aucune séance en cours', es: 'Ningún entreno en curso', it: 'Nessun allenamento in corso',
    'pt-PT': 'Nenhum treino a decorrer', 'pt-BR': 'Nenhum treino em andamento', pl: 'Żaden trening nie trwa', hu: 'Nincs folyamatban edzés',
    tr: 'Devam eden antrenman yok', ru: 'Тренировка не идёт', uk: 'Тренування не триває', ar: 'لا يوجد تمرين جارٍ',
    hi: 'कोई वर्कआउट नहीं चल रहा', bn: 'কোনো ওয়ার্কআউট চলছে না', th: 'ไม่มีการฝึกที่กำลังทำอยู่', ko: '진행 중인 운동이 없어요',
    'zh-Hans': '没有进行中的训练', 'zh-Hant': '沒有進行中的訓練',
    cs: 'Žádný trénink neběží', fa: 'هیچ تمرینی در جریان نیست', id: 'Tidak ada latihan berjalan', lt: 'Treniruotė nevyksta', sv: 'Inget pass pågår', vi: 'Không có buổi tập nào đang chạy',
  },
  // The start screen before anything came from the phone (it sends only while openGym runs there).
  'Not synced yet': {
    de: 'Noch nicht synchronisiert', fr: 'Pas encore synchronisé', es: 'Aún sin sincronizar', it: 'Non ancora sincronizzato',
    'pt-PT': 'Ainda não sincronizado', 'pt-BR': 'Ainda não sincronizado', pl: 'Jeszcze nie zsynchronizowano', hu: 'Még nincs szinkronizálva',
    tr: 'Henüz eşitlenmedi', ru: 'Ещё не синхронизировано', uk: 'Ще не синхронізовано', ar: 'لم تتم المزامنة بعد',
    hi: 'अभी सिंक नहीं हुआ', bn: 'এখনো সিঙ্ক হয়নি', th: 'ยังไม่ได้ซิงค์', ko: '아직 동기화되지 않았어요',
    'zh-Hans': '尚未同步', 'zh-Hant': '尚未同步',
    cs: 'Zatím nesynchronizováno', fa: 'هنوز همگام نشده', id: 'Belum disinkronkan', lt: 'Dar nesinchronizuota', sv: 'Inte synkat än', vi: 'Chưa đồng bộ',
  },
  'Open openGym on your iPhone once and your routines show up here.': {
    de: 'Öffne openGym einmal auf dem iPhone, dann tauchen deine Routinen hier auf.',
    fr: 'Ouvre openGym une fois sur ton iPhone et tes routines apparaissent ici.',
    es: 'Abre openGym una vez en tu iPhone y tus rutinas aparecerán aquí.',
    it: 'Apri openGym una volta sull’iPhone e le tue routine compariranno qui.',
    'pt-PT': 'Abre o openGym uma vez no iPhone e as tuas rotinas aparecem aqui.',
    'pt-BR': 'Abra o openGym uma vez no iPhone e suas rotinas aparecem aqui.',
    pl: 'Otwórz raz openGym na iPhonie, a twoje plany pojawią się tutaj.',
    hu: 'Nyisd meg egyszer az openGymet az iPhone-on, és itt lesznek a rutinjaid.',
    tr: 'openGym’i iPhone’unda bir kez aç, rutinlerin burada görünür.',
    ru: 'Откройте openGym на iPhone один раз, и ваши программы появятся здесь.',
    uk: 'Відкрий openGym на iPhone один раз, і твої програми з’являться тут.',
    ar: 'افتح openGym على iPhone مرة واحدة وستظهر تمارينك الروتينية هنا.',
    hi: 'iPhone पर openGym एक बार खोलें, आपके रूटीन यहाँ दिखेंगे।',
    bn: 'iPhone-এ openGym একবার খুলুন, আপনার রুটিন এখানে দেখা যাবে।',
    th: 'เปิด openGym บน iPhone สักครั้ง แล้วรูทีนของคุณจะแสดงที่นี่',
    ko: 'iPhone에서 openGym을 한 번 열면 루틴이 여기에 나타나요.',
    'zh-Hans': '在 iPhone 上打开一次 openGym，你的训练计划就会出现在这里。',
    'zh-Hant': '在 iPhone 上打開一次 openGym，你的訓練計畫就會出現在這裡。',
    cs: 'Otevři openGym jednou na iPhonu a tvoje rutiny se objeví tady.', fa: 'یک بار openGym را در iPhone باز کنید تا روال‌هایتان اینجا نمایش داده شوند.', id: 'Buka openGym sekali di iPhone kamu, rutinitasmu akan muncul di sini.', lt: 'Vieną kartą atidarykite „openGym“ iPhone ir jūsų rutinos atsiras čia.', sv: 'Öppna openGym på din iPhone en gång så dyker dina rutiner upp här.', vi: 'Mở openGym trên iPhone một lần, các lịch tập sẽ hiện ở đây.',
  },
  'Start one on your iPhone and it shows up here.': {
    de: 'Starte eins auf dem iPhone, dann taucht es hier auf.', fr: 'Lance-en une sur ton iPhone et elle apparaît ici.',
    es: 'Empieza uno en tu iPhone y aparecerá aquí.', it: 'Avviane uno sull’iPhone e comparirà qui.',
    'pt-PT': 'Começa um no iPhone e ele aparece aqui.', 'pt-BR': 'Comece um no iPhone e ele aparece aqui.',
    pl: 'Zacznij trening na iPhonie, a pojawi się tutaj.', hu: 'Indíts egyet az iPhone-on, és itt megjelenik.',
    tr: 'iPhone’unda bir tane başlat, burada görünür.', ru: 'Начните её на iPhone, и она появится здесь.',
    uk: 'Почни його на iPhone, і воно з’явиться тут.', ar: 'ابدأ تمرينًا على iPhone وسيظهر هنا.',
    hi: 'iPhone पर एक शुरू करें, यह यहाँ दिखेगा।', bn: 'iPhone-এ একটি শুরু করুন, এখানে দেখা যাবে।',
    th: 'เริ่มบน iPhone แล้วจะแสดงที่นี่', ko: 'iPhone에서 시작하면 여기에 나타나요.',
    'zh-Hans': '在 iPhone 上开始，它就会出现在这里。', 'zh-Hant': '在 iPhone 上開始，它就會出現在這裡。',
    cs: 'Spusť ho na iPhonu a objeví se tady.', fa: 'یکی را در iPhone شروع کنید تا اینجا نمایش داده شود.', id: 'Mulai di iPhone kamu dan akan muncul di sini.', lt: 'Pradėkite ją iPhone ir ji atsiras čia.', sv: 'Starta ett på din iPhone så dyker det upp här.', vi: 'Bắt đầu trên iPhone và nó sẽ hiện ở đây.',
  },
  'All sets done': {
    de: 'Alle Sätze erledigt', fr: 'Toutes les séries faites', es: 'Todas las series hechas', it: 'Tutte le serie fatte',
    'pt-PT': 'Todas as séries feitas', 'pt-BR': 'Todas as séries feitas', pl: 'Wszystkie serie zrobione', hu: 'Minden sorozat kész',
    tr: 'Tüm setler tamam', ru: 'Все подходы сделаны', uk: 'Усі підходи зроблено', ar: 'اكتملت كل المجموعات',
    hi: 'सारे सेट पूरे', bn: 'সব সেট শেষ', th: 'ครบทุกเซ็ตแล้ว', ko: '모든 세트 완료', 'zh-Hans': '所有组已完成', 'zh-Hant': '所有組已完成',
    cs: 'Všechny série hotové', fa: 'همه ست‌ها انجام شد', id: 'Semua set selesai', lt: 'Visos serijos atliktos', sv: 'Alla set klara', vi: 'Đã xong tất cả hiệp',
  },
  'measuring': {
    de: 'misst …', fr: 'mesure …', es: 'midiendo …', it: 'misuro …', 'pt-PT': 'a medir …', 'pt-BR': 'medindo …', pl: 'mierzę …',
    hu: 'mérés …', tr: 'ölçülüyor …', ru: 'измеряю …', uk: 'вимірюю …', ar: 'جارٍ القياس …', hi: 'माप रहा है …', bn: 'মাপা হচ্ছে …',
    th: 'กำลังวัด …', ko: '측정 중 …', 'zh-Hans': '测量中 …', 'zh-Hant': '測量中 …',
    cs: 'měřím …', fa: 'در حال اندازه‌گیری …', id: 'mengukur …', lt: 'matuojama …', sv: 'mäter …', vi: 'đang đo …',
  },
  '%@, set %lld': {
    de: '%@, Satz %lld', fr: '%@, série %lld', es: '%@, serie %lld', it: '%@, serie %lld', 'pt-PT': '%@, série %lld', 'pt-BR': '%@, série %lld',
    pl: '%@, seria %lld', hu: '%@, %lld. sorozat', tr: '%@, set %lld', ru: '%@, подход %lld', uk: '%@, підхід %lld', ar: '%@، المجموعة %lld',
    hi: '%@, सेट %lld', bn: '%@, সেট %lld', th: '%@ เซ็ต %lld', ko: '%@, %lld세트', 'zh-Hans': '%@，第 %lld 组', 'zh-Hant': '%@，第 %lld 組',
    cs: '%@, série %lld', fa: '%@، ست %lld', id: '%@, set %lld', lt: '%@, serija %lld', sv: '%@, set %lld', vi: '%@, hiệp %lld',
  },
  'Calories': {
    de: 'Kalorien', fr: 'Calories', es: 'Calorías', it: 'Calorie', 'pt-PT': 'Calorias', 'pt-BR': 'Calorias', pl: 'Kalorie', hu: 'Kalória', tr: 'Kalori', ru: 'Калории', uk: 'Калорії', ar: 'السعرات', hi: 'कैलोरी', bn: 'ক্যালোরি', th: 'แคลอรี', ko: '칼로리', 'zh-Hans': '卡路里', 'zh-Hant': '卡路里',
    cs: 'Kalorie', fa: 'کالری', id: 'Kalori', lt: 'Kalorijos', sv: 'Kalorier', vi: 'Calo',
  },
  'Heart rate': {
    de: 'Puls', fr: 'Pouls', es: 'Pulso', it: 'Battito', 'pt-PT': 'Frequência cardíaca', 'pt-BR': 'Frequência cardíaca', pl: 'Tętno', hu: 'Pulzus', tr: 'Nabız', ru: 'Пульс', uk: 'Пульс', ar: 'النبض', hi: 'धड़कन', bn: 'হার্ট রেট', th: 'ชีพจร', ko: '심박수', 'zh-Hans': '心率', 'zh-Hant': '心率',
    cs: 'Tep', fa: 'ضربان قلب', id: 'Detak jantung', lt: 'Širdies ritmas', sv: 'Puls', vi: 'Nhịp tim',
  },
  'Hold': {
    de: 'Halten', fr: 'Tenue', es: 'Aguanta', it: 'Tenuta', 'pt-PT': 'Aguenta', 'pt-BR': 'Segure', pl: 'Utrzymaj', hu: 'Tartás', tr: 'Tut', ru: 'Удержание', uk: 'Утримання', ar: 'ثبات', hi: 'होल्ड', bn: 'ধরে রাখুন', th: 'ค้างไว้', ko: '버티기', 'zh-Hans': '保持', 'zh-Hant': '保持',
    cs: 'Výdrž', fa: 'نگه‌داشتن', id: 'Tahan', lt: 'Išlaikymas', sv: 'Håll', vi: 'Giữ',
  },
  'Stop': {
    de: 'Stopp', fr: 'Stop', es: 'Parar', it: 'Stop', 'pt-PT': 'Parar', 'pt-BR': 'Parar', pl: 'Stop', hu: 'Stop', tr: 'Durdur', ru: 'Стоп', uk: 'Стоп', ar: 'إيقاف', hi: 'रोकें', bn: 'থামুন', th: 'หยุด', ko: '정지', 'zh-Hans': '停止', 'zh-Hant': '停止',
    cs: 'Stop', fa: 'توقف', id: 'Berhenti', lt: 'Stop', sv: 'Stopp', vi: 'Dừng',
  },
  'Start hold': {
    de: 'Halten starten', fr: 'Lancer la tenue', es: 'Empezar', it: 'Inizia la tenuta', 'pt-PT': 'Começar', 'pt-BR': 'Começar', pl: 'Start', hu: 'Indítás', tr: 'Başlat', ru: 'Начать', uk: 'Почати', ar: 'ابدأ', hi: 'शुरू करें', bn: 'শুরু করুন', th: 'เริ่ม', ko: '시작', 'zh-Hans': '开始', 'zh-Hant': '開始',
    cs: 'Začít výdrž', fa: 'شروع نگه‌داشتن', id: 'Mulai tahan', lt: 'Pradėti išlaikymą', sv: 'Starta hållet', vi: 'Bắt đầu giữ',
  },
  'Workout saved': {
    de: 'Training gespeichert', fr: 'Séance enregistrée', es: 'Entreno guardado', it: 'Allenamento salvato', 'pt-PT': 'Treino guardado', 'pt-BR': 'Treino salvo', pl: 'Trening zapisany', hu: 'Edzés mentve', tr: 'Antrenman kaydedildi', ru: 'Тренировка сохранена', uk: 'Тренування збережено', ar: 'تم حفظ التمرين', hi: 'वर्कआउट सहेजा गया', bn: 'ওয়ার্কআউট সেভ হয়েছে', th: 'บันทึกการฝึกแล้ว', ko: '운동 저장됨', 'zh-Hans': '训练已保存', 'zh-Hant': '訓練已儲存',
    cs: 'Trénink uložen', fa: 'تمرین ذخیره شد', id: 'Latihan disimpan', lt: 'Treniruotė išsaugota', sv: 'Passet sparat', vi: 'Đã lưu buổi tập',
  },
  'Ended on your iPhone': {
    de: 'Am iPhone beendet', fr: 'Terminée sur ton iPhone', es: 'Terminado en tu iPhone', it: 'Finito sull’iPhone', 'pt-PT': 'Terminado no iPhone', 'pt-BR': 'Encerrado no iPhone', pl: 'Zakończono na iPhonie', hu: 'Az iPhone-on befejezve', tr: 'iPhone’da bitirildi', ru: 'Завершено на iPhone', uk: 'Завершено на iPhone', ar: 'انتهى على iPhone', hi: 'iPhone पर खत्म हुआ', bn: 'iPhone-এ শেষ হয়েছে', th: 'จบบน iPhone แล้ว', ko: 'iPhone에서 끝났어요', 'zh-Hans': '已在 iPhone 上结束', 'zh-Hant': '已在 iPhone 上結束',
    cs: 'Ukončeno na iPhonu', fa: 'در iPhone پایان یافت', id: 'Diakhiri di iPhone kamu', lt: 'Baigta iPhone', sv: 'Avslutat på din iPhone', vi: 'Đã kết thúc trên iPhone',
  },
  'Log this one on your iPhone.': {
    de: 'Das hier trägst du am iPhone ein.', fr: 'Celui-ci se note sur ton iPhone.', es: 'Este se registra en tu iPhone.', it: 'Questo si registra sull’iPhone.', 'pt-PT': 'Este regista-se no iPhone.', 'pt-BR': 'Este você registra no iPhone.', pl: 'To zapisz na iPhonie.', hu: 'Ezt az iPhone-on rögzítsd.', tr: 'Bunu iPhone’da kaydet.', ru: 'Это записывается на iPhone.', uk: 'Це записуй на iPhone.', ar: 'سجّل هذا على iPhone.', hi: 'इसे iPhone पर दर्ज करें।', bn: 'এটা iPhone-এ লিখুন।', th: 'อันนี้บันทึกบน iPhone', ko: '이건 iPhone에서 기록하세요.', 'zh-Hans': '这个请在 iPhone 上记录。', 'zh-Hant': '這個請在 iPhone 上記錄。',
    cs: 'Tohle zapiš na iPhonu.', fa: 'این را در iPhone ثبت کنید.', id: 'Catat yang ini di iPhone kamu.', lt: 'Šią užregistruokite iPhone.', sv: 'Logga den här på din iPhone.', vi: 'Ghi bài này trên iPhone.',
  },
  'All done?': {
    de: 'Alles erledigt?', fr: 'Terminé ?', es: '¿Has terminado?', it: 'Hai finito?', 'pt-PT': 'Terminaste?', 'pt-BR': 'Terminou?', pl: 'Koniec treningu?', hu: 'Végeztél?', tr: 'Bitirdin mi?', ru: 'Тренировка окончена?', uk: 'Тренування завершено?', ar: 'هل انتهيت؟', hi: 'हो गया?', bn: 'শেষ হয়েছে?', th: 'เสร็จแล้วหรือยัง', ko: '다 끝났나요?', 'zh-Hans': '练完了吗？', 'zh-Hant': '練完了嗎？',
    cs: 'Hotovo?', fa: 'تمام شد؟', id: 'Sudah selesai?', lt: 'Viskas?', sv: 'Klar?', vi: 'Xong chưa?',
  },
  // Water Lock (the screen and the crown's press off until the crown is turned), as in Apple's Workout.
  'Lock': {
    de: 'Sperren', fr: 'Verrouiller', es: 'Bloquear', it: 'Blocca', 'pt-PT': 'Bloquear', 'pt-BR': 'Bloquear', pl: 'Zablokuj', hu: 'Zárolás', tr: 'Kilitle', ru: 'Блокировка', uk: 'Блокування', ar: 'قفل', hi: 'लॉक करें', bn: 'লক করুন', th: 'ล็อก', ko: '잠금', 'zh-Hans': '锁定', 'zh-Hant': '鎖定',
    cs: 'Zamknout', fa: 'قفل', id: 'Kunci', lt: 'Užrakinti', sv: 'Lås', vi: 'Khóa',
  },
  'Skip this set?': {
    de: 'Diesen Satz überspringen?', fr: 'Sauter cette série ?', es: '¿Saltar esta serie?', it: 'Saltare questa serie?', 'pt-PT': 'Saltar esta série?', 'pt-BR': 'Pular esta série?', pl: 'Pominąć tę serię?', hu: 'Kihagyod ezt a sorozatot?', tr: 'Bu set atlansın mı?', ru: 'Пропустить этот подход?', uk: 'Пропустити цей підхід?', ar: 'تخطي هذه المجموعة؟', hi: 'यह सेट छोड़ें?', bn: 'এই সেটটি বাদ দেবেন?', th: 'ข้ามเซ็ตนี้ไหม', ko: '이 세트를 건너뛸까요?', 'zh-Hans': '跳过这一组？', 'zh-Hant': '跳過這一組？',
    cs: 'Přeskočit tuhle sérii?', fa: 'این ست رد شود؟', id: 'Lewati set ini?', lt: 'Praleisti šią seriją?', sv: 'Hoppa över det här setet?', vi: 'Bỏ qua hiệp này?',
  },
  'Turn the Digital Crown to change it.': {
    de: 'Dreh an der Digital Crown, um es zu ändern.', fr: 'Tourne la Digital Crown pour le changer.', es: 'Gira la Digital Crown para cambiarlo.', it: 'Ruota la Digital Crown per cambiarlo.', 'pt-PT': 'Roda a Digital Crown para mudar.', 'pt-BR': 'Gire a Digital Crown para mudar.', pl: 'Obróć Digital Crown, by zmienić.', hu: 'Forgasd a Digital Crownt a módosításhoz.', tr: 'Değiştirmek için Digital Crown’u çevir.', ru: 'Поверните Digital Crown, чтобы изменить.', uk: 'Поверни Digital Crown, щоб змінити.', ar: 'أدر Digital Crown للتغيير.', hi: 'बदलने के लिए Digital Crown घुमाएँ।', bn: 'বদলাতে Digital Crown ঘোরান।', th: 'หมุน Digital Crown เพื่อเปลี่ยน', ko: '바꾸려면 Digital Crown을 돌리세요.', 'zh-Hans': '转动数码表冠来更改。', 'zh-Hant': '轉動數位錶冠來更改。',
    cs: 'Otoč korunkou Digital Crown a změň to.', fa: 'برای تغییر، Digital Crown را بچرخانید.', id: 'Putar Digital Crown untuk mengubahnya.', lt: 'Pasukite Digital Crown, kad pakeistumėte.', sv: 'Vrid på Digital Crown för att ändra.', vi: 'Xoay Digital Crown để thay đổi.',
  },
  '%lld avg · %lld max': {
    de: 'Ø %lld · max. %lld', fr: 'moy. %lld · max %lld', es: 'media %lld · máx. %lld', it: 'media %lld · max %lld', 'pt-PT': 'média %lld · máx. %lld', 'pt-BR': 'média %lld · máx. %lld', pl: 'śr. %lld · maks. %lld', hu: 'átl. %lld · max. %lld', tr: 'ort. %lld · maks. %lld', ru: 'ср. %lld · макс. %lld', uk: 'сер. %lld · макс. %lld', ar: 'متوسط %lld · أقصى %lld', hi: 'औसत %lld · अधिकतम %lld', bn: 'গড় %lld · সর্বোচ্চ %lld', th: 'เฉลี่ย %lld · สูงสุด %lld', ko: '평균 %lld · 최대 %lld', 'zh-Hans': '平均 %lld · 最高 %lld', 'zh-Hant': '平均 %lld · 最高 %lld',
    cs: 'průměr %lld · max %lld', fa: 'میانگین %lld · بیشینه %lld', id: 'rata-rata %lld · maks %lld', lt: 'vid. %lld · maks. %lld', sv: 'snitt %lld · max %lld', vi: 'TB %lld · tối đa %lld',
  },
  'Set %lld of %lld': {
    de: 'Satz %lld von %lld', fr: 'Série %lld sur %lld', es: 'Serie %lld de %lld', it: 'Serie %lld di %lld', 'pt-PT': 'Série %lld de %lld', 'pt-BR': 'Série %lld de %lld', pl: 'Seria %lld z %lld', hu: '%lld. sorozat / %lld', tr: 'Set %lld / %lld', ru: 'Подход %lld из %lld', uk: 'Підхід %lld з %lld', ar: 'المجموعة %lld من %lld', hi: 'सेट %lld / %lld', bn: 'সেট %lld / %lld', th: 'เซ็ต %lld จาก %lld', ko: '%lld/%lld세트', 'zh-Hans': '第 %lld 组，共 %lld 组', 'zh-Hant': '第 %lld 組，共 %lld 組',
    cs: 'Série %lld z %lld', fa: 'ست %lld از %lld', id: 'Set %lld dari %lld', lt: 'Serija %lld iš %lld', sv: 'Set %lld av %lld', vi: 'Hiệp %lld / %lld',
  },
  '%lld of %lld sets': {
    de: '%lld von %lld Sätzen', fr: '%lld séries sur %lld', es: '%lld de %lld series', it: '%lld serie su %lld', 'pt-PT': '%lld de %lld séries', 'pt-BR': '%lld de %lld séries', pl: '%lld z %lld serii', hu: '%lld / %lld sorozat', tr: '%lld / %lld set', ru: '%lld из %lld подходов', uk: '%lld з %lld підходів', ar: '%lld من %lld مجموعات', hi: '%lld / %lld सेट', bn: '%lld / %lld সেট', th: '%lld จาก %lld เซ็ต', ko: '%lld/%lld세트', 'zh-Hans': '%lld / %lld 组', 'zh-Hant': '%lld / %lld 組',
    cs: '%lld z %lld sérií', fa: '%lld از %lld ست', id: '%lld dari %lld set', lt: '%lld iš %lld serijų', sv: '%lld av %lld set', vi: '%lld / %lld hiệp',
  },
  'Tap to change it.': {
    de: 'Tippe, um es zu ändern.', fr: 'Touche pour le changer.', es: 'Toca para cambiarlo.', it: 'Tocca per cambiarlo.', 'pt-PT': 'Toca para mudar.', 'pt-BR': 'Toque para mudar.', pl: 'Stuknij, by zmienić.', hu: 'Koppints a módosításhoz.', tr: 'Değiştirmek için dokun.', ru: 'Нажмите, чтобы изменить.', uk: 'Торкнись, щоб змінити.', ar: 'اضغط للتغيير.', hi: 'बदलने के लिए टैप करें।', bn: 'বদলাতে ট্যাপ করুন।', th: 'แตะเพื่อเปลี่ยน', ko: '탭해서 바꾸세요.', 'zh-Hans': '轻点以更改。', 'zh-Hant': '輕點以更改。',
    cs: 'Klepni a změň to.', fa: 'برای تغییر ضربه بزنید.', id: 'Ketuk untuk mengubah.', lt: 'Bakstelėkite, kad pakeistumėte.', sv: 'Tryck för att ändra.', vi: 'Chạm để thay đổi.',
  },
  'Added weight': {
    de: 'Zusatzgewicht', fr: 'Poids ajouté', es: 'Peso añadido', it: 'Peso aggiunto', 'pt-PT': 'Peso adicional', 'pt-BR': 'Peso adicional', pl: 'Dodatkowy ciężar', hu: 'Plusz súly', tr: 'Ek ağırlık', ru: 'Доп. вес', uk: 'Додаткова вага', ar: 'وزن إضافي', hi: 'अतिरिक्त वज़न', bn: 'অতিরিক্ত ওজন', th: 'น้ำหนักเพิ่ม', ko: '추가 무게', 'zh-Hans': '附加重量', 'zh-Hant': '附加重量',
    cs: 'Přidaná váha', fa: 'وزن اضافه', id: 'Beban tambahan', lt: 'Papildomas svoris', sv: 'Extra vikt', vi: 'Tạ thêm',
  },
  'Your rest, your next set, or today\'s workout.': {
    de: 'Deine Pause, dein nächster Satz oder das Training von heute.', fr: 'Ton repos, ta prochaine série ou la séance du jour.', es: 'Tu descanso, tu próxima serie o el entreno de hoy.', it: 'Il tuo recupero, la prossima serie o l’allenamento di oggi.', 'pt-PT': 'O teu descanso, a próxima série ou o treino de hoje.', 'pt-BR': 'Seu descanso, a próxima série ou o treino de hoje.', pl: 'Twoja przerwa, następna seria albo dzisiejszy trening.', hu: 'A pihenőd, a következő sorozat vagy a mai edzés.', tr: 'Dinlenmen, sıradaki setin ya da bugünkü antrenman.', ru: 'Отдых, следующий подход или сегодняшняя тренировка.', uk: 'Відпочинок, наступний підхід або сьогоднішнє тренування.', ar: 'راحتك، أو مجموعتك التالية، أو تمرين اليوم.', hi: 'आपका आराम, अगला सेट, या आज का वर्कआउट।', bn: 'আপনার বিশ্রাম, পরের সেট, বা আজকের ওয়ার্কআউট।', th: 'ช่วงพัก เซ็ตถัดไป หรือการฝึกวันนี้', ko: '휴식, 다음 세트, 또는 오늘의 운동.', 'zh-Hans': '你的休息、下一组或今天的训练。', 'zh-Hant': '你的休息、下一組或今天的訓練。',
    cs: 'Tvoje pauza, další série nebo dnešní trénink.', fa: 'استراحت شما، ست بعدی یا تمرین امروز.', id: 'Istirahatmu, set berikutnya, atau latihan hari ini.', lt: 'Jūsų poilsis, kita serija arba šiandienos treniruotė.', sv: 'Din vila, ditt nästa set eller dagens pass.', vi: 'Thời gian nghỉ, hiệp tiếp theo hoặc buổi tập hôm nay.',
  },
  'Opens openGym.': {
    de: 'Öffnet openGym.', fr: 'Ouvre openGym.', es: 'Abre openGym.', it: 'Apre openGym.', 'pt-PT': 'Abre o openGym.', 'pt-BR': 'Abre o openGym.', pl: 'Otwiera openGym.', hu: 'Megnyitja az openGymet.', tr: 'openGym’i açar.', ru: 'Открывает openGym.', uk: 'Відкриває openGym.', ar: 'يفتح openGym.', hi: 'openGym खोलता है।', bn: 'openGym খোলে।', th: 'เปิด openGym', ko: 'openGym을 열어요.', 'zh-Hans': '打开 openGym。', 'zh-Hant': '打開 openGym。',
    cs: 'Otevře openGym.', fa: 'openGym را باز می‌کند.', id: 'Membuka openGym.', lt: 'Atidaro „openGym“.', sv: 'Öppnar openGym.', vi: 'Mở openGym.',
  },
  'Hold to finish': {
    de: 'Halten zum Beenden', fr: 'Maintiens pour terminer', es: 'Mantén para terminar', it: 'Tieni premuto per finire', 'pt-PT': 'Mantém premido para terminar', 'pt-BR': 'Segure para terminar', pl: 'Przytrzymaj, by zakończyć', hu: 'Tartsd nyomva a befejezéshez', tr: 'Bitirmek için basılı tut', ru: 'Удерживайте, чтобы завершить', uk: 'Утримуй, щоб завершити', ar: 'اضغط مطولًا للإنهاء', hi: 'खत्म करने के लिए दबाए रखें', bn: 'শেষ করতে চেপে ধরুন', th: 'กดค้างเพื่อจบ', ko: '길게 눌러 끝내기', 'zh-Hans': '按住以结束', 'zh-Hant': '按住以結束', cs: 'Podrž pro dokončení', fa: 'برای پایان نگه دارید', id: 'Tahan untuk selesai', lt: 'Palaikykite, kad baigtumėte', sv: 'Håll in för att avsluta', vi: 'Giữ để kết thúc',
  },
  'iPhone out of reach': {
    de: 'iPhone außer Reichweite', fr: 'iPhone hors de portée', es: 'iPhone fuera de alcance', it: 'iPhone fuori portata', 'pt-PT': 'iPhone fora de alcance', 'pt-BR': 'iPhone fora de alcance', pl: 'iPhone poza zasięgiem', hu: 'Az iPhone nincs a közelben', tr: 'iPhone menzil dışında', ru: 'iPhone вне зоны', uk: 'iPhone поза зоною', ar: 'iPhone خارج النطاق', hi: 'iPhone पहुँच से बाहर', bn: 'iPhone নাগালের বাইরে', th: 'iPhone อยู่นอกระยะ', ko: 'iPhone이 멀리 있어요', 'zh-Hans': 'iPhone 不在附近', 'zh-Hant': 'iPhone 不在附近', cs: 'iPhone je mimo dosah', fa: 'iPhone خارج از دسترس است', id: 'iPhone di luar jangkauan', lt: 'iPhone nepasiekiamas', sv: 'iPhone utom räckhåll', vi: 'iPhone ngoài tầm kết nối',
  },
  'No set for %lld min. Still at it?': {
    de: 'Seit %lld Min. kein Satz. Noch dabei?', fr: 'Aucune série depuis %lld min. Toujours là ?', es: 'Ninguna serie en %lld min. ¿Sigues?', it: 'Nessuna serie da %lld min. Ci sei ancora?', 'pt-PT': 'Nenhuma série há %lld min. Ainda aí?', 'pt-BR': 'Nenhuma série há %lld min. Ainda aí?', pl: 'Brak serii od %lld min. Dalej ćwiczysz?', hu: '%lld perce nincs sorozat. Még edzel?', tr: '%lld dakikadır set yok. Hâlâ orada mısın?', ru: 'Ни одного подхода %lld мин. Ещё тренируетесь?', uk: 'Жодного підходу %lld хв. Ще тренуєшся?', ar: 'لا مجموعة منذ %lld دقيقة. ما زلت تتمرن؟', hi: '%lld मिनट से कोई सेट नहीं। अभी भी लगे हैं?', bn: '%lld মিনিট ধরে কোনো সেট নেই। এখনো চলছে?', th: 'ไม่มีเซ็ตมา %lld นาทีแล้ว ยังฝึกอยู่ไหม', ko: '%lld분째 세트가 없어요. 아직 운동 중이세요?', 'zh-Hans': '已经 %lld 分钟没有记录组了。还在练吗？', 'zh-Hant': '已經 %lld 分鐘沒有記錄組了。還在練嗎？', cs: 'Už %lld min žádná série. Pořád cvičíš?', fa: '%lld دقیقه است که ستی ثبت نشده. هنوز تمرین می‌کنید؟', id: 'Tidak ada set selama %lld mnt. Masih latihan?', lt: 'Jau %lld min. be serijos. Dar treniruojatės?', sv: 'Inget set på %lld min. Kör du fortfarande?', vi: 'Đã %lld phút không có hiệp nào. Bạn còn tập không?',
  },
  'A skipped set is still waiting.': {
    de: 'Ein übersprungener Satz wartet noch.', fr: 'Une série passée attend encore.', es: 'Una serie saltada aún te espera.', it: 'Una serie saltata ti aspetta ancora.', 'pt-PT': 'Uma série saltada ainda está à espera.', 'pt-BR': 'Uma série pulada ainda está esperando.', pl: 'Pominięta seria wciąż czeka.', hu: 'Egy kihagyott sorozat még vár.', tr: 'Atlanan bir set hâlâ bekliyor.', ru: 'Пропущенный подход ещё ждёт.', uk: 'Пропущений підхід ще чекає.', ar: 'مجموعة متخطاة ما زالت تنتظر.', hi: 'छोड़ा गया एक सेट अभी बाकी है।', bn: 'বাদ দেওয়া একটি সেট এখনো বাকি।', th: 'ยังมีเซ็ตที่ข้ามไว้รออยู่', ko: '건너뛴 세트가 아직 남아 있어요.', 'zh-Hans': '还有一组跳过的在等你。', 'zh-Hant': '還有一組跳過的在等你。', cs: 'Přeskočená série pořád čeká.', fa: 'یک ست ردشده هنوز منتظر است.', id: 'Satu set yang dilewati masih menunggu.', lt: 'Praleista serija vis dar laukia.', sv: 'Ett överhoppat set väntar fortfarande.', vi: 'Vẫn còn một hiệp đã bỏ qua đang chờ.',
  },
  // The summary's calories, as two small lines beside the number (Apple's "ACTIVE / CAL").
  'Active\nkcal': {
    de: 'Aktive\nkcal', fr: 'Kcal\nactives', es: 'Kcal\nactivas', it: 'Kcal\nattive', 'pt-PT': 'Kcal\nativas', 'pt-BR': 'Kcal\nativas', pl: 'Aktywne\nkcal', hu: 'Aktív\nkcal', tr: 'Aktif\nkcal', ru: 'Активные\nккал', uk: 'Активні\nккал', ar: 'سعرات\nنشطة', hi: 'सक्रिय\nkcal', bn: 'সক্রিয়\nkcal', th: 'แคลอรี\nที่ใช้งาน', ko: '활동\nkcal', 'zh-Hans': '活动\n千卡', 'zh-Hant': '活動\n大卡',
    cs: 'Aktivní\nkcal', fa: 'کالری\nفعال', id: 'Kkal\naktif', lt: 'Aktyvios\nkcal', sv: 'Aktiva\nkcal', vi: 'Kcal\nhoạt động', da: 'Aktive\nkcal',
  },
  // The Metrics pages' titles, in the row under the clock.
  'Metrics': {
    de: 'Messwerte', fr: 'Mesures', es: 'Métricas', it: 'Metriche', 'pt-PT': 'Métricas', 'pt-BR': 'Métricas', pl: 'Pomiary', hu: 'Mérések', tr: 'Ölçümler', ru: 'Показатели', uk: 'Показники', ar: 'المقاييس', hi: 'मेट्रिक्स', bn: 'মেট্রিক্স', th: 'ตัวชี้วัด', ko: '측정값', 'zh-Hans': '指标', 'zh-Hant': '指標',
    cs: 'Metriky', fa: 'معیارها', id: 'Metrik', lt: 'Rodikliai', sv: 'Mätvärden', vi: 'Chỉ số', da: 'Målinger',
  },
  'Zones': {
    de: 'Zonen', fr: 'Zones', es: 'Zonas', it: 'Zone', 'pt-PT': 'Zonas', 'pt-BR': 'Zonas', pl: 'Strefy', hu: 'Zónák', tr: 'Bölgeler', ru: 'Зоны', uk: 'Зони', ar: 'المناطق', hi: 'ज़ोन', bn: 'জোন', th: 'โซน', ko: '구간', 'zh-Hans': '区间', 'zh-Hant': '區間',
    cs: 'Zóny', fa: 'ناحیه‌ها', id: 'Zona', lt: 'Zonos', sv: 'Zoner', vi: 'Vùng', da: 'Zoner',
  },
  // The Pulse and Effort pages of Metrics.
  'avg': {
    de: 'Ø', fr: 'moy.', es: 'media', it: 'media', 'pt-PT': 'média', 'pt-BR': 'média', pl: 'śr.', hu: 'átl.', tr: 'ort.', ru: 'ср.', uk: 'сер.', ar: 'المتوسط', hi: 'औसत', bn: 'গড়', th: 'เฉลี่ย', ko: '평균', 'zh-Hans': '平均', 'zh-Hant': '平均',
    cs: 'prům.', fa: 'میانگین', id: 'rata-rata', lt: 'vid.', sv: 'snitt', vi: 'TB',
  },
  'No effort rated yet': {
    de: 'Noch keine Anstrengung bewertet', fr: 'Aucun effort noté', es: 'Aún sin esfuerzo valorado', it: 'Nessuno sforzo valutato', 'pt-PT': 'Ainda sem esforço avaliado', 'pt-BR': 'Nenhum esforço avaliado', pl: 'Brak ocenionego wysiłku', hu: 'Még nincs értékelt erőfeszítés', tr: 'Henüz çaba puanlanmadı', ru: 'Усилие ещё не оценено', uk: 'Зусилля ще не оцінено', ar: 'لم يُقيَّم أي جهد بعد', hi: 'अभी कोई प्रयास रेट नहीं हुआ', bn: 'এখনো কোনো পরিশ্রম রেট করা হয়নি', th: 'ยังไม่ได้ให้คะแนนความหนัก', ko: '아직 평가한 강도가 없어요', 'zh-Hans': '尚未评定强度', 'zh-Hant': '尚未評定強度',
    cs: 'Zatím žádná namáhavost', fa: 'هنوز شدتی ثبت نشده', id: 'Belum ada usaha yang dinilai', lt: 'Dar neįvertinta jokio krūvio', sv: 'Ingen ansträngning betygsatt än', vi: 'Chưa đánh giá mức nỗ lực',
  },
  // The Pulse page's highest and lowest reading.
  'max': { ar: 'الأقصى', bn: 'সর্বোচ্চ', cs: 'max', de: 'max', es: 'máx.', fa: 'بیشینه', fr: 'max', hi: 'अधिकतम', hu: 'max.', id: 'maks', it: 'max', ko: '최대', lt: 'maks.', pl: 'maks.', 'pt-BR': 'máx.', 'pt-PT': 'máx.', ru: 'макс.', sv: 'max', th: 'สูงสุด', tr: 'maks.', uk: 'макс.', vi: 'tối đa', 'zh-Hans': '最高', 'zh-Hant': '最高' },
  'min': { ar: 'الأدنى', bn: 'সর্বনিম্ন', cs: 'min', de: 'min', es: 'mín.', fa: 'کمینه', fr: 'min', hi: 'न्यूनतम', hu: 'min.', id: 'min', it: 'min', ko: '최소', lt: 'min.', pl: 'min.', 'pt-BR': 'mín.', 'pt-PT': 'mín.', ru: 'мин.', sv: 'min', th: 'ต่ำสุด', tr: 'min.', uk: 'мін.', vi: 'tối thiểu', 'zh-Hans': '最低', 'zh-Hant': '最低' },
}

// Info.plist's own (the Apple Health permission prompts), into InfoPlist.strings.
const PLIST = {
  NSHealthShareUsageDescription: {
    ar: 'يعرض openGym نبضك أثناء التمرين وبجانب كل مجموعة، ويستخدم تاريخ ميلادك لنطاقات النبض.',
    bn: 'openGym ওয়ার্কআউটের সময় এবং প্রতিটি সেটের পাশে তোমার হার্ট রেট দেখায়, এবং হার্ট রেট জোনের জন্য তোমার জন্মতারিখ ব্যবহার করে।',
    cs: 'openGym ukazuje tvůj tep během tréninku a u každé série a pro tepové zóny používá tvé datum narození.',
    de: 'openGym zeigt deinen Puls während des Trainings und neben jedem Satz und nutzt dein Geburtsdatum für die Pulszonen.',
    es: 'openGym muestra tu pulso durante el entreno y junto a cada serie, y usa tu fecha de nacimiento para las zonas de pulso.',
    fa: 'openGym ضربان قلبت را حین تمرین و کنار هر ست نشان می\u200cدهد و برای ناحیه\u200cهای ضربان از تاریخ تولدت استفاده می\u200cکند.',
    fr: 'openGym affiche ton pouls pendant la séance et à côté de chaque série, et utilise ta date de naissance pour les zones cardiaques.',
    hi: 'openGym वर्कआउट के दौरान और हर सेट के पास तुम्हारी हार्ट रेट दिखाता है, और हार्ट रेट ज़ोन के लिए तुम्हारी जन्मतिथि इस्तेमाल करता है।',
    hu: 'Az openGym edzés közben és minden sorozat mellett mutatja a pulzusodat, a pulzuszónákhoz pedig a születési dátumodat használja.',
    id: 'openGym menampilkan detak jantungmu selama latihan dan di samping setiap set, dan memakai tanggal lahirmu untuk zona detak jantung.',
    it: "openGym mostra il tuo battito durante l'allenamento e accanto a ogni serie, e usa la tua data di nascita per le zone cardiache.",
    ko: 'openGym은 운동 중과 각 세트 옆에 심박수를 보여 주고, 심박수 구간에 생년월일을 사용합니다.',
    lt: 'openGym rodo tavo pulsą treniruotės metu ir prie kiekvienos serijos, o pulso zonoms naudoja tavo gimimo datą.',
    pl: 'openGym pokazuje twoje tętno podczas treningu i przy każdej serii, a do stref tętna używa twojej daty urodzenia.',
    'pt-BR': 'O openGym mostra sua frequência cardíaca durante o treino e ao lado de cada série, e usa sua data de nascimento para as zonas cardíacas.',
    'pt-PT': 'O openGym mostra a tua frequência cardíaca durante o treino e junto a cada série, e usa a tua data de nascimento para as zonas cardíacas.',
    ru: 'openGym показывает пульс во время тренировки и рядом с каждым подходом, а для пульсовых зон использует твою дату рождения.',
    sv: 'openGym visar din puls under passet och vid varje set och använder ditt födelsedatum för pulszonerna.',
    th: 'openGym แสดงอัตราการเต้นของหัวใจระหว่างออกกำลังกายและข้างแต่ละเซ็ต และใช้วันเกิดของคุณสำหรับโซนหัวใจ',
    tr: 'openGym antrenman sırasında ve her setin yanında nabzını gösterir, nabız bölgeleri için doğum tarihini kullanır.',
    uk: 'openGym показує пульс під час тренування і біля кожного підходу, а для пульсових зон використовує твою дату народження.',
    vi: 'openGym hiển thị nhịp tim của bạn trong lúc tập và cạnh mỗi hiệp, và dùng ngày sinh của bạn cho các vùng nhịp tim.',
    'zh-Hans': 'openGym 会在训练中和每组旁显示你的心率，并用你的出生日期计算心率区间。',
    'zh-Hant': 'openGym 會在訓練中和每組旁顯示你的心率，並用你的出生日期計算心率區間。',
  },
  NSHealthUpdateUsageDescription: {
    de: 'openGym speichert deine Trainings in Apple Health, wenn du das einschaltest.', fr: 'openGym enregistre tes séances dans Apple Santé si tu l’actives.',
    es: 'openGym guarda tus entrenos en Apple Salud si lo activas.', it: 'openGym salva i tuoi allenamenti in Apple Salute se lo attivi.',
    'pt-PT': 'O openGym guarda os teus treinos no Apple Saúde se o ativares.', 'pt-BR': 'O openGym salva seus treinos no Apple Saúde se você ativar.',
    pl: 'openGym zapisuje treningi w Apple Zdrowie, jeśli to włączysz.', hu: 'Az openGym az Apple Egészség appba menti az edzéseidet, ha bekapcsolod.',
    tr: 'Açarsan openGym antrenmanlarını Apple Sağlık’a kaydeder.', ru: 'openGym сохраняет тренировки в Apple Здоровье, если вы это включите.',
    uk: 'openGym зберігає тренування в Apple Здоров’я, якщо ти це ввімкнеш.', ar: 'يحفظ openGym تمارينك في Apple صحتي إذا فعّلت ذلك.',
    hi: 'चालू करने पर openGym आपके वर्कआउट Apple Health में सहेजता है।', bn: 'চালু করলে openGym আপনার ওয়ার্কআউট Apple Health-এ সেভ করে।',
    th: 'openGym บันทึกการฝึกลงใน Apple Health เมื่อคุณเปิดใช้', ko: '켜면 openGym이 운동을 Apple 건강에 저장해요.',
    'zh-Hans': '打开后，openGym 会把训练保存到 Apple 健康。', 'zh-Hant': '開啟後，openGym 會把訓練儲存到 Apple 健康。',
    cs: 'openGym ukládá tvoje tréninky do Apple Zdraví, když to zapneš.', fa: 'اگر روشن کنید، openGym تمرین‌هایتان را در Apple Health ذخیره می‌کند.', id: 'openGym menyimpan latihanmu ke Apple Kesehatan jika kamu menyalakannya.', lt: 'Jei įjungsite, „openGym“ išsaugos jūsų treniruotes „Apple Health“.', sv: 'openGym sparar dina pass i Apple Hälsa om du slår på det.', vi: 'openGym lưu buổi tập của bạn vào Apple Sức khỏe khi bạn bật tính năng này.',
  },
}

// Set types (Task 7): the tag words and the toast; "Taken to failure", "Drop set" and "More" are the phone's.
const SET_TYPES = {
  'Failure': { de: 'Versagen', fr: 'Échec', es: 'Fallo', it: 'Cedimento', 'pt-PT': 'Falha', 'pt-BR': 'Falha', pl: 'Upadek', hu: 'Kudarc', tr: 'Tükeniş', ru: 'Отказ', uk: 'Відмова', ar: 'فشل', hi: 'फेल्योर', bn: 'ফেইলিওর', th: 'หมดแรง', ko: '실패', 'zh-Hans': '力竭', 'zh-Hant': '力竭', cs: 'Selhání', fa: 'شکست', id: 'Gagal', lt: 'Nesėkmė', sv: 'Utmattning', vi: 'Kiệt sức', da: 'Failure' },
  'Drop': { de: 'Drop', fr: 'Drop', es: 'Drop', it: 'Drop', 'pt-PT': 'Drop', 'pt-BR': 'Drop', pl: 'Drop', hu: 'Drop', tr: 'Drop', ru: 'Дроп', uk: 'Дроп', ar: 'دروب', hi: 'ड्रॉप', bn: 'ড্রপ', th: 'ดรอป', ko: '드롭', 'zh-Hans': '递减', 'zh-Hant': '遞減', cs: 'Drop', fa: 'دراپ', id: 'Drop', lt: 'Drop', sv: 'Drop', vi: 'Drop', da: 'Drop' },
  'Set %lld added': { de: 'Satz %lld hinzugefügt', fr: 'Série %lld ajoutée', es: 'Serie %lld añadida', it: 'Serie %lld aggiunta', 'pt-PT': 'Série %lld adicionada', 'pt-BR': 'Série %lld adicionada', pl: 'Dodano serię %lld', hu: '%lld. sorozat hozzáadva', tr: '%lld. set eklendi', ru: 'Подход %lld добавлен', uk: 'Підхід %lld додано', ar: 'تمت إضافة المجموعة %lld', hi: 'सेट %lld जोड़ा गया', bn: 'সেট %lld যোগ হয়েছে', th: 'เพิ่มเซต %lld แล้ว', ko: '%lld세트 추가됨', 'zh-Hans': '已添加第 %lld 组', 'zh-Hant': '已新增第 %lld 組', cs: 'Přidána série %lld', fa: 'ست %lld اضافه شد', id: 'Set %lld ditambahkan', lt: 'Pridėta %lld serija', sv: 'Set %lld tillagt', vi: 'Đã thêm hiệp %lld', da: 'Sæt %lld tilføjet' },
}
Object.assign(OWN, SET_TYPES)

// Set menu (Task 8): remove hint, what is lost, the Removed screen and the toast's second line (own words, native check before release).
const SET_MENU = {
  "Hold 1 s to remove": { de: "1 s halten zum Entfernen", fr: "Maintiens 1 s pour retirer", es: "Mantén 1 s para quitar", it: "Tieni premuto 1 s per rimuovere", "pt-PT": "Mantém 1 s para remover", "pt-BR": "Segure 1 s para remover", pl: "Przytrzymaj 1 s, by usunąć", hu: "Tartsd 1 mp-ig a törléshez", tr: "Kaldırmak için 1 sn basılı tut", ru: "Удерживай 1 с, чтобы удалить", uk: "Утримуй 1 с, щоб видалити", ar: "اضغط مطولًا ثانية للحذف", hi: "हटाने के लिए 1 सेकंड दबाओ", bn: "সরাতে ১ সেকেন্ড চেপে ধরো", th: "กดค้าง 1 วิ เพื่อลบ", ko: "1초간 눌러 삭제", "zh-Hans": "按住 1 秒删除", "zh-Hant": "按住 1 秒刪除", cs: "Podrž 1 s pro odebrání", fa: "برای حذف ۱ ثانیه نگه دار", id: "Tahan 1 dtk untuk menghapus", lt: "Laikyk 1 s, kad pašalintum", sv: "Håll 1 s för att ta bort", vi: "Giữ 1 giây để xóa", da: "Hold 1 s for at fjerne" },
  "Set %lld · %@ is lost": { de: "Satz %lld · %@ geht verloren", fr: "Série %lld · %@ sera perdue", es: "Serie %lld · %@ se pierde", it: "Serie %lld · %@ va persa", "pt-PT": "Série %lld · %@ perde-se", "pt-BR": "Série %lld · %@ será perdida", pl: "Seria %lld · %@ zniknie", hu: "%lld. sorozat · %@ elvész", tr: "%lld. set · %@ kaybolur", ru: "Подход %lld · %@ будет потерян", uk: "Підхід %lld · %@ буде втрачено", ar: "المجموعة %lld · %@ ستُفقد", hi: "सेट %lld · %@ खो जाएगा", bn: "সেট %lld · %@ হারিয়ে যাবে", th: "เซต %lld · %@ จะหายไป", ko: "%lld세트 · %@ 사라짐", "zh-Hans": "第 %lld 组 · %@ 将丢失", "zh-Hant": "第 %lld 組 · %@ 將遺失", cs: "Série %lld · %@ se ztratí", fa: "ست %lld · %@ از بین می‌رود", id: "Set %lld · %@ hilang", lt: "%lld serija · %@ bus prarasta", sv: "Set %lld · %@ går förlorat", vi: "Hiệp %lld · %@ sẽ mất", da: "Sæt %lld · %@ går tabt" },
  "Set %lld removed": { de: "Satz %lld entfernt", fr: "Série %lld retirée", es: "Serie %lld quitada", it: "Serie %lld rimossa", "pt-PT": "Série %lld removida", "pt-BR": "Série %lld removida", pl: "Usunięto serię %lld", hu: "%lld. sorozat törölve", tr: "%lld. set kaldırıldı", ru: "Подход %lld удалён", uk: "Підхід %lld видалено", ar: "تمت إزالة المجموعة %lld", hi: "सेट %lld हटाया गया", bn: "সেট %lld সরানো হয়েছে", th: "ลบเซต %lld แล้ว", ko: "%lld세트 삭제됨", "zh-Hans": "已删除第 %lld 组", "zh-Hant": "已刪除第 %lld 組", cs: "Série %lld odebrána", fa: "ست %lld حذف شد", id: "Set %lld dihapus", lt: "Pašalinta %lld serija", sv: "Set %lld borttaget", vi: "Đã xóa hiệp %lld", da: "Sæt %lld fjernet" },
  "at the end": { de: "am Ende", fr: "à la fin", es: "al final", it: "alla fine", "pt-PT": "no fim", "pt-BR": "no final", pl: "na końcu", hu: "a végén", tr: "sonda", ru: "в конце", uk: "у кінці", ar: "في النهاية", hi: "अंत में", bn: "শেষে", th: "ท้ายสุด", ko: "맨 끝에", "zh-Hans": "在末尾", "zh-Hant": "在末尾", cs: "na konci", fa: "در آخر", id: "di akhir", lt: "pabaigoje", sv: "på slutet", vi: "ở cuối", da: "til sidst" },
}
Object.assign(OWN, SET_MENU)

// Danish (#1039): the watch's own lines.
for (const [k, v] of Object.entries({"No workout running": "Ingen træning i gang", "Not synced yet": "Ikke synkroniseret endnu", "Open openGym on your iPhone once and your routines show up here.": "Åbn openGym på din iPhone én gang, så dukker dine rutiner op her.", "Start one on your iPhone and it shows up here.": "Start en på din iPhone, så dukker den op her.", "All sets done": "Alle sæt klaret", "measuring": "måler …", "%@, set %lld": "%@, sæt %lld", "Calories": "Kalorier", "Heart rate": "Puls", "Hold": "Hold", "Stop": "Stop", "Start hold": "Start hold", "Workout saved": "Træning gemt", "Ended on your iPhone": "Afsluttet på din iPhone", "Log this one on your iPhone.": "Log den her på din iPhone.", "All done?": "Færdig?", "Lock": "Lås", "Skip this set?": "Spring dette sæt over?", "Turn the Digital Crown to change it.": "Drej på Digital Crown for at ændre det.", "%lld avg · %lld max": "snit %lld · maks %lld", "Set %lld of %lld": "Sæt %lld af %lld", "%lld of %lld sets": "%lld af %lld sæt", "Tap to change it.": "Tryk for at ændre det.", "Added weight": "Ekstra vægt", "Your rest, your next set, or today's workout.": "Din pause, dit næste sæt eller dagens træning.", "Opens openGym.": "Åbner openGym.", "Hold to finish": "Hold inde for at afslutte", "iPhone out of reach": "iPhone uden for rækkevidde", "No set for %lld min. Still at it?": "Intet sæt i %lld min. Er du stadig i gang?", "A skipped set is still waiting.": "Et sprunget sæt venter stadig.", "avg": "gns.", "No effort rated yet": "Ingen anstrengelse vurderet endnu", "max": "maks.", "min": "min."})) OWN[k].da = v
for (const [k, v] of Object.entries({"NSHealthShareUsageDescription": "openGym viser din puls under træningen og ved hvert sæt og bruger din fødselsdato til pulszonerne.", "NSHealthUpdateUsageDescription": "openGym gemmer dine træninger i Apple Sundhed, hvis du slår det til."})) PLIST[k].da = v

const esc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
let problems = 0
for (const [pack, lproj] of Object.entries(LANGS)) {
  const { default: dict } = await import(pathToFileURL(join(root, 'src', 'locales', pack + '.js')).href)
  const lines = [`/* openGym on the Apple Watch, ${lproj}. Written by ios/ci/watch-strings.mjs: change that, not this. */`, '']
  const put = (k, v) => {
    if (!v) { console.error(`${lproj}: no word for "${k}"`); problems++; return }
    if (/—/.test(v)) { console.error(`${lproj}: em dash in "${k}"`); problems++ }
    lines.push(`"${esc(k)}" = "${esc(v)}";`)
  }
  for (const [k, appKey] of Object.entries(FROM_APP)) put(k, dict[appKey])
  for (const [k, [appKey, f]] of Object.entries(COMPOSED)) put(k, dict[appKey] && f(dict[appKey], lproj))
  for (const [k, tr] of Object.entries(OWN)) put(k, tr[lproj])
  mkdirSync(join(out, `${lproj}.lproj`), { recursive: true })
  writeFileSync(join(out, `${lproj}.lproj`, 'Localizable.strings'), lines.join('\n') + '\n')
  // The widget says a few of the same words (Rest, Start workout).
  mkdirSync(join(widgets, `${lproj}.lproj`), { recursive: true })
  writeFileSync(join(widgets, `${lproj}.lproj`, 'Localizable.strings'), lines.join('\n') + '\n')
  const plist = [`/* openGym on the Apple Watch, ${lproj}: Info.plist. Written by ios/ci/watch-strings.mjs. */`, '']
  for (const [k, tr] of Object.entries(PLIST)) {
    if (!tr[lproj] || /—/.test(tr[lproj])) { console.error(`${lproj}: ${k} missing or with an em dash`); problems++; continue }
    plist.push(`"${k}" = "${esc(tr[lproj])}";`)
  }
  writeFileSync(join(out, `${lproj}.lproj`, 'InfoPlist.strings'), plist.join('\n') + '\n')
}
// English: every key as itself. Without an en.lproj a watch set to another language could show
// that language's words to an app in English.
{
  const keys = [...Object.keys(FROM_APP), ...Object.keys(COMPOSED), ...Object.keys(OWN)]
  const lines = ['/* openGym on the Apple Watch, en. Written by ios/ci/watch-strings.mjs: change that, not this. */', '']
  for (const k of keys) lines.push(`"${esc(k)}" = "${esc(k === 'Warm-up disc' ? 'Warm-up' : k)}";`)
  for (const dir of [out, widgets]) {
    mkdirSync(join(dir, 'en.lproj'), { recursive: true })
    writeFileSync(join(dir, 'en.lproj', 'Localizable.strings'), lines.join('\n') + '\n')
  }
}
if (problems) process.exit(1)
console.log(`wrote ${Object.keys(LANGS).length} languages`)
