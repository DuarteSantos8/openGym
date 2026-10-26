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
}

// The watch's key (what the Swift source says) → the app's key, for words the app already has.
const FROM_APP = {
  'Today': 'Today',
  'Start workout': 'Start workout',
  'Done': 'Done',
  'Warm-up': 'Warm-up',
  'Reps': 'Reps',
  'Rest': 'Rest',
  'Skip': 'Skip',
  'Finish workout': 'Finish workout',
  'Finish workout?': 'Finish workout?',
  'Finish and save': 'Finish and save',
  'Discard workout': 'Discard workout',
  'Continue workout': 'Continue workout',
  'Cancel': 'Cancel',
  'Rest’s over. Next set!': 'Rest’s over. Next set!',
  'Left': 'Left',
  'Right': 'Right',
  'Bodyweight': 'Bodyweight',
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
  'Less': 'Less',
  'More': 'More',
  'Effort': 'Effort',
  'None': 'None',
}
// Built from an app word: "Last time: %@".
const COMPOSED = { 'Last time: %@': ['Last time', w => `${w}: %@`] }

// Only the watch says these. %@ is a name, %lld a number, as the Swift source interpolates them.
const OWN = {
  'No workout running': {
    de: 'Kein Training läuft', fr: 'Aucune séance en cours', es: 'Ningún entreno en curso', it: 'Nessun allenamento in corso',
    'pt-PT': 'Nenhum treino a decorrer', 'pt-BR': 'Nenhum treino em andamento', pl: 'Żaden trening nie trwa', hu: 'Nincs folyamatban edzés',
    tr: 'Devam eden antrenman yok', ru: 'Тренировка не идёт', uk: 'Тренування не триває', ar: 'لا يوجد تمرين جارٍ',
    hi: 'कोई वर्कआउट नहीं चल रहा', bn: 'কোনো ওয়ার্কআউট চলছে না', th: 'ไม่มีการฝึกที่กำลังทำอยู่', ko: '진행 중인 운동이 없어요',
    'zh-Hans': '没有进行中的训练', 'zh-Hant': '沒有進行中的訓練',
  },
  // The start screen before anything came from the phone (it sends only while openGym runs there).
  'Not synced yet': {
    de: 'Noch nicht synchronisiert', fr: 'Pas encore synchronisé', es: 'Aún sin sincronizar', it: 'Non ancora sincronizzato',
    'pt-PT': 'Ainda não sincronizado', 'pt-BR': 'Ainda não sincronizado', pl: 'Jeszcze nie zsynchronizowano', hu: 'Még nincs szinkronizálva',
    tr: 'Henüz eşitlenmedi', ru: 'Ещё не синхронизировано', uk: 'Ще не синхронізовано', ar: 'لم تتم المزامنة بعد',
    hi: 'अभी सिंक नहीं हुआ', bn: 'এখনো সিঙ্ক হয়নি', th: 'ยังไม่ได้ซิงค์', ko: '아직 동기화되지 않았어요',
    'zh-Hans': '尚未同步', 'zh-Hant': '尚未同步',
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
  },
  'All sets done': {
    de: 'Alle Sätze erledigt', fr: 'Toutes les séries faites', es: 'Todas las series hechas', it: 'Tutte le serie fatte',
    'pt-PT': 'Todas as séries feitas', 'pt-BR': 'Todas as séries feitas', pl: 'Wszystkie serie zrobione', hu: 'Minden sorozat kész',
    tr: 'Tüm setler tamam', ru: 'Все подходы сделаны', uk: 'Усі підходи зроблено', ar: 'اكتملت كل المجموعات',
    hi: 'सारे सेट पूरे', bn: 'সব সেট শেষ', th: 'ครบทุกเซ็ตแล้ว', ko: '모든 세트 완료', 'zh-Hans': '所有组已完成', 'zh-Hant': '所有組已完成',
  },
  'measuring': {
    de: 'misst …', fr: 'mesure …', es: 'midiendo …', it: 'misuro …', 'pt-PT': 'a medir …', 'pt-BR': 'medindo …', pl: 'mierzę …',
    hu: 'mérés …', tr: 'ölçülüyor …', ru: 'измеряю …', uk: 'вимірюю …', ar: 'جارٍ القياس …', hi: 'माप रहा है …', bn: 'মাপা হচ্ছে …',
    th: 'กำลังวัด …', ko: '측정 중 …', 'zh-Hans': '测量中 …', 'zh-Hant': '測量中 …',
  },
  'Next: %@, set %lld': {
    de: 'Als Nächstes: %@, Satz %lld', fr: 'Ensuite : %@, série %lld', es: 'Siguiente: %@, serie %lld', it: 'Poi: %@, serie %lld',
    'pt-PT': 'A seguir: %@, série %lld', 'pt-BR': 'A seguir: %@, série %lld', pl: 'Dalej: %@, seria %lld', hu: 'Következik: %@, %lld. sorozat',
    tr: 'Sıradaki: %@, set %lld', ru: 'Далее: %@, подход %lld', uk: 'Далі: %@, підхід %lld', ar: 'التالي: %@، المجموعة %lld',
    hi: 'अगला: %@, सेट %lld', bn: 'এরপর: %@, সেট %lld', th: 'ถัดไป: %@ เซ็ต %lld', ko: '다음: %@, %lld세트',
    'zh-Hans': '下一个：%@，第 %lld 组', 'zh-Hant': '下一個：%@，第 %lld 組',
  },
  '%@, set %lld': {
    de: '%@, Satz %lld', fr: '%@, série %lld', es: '%@, serie %lld', it: '%@, serie %lld', 'pt-PT': '%@, série %lld', 'pt-BR': '%@, série %lld',
    pl: '%@, seria %lld', hu: '%@, %lld. sorozat', tr: '%@, set %lld', ru: '%@, подход %lld', uk: '%@, підхід %lld', ar: '%@، المجموعة %lld',
    hi: '%@, सेट %lld', bn: '%@, সেট %lld', th: '%@ เซ็ต %lld', ko: '%@, %lld세트', 'zh-Hans': '%@，第 %lld 组', 'zh-Hant': '%@，第 %lld 組',
  },
  'Calories': {
    de: 'Kalorien', fr: 'Calories', es: 'Calorías', it: 'Calorie', 'pt-PT': 'Calorias', 'pt-BR': 'Calorias', pl: 'Kalorie', hu: 'Kalória', tr: 'Kalori', ru: 'Калории', uk: 'Калорії', ar: 'السعرات', hi: 'कैलोरी', bn: 'ক্যালোরি', th: 'แคลอรี', ko: '칼로리', 'zh-Hans': '卡路里', 'zh-Hant': '卡路里',
  },
  'Heart rate': {
    de: 'Puls', fr: 'Pouls', es: 'Pulso', it: 'Battito', 'pt-PT': 'Frequência cardíaca', 'pt-BR': 'Frequência cardíaca', pl: 'Tętno', hu: 'Pulzus', tr: 'Nabız', ru: 'Пульс', uk: 'Пульс', ar: 'النبض', hi: 'धड़कन', bn: 'হার্ট রেট', th: 'ชีพจร', ko: '심박수', 'zh-Hans': '心率', 'zh-Hant': '心率',
  },
  'Hold': {
    de: 'Halten', fr: 'Tenue', es: 'Aguanta', it: 'Tenuta', 'pt-PT': 'Aguenta', 'pt-BR': 'Segure', pl: 'Utrzymaj', hu: 'Tartás', tr: 'Tut', ru: 'Удержание', uk: 'Утримання', ar: 'ثبات', hi: 'होल्ड', bn: 'ধরে রাখুন', th: 'ค้างไว้', ko: '버티기', 'zh-Hans': '保持', 'zh-Hant': '保持',
  },
  'Stop': {
    de: 'Stopp', fr: 'Stop', es: 'Parar', it: 'Stop', 'pt-PT': 'Parar', 'pt-BR': 'Parar', pl: 'Stop', hu: 'Stop', tr: 'Durdur', ru: 'Стоп', uk: 'Стоп', ar: 'إيقاف', hi: 'रोकें', bn: 'থামুন', th: 'หยุด', ko: '정지', 'zh-Hans': '停止', 'zh-Hant': '停止',
  },
  'Start hold': {
    de: 'Halten starten', fr: 'Lancer la tenue', es: 'Empezar', it: 'Inizia la tenuta', 'pt-PT': 'Começar', 'pt-BR': 'Começar', pl: 'Start', hu: 'Indítás', tr: 'Başlat', ru: 'Начать', uk: 'Почати', ar: 'ابدأ', hi: 'शुरू करें', bn: 'শুরু করুন', th: 'เริ่ม', ko: '시작', 'zh-Hans': '开始', 'zh-Hant': '開始',
  },
  'Workout saved': {
    de: 'Training gespeichert', fr: 'Séance enregistrée', es: 'Entreno guardado', it: 'Allenamento salvato', 'pt-PT': 'Treino guardado', 'pt-BR': 'Treino salvo', pl: 'Trening zapisany', hu: 'Edzés mentve', tr: 'Antrenman kaydedildi', ru: 'Тренировка сохранена', uk: 'Тренування збережено', ar: 'تم حفظ التمرين', hi: 'वर्कआउट सहेजा गया', bn: 'ওয়ার্কআউট সেভ হয়েছে', th: 'บันทึกการฝึกแล้ว', ko: '운동 저장됨', 'zh-Hans': '训练已保存', 'zh-Hant': '訓練已儲存',
  },
  'Ended on your iPhone': {
    de: 'Am iPhone beendet', fr: 'Terminée sur ton iPhone', es: 'Terminado en tu iPhone', it: 'Finito sull’iPhone', 'pt-PT': 'Terminado no iPhone', 'pt-BR': 'Encerrado no iPhone', pl: 'Zakończono na iPhonie', hu: 'Az iPhone-on befejezve', tr: 'iPhone’da bitirildi', ru: 'Завершено на iPhone', uk: 'Завершено на iPhone', ar: 'انتهى على iPhone', hi: 'iPhone पर खत्म हुआ', bn: 'iPhone-এ শেষ হয়েছে', th: 'จบบน iPhone แล้ว', ko: 'iPhone에서 끝났어요', 'zh-Hans': '已在 iPhone 上结束', 'zh-Hant': '已在 iPhone 上結束',
  },
  'Tap a dot to do a skipped set.': {
    de: 'Tippe auf einen Punkt, um einen übersprungenen Satz zu machen.', fr: 'Touche un point pour faire une série sautée.', es: 'Toca un punto para hacer una serie saltada.', it: 'Tocca un punto per fare una serie saltata.', 'pt-PT': 'Toca num ponto para fazer uma série saltada.', 'pt-BR': 'Toque num ponto para fazer uma série pulada.', pl: 'Stuknij kropkę, by zrobić pominiętą serię.', hu: 'Koppints egy pöttyre egy kihagyott sorozathoz.', tr: 'Atlanan bir set için bir noktaya dokun.', ru: 'Нажмите на точку, чтобы сделать пропущенный подход.', uk: 'Торкнись точки, щоб зробити пропущений підхід.', ar: 'اضغط نقطة لأداء مجموعة متخطاة.', hi: 'छूटा सेट करने के लिए एक बिंदु टैप करें।', bn: 'বাদ দেওয়া সেট করতে একটি বিন্দুতে ট্যাপ করুন।', th: 'แตะจุดเพื่อทำเซ็ตที่ข้ามไป', ko: '건너뛴 세트를 하려면 점을 탭하세요.', 'zh-Hans': '轻点圆点来做跳过的组。', 'zh-Hant': '輕點圓點來做跳過的組。',
  },
  'Log this one on your iPhone.': {
    de: 'Das hier trägst du am iPhone ein.', fr: 'Celui-ci se note sur ton iPhone.', es: 'Este se registra en tu iPhone.', it: 'Questo si registra sull’iPhone.', 'pt-PT': 'Este regista-se no iPhone.', 'pt-BR': 'Este você registra no iPhone.', pl: 'To zapisz na iPhonie.', hu: 'Ezt az iPhone-on rögzítsd.', tr: 'Bunu iPhone’da kaydet.', ru: 'Это записывается на iPhone.', uk: 'Це записуй на iPhone.', ar: 'سجّل هذا على iPhone.', hi: 'इसे iPhone पर दर्ज करें।', bn: 'এটা iPhone-এ লিখুন।', th: 'อันนี้บันทึกบน iPhone', ko: '이건 iPhone에서 기록하세요.', 'zh-Hans': '这个请在 iPhone 上记录。', 'zh-Hant': '這個請在 iPhone 上記錄。',
  },
  'Saved on the watch, syncs later': {
    de: 'Auf der Watch gespeichert, synct später', fr: 'Gardé sur la montre, synchro plus tard', es: 'Guardado en el reloj, se sincroniza luego', it: 'Salvato sull’orologio, si sincronizza dopo', 'pt-PT': 'Guardado no relógio, sincroniza depois', 'pt-BR': 'Salvo no relógio, sincroniza depois', pl: 'Zapisano na zegarku, zsynchronizuje się później', hu: 'Az órán mentve, később szinkronizál', tr: 'Saatte kaydedildi, sonra eşitlenir', ru: 'Сохранено на часах, синхронизируется позже', uk: 'Збережено на годиннику, синхронізується пізніше', ar: 'حُفظ على الساعة، تتم المزامنة لاحقًا', hi: 'वॉच पर सहेजा, बाद में सिंक होगा', bn: 'ঘড়িতে সেভ হয়েছে, পরে সিঙ্ক হবে', th: 'บันทึกบนนาฬิกาแล้ว จะซิงค์ทีหลัง', ko: '워치에 저장됨, 나중에 동기화돼요', 'zh-Hans': '已存在手表上，稍后同步', 'zh-Hant': '已存在手錶上，稍後同步',
  },
  'All done?': {
    de: 'Alles erledigt?', fr: 'Terminé ?', es: '¿Has terminado?', it: 'Hai finito?', 'pt-PT': 'Terminaste?', 'pt-BR': 'Terminou?', pl: 'Koniec treningu?', hu: 'Végeztél?', tr: 'Bitirdin mi?', ru: 'Тренировка окончена?', uk: 'Тренування завершено?', ar: 'هل انتهيت؟', hi: 'हो गया?', bn: 'শেষ হয়েছে?', th: 'เสร็จแล้วหรือยัง', ko: '다 끝났나요?', 'zh-Hans': '练完了吗？', 'zh-Hant': '練完了嗎？',
  },
  // Water Lock (the screen and the crown's press off until the crown is turned), as in Apple's Workout.
  'Lock': {
    de: 'Sperren', fr: 'Verrouiller', es: 'Bloquear', it: 'Blocca', 'pt-PT': 'Bloquear', 'pt-BR': 'Bloquear', pl: 'Zablokuj', hu: 'Zárolás', tr: 'Kilitle', ru: 'Блокировка', uk: 'Блокування', ar: 'قفل', hi: 'लॉक करें', bn: 'লক করুন', th: 'ล็อก', ko: '잠금', 'zh-Hans': '锁定', 'zh-Hant': '鎖定',
  },
  'Skip this set?': {
    de: 'Diesen Satz überspringen?', fr: 'Sauter cette série ?', es: '¿Saltar esta serie?', it: 'Saltare questa serie?', 'pt-PT': 'Saltar esta série?', 'pt-BR': 'Pular esta série?', pl: 'Pominąć tę serię?', hu: 'Kihagyod ezt a sorozatot?', tr: 'Bu set atlansın mı?', ru: 'Пропустить этот подход?', uk: 'Пропустити цей підхід?', ar: 'تخطي هذه المجموعة؟', hi: 'यह सेट छोड़ें?', bn: 'এই সেটটি বাদ দেবেন?', th: 'ข้ามเซ็ตนี้ไหม', ko: '이 세트를 건너뛸까요?', 'zh-Hans': '跳过这一组？', 'zh-Hant': '跳過這一組？',
  },
  'Turn the Digital Crown to change it.': {
    de: 'Dreh an der Digital Crown, um es zu ändern.', fr: 'Tourne la Digital Crown pour le changer.', es: 'Gira la Digital Crown para cambiarlo.', it: 'Ruota la Digital Crown per cambiarlo.', 'pt-PT': 'Roda a Digital Crown para mudar.', 'pt-BR': 'Gire a Digital Crown para mudar.', pl: 'Obróć Digital Crown, by zmienić.', hu: 'Forgasd a Digital Crownt a módosításhoz.', tr: 'Değiştirmek için Digital Crown’u çevir.', ru: 'Поверните Digital Crown, чтобы изменить.', uk: 'Поверни Digital Crown, щоб змінити.', ar: 'أدر Digital Crown للتغيير.', hi: 'बदलने के लिए Digital Crown घुमाएँ।', bn: 'বদলাতে Digital Crown ঘোরান।', th: 'หมุน Digital Crown เพื่อเปลี่ยน', ko: '바꾸려면 Digital Crown을 돌리세요.', 'zh-Hans': '转动数码表冠来更改。', 'zh-Hant': '轉動數位錶冠來更改。',
  },
  '%lld done': {
    de: '%lld erledigt', fr: '%lld faites', es: '%lld hechas', it: '%lld fatte', 'pt-PT': '%lld feitas', 'pt-BR': '%lld feitas', pl: '%lld zrobione', hu: '%lld kész', tr: '%lld tamam', ru: '%lld сделано', uk: '%lld зроблено', ar: '%lld مكتملة', hi: '%lld पूरे', bn: '%lldটি শেষ', th: 'เสร็จ %lld', ko: '%lld개 완료', 'zh-Hans': '已完成 %lld', 'zh-Hant': '已完成 %lld',
  },
  '%lld avg · %lld max': {
    de: 'Ø %lld · max. %lld', fr: 'moy. %lld · max %lld', es: 'media %lld · máx. %lld', it: 'media %lld · max %lld', 'pt-PT': 'média %lld · máx. %lld', 'pt-BR': 'média %lld · máx. %lld', pl: 'śr. %lld · maks. %lld', hu: 'átl. %lld · max. %lld', tr: 'ort. %lld · maks. %lld', ru: 'ср. %lld · макс. %lld', uk: 'сер. %lld · макс. %lld', ar: 'متوسط %lld · أقصى %lld', hi: 'औसत %lld · अधिकतम %lld', bn: 'গড় %lld · সর্বোচ্চ %lld', th: 'เฉลี่ย %lld · สูงสุด %lld', ko: '평균 %lld · 최대 %lld', 'zh-Hans': '平均 %lld · 最高 %lld', 'zh-Hant': '平均 %lld · 最高 %lld',
  },
  'Set %lld of %lld': {
    de: 'Satz %lld von %lld', fr: 'Série %lld sur %lld', es: 'Serie %lld de %lld', it: 'Serie %lld di %lld', 'pt-PT': 'Série %lld de %lld', 'pt-BR': 'Série %lld de %lld', pl: 'Seria %lld z %lld', hu: '%lld. sorozat / %lld', tr: 'Set %lld / %lld', ru: 'Подход %lld из %lld', uk: 'Підхід %lld з %lld', ar: 'المجموعة %lld من %lld', hi: 'सेट %lld / %lld', bn: 'সেট %lld / %lld', th: 'เซ็ต %lld จาก %lld', ko: '%lld/%lld세트', 'zh-Hans': '第 %lld 组，共 %lld 组', 'zh-Hant': '第 %lld 組，共 %lld 組',
  },
  '%lld of %lld sets': {
    de: '%lld von %lld Sätzen', fr: '%lld séries sur %lld', es: '%lld de %lld series', it: '%lld serie su %lld', 'pt-PT': '%lld de %lld séries', 'pt-BR': '%lld de %lld séries', pl: '%lld z %lld serii', hu: '%lld / %lld sorozat', tr: '%lld / %lld set', ru: '%lld из %lld подходов', uk: '%lld з %lld підходів', ar: '%lld من %lld مجموعات', hi: '%lld / %lld सेट', bn: '%lld / %lld সেট', th: '%lld จาก %lld เซ็ต', ko: '%lld/%lld세트', 'zh-Hans': '%lld / %lld 组', 'zh-Hant': '%lld / %lld 組',
  },
  'Tap to change it.': {
    de: 'Tippe, um es zu ändern.', fr: 'Touche pour le changer.', es: 'Toca para cambiarlo.', it: 'Tocca per cambiarlo.', 'pt-PT': 'Toca para mudar.', 'pt-BR': 'Toque para mudar.', pl: 'Stuknij, by zmienić.', hu: 'Koppints a módosításhoz.', tr: 'Değiştirmek için dokun.', ru: 'Нажмите, чтобы изменить.', uk: 'Торкнись, щоб змінити.', ar: 'اضغط للتغيير.', hi: 'बदलने के लिए टैप करें।', bn: 'বদলাতে ট্যাপ করুন।', th: 'แตะเพื่อเปลี่ยน', ko: '탭해서 바꾸세요.', 'zh-Hans': '轻点以更改。', 'zh-Hant': '輕點以更改。',
  },
  'Added weight': {
    de: 'Zusatzgewicht', fr: 'Poids ajouté', es: 'Peso añadido', it: 'Peso aggiunto', 'pt-PT': 'Peso adicional', 'pt-BR': 'Peso adicional', pl: 'Dodatkowy ciężar', hu: 'Plusz súly', tr: 'Ek ağırlık', ru: 'Доп. вес', uk: 'Додаткова вага', ar: 'وزن إضافي', hi: 'अतिरिक्त वज़न', bn: 'অতিরিক্ত ওজন', th: 'น้ำหนักเพิ่ม', ko: '추가 무게', 'zh-Hans': '附加重量', 'zh-Hant': '附加重量',
  },
  'Your rest, your next set, or today\'s workout.': {
    de: 'Deine Pause, dein nächster Satz oder das Training von heute.', fr: 'Ton repos, ta prochaine série ou la séance du jour.', es: 'Tu descanso, tu próxima serie o el entreno de hoy.', it: 'Il tuo recupero, la prossima serie o l’allenamento di oggi.', 'pt-PT': 'O teu descanso, a próxima série ou o treino de hoje.', 'pt-BR': 'Seu descanso, a próxima série ou o treino de hoje.', pl: 'Twoja przerwa, następna seria albo dzisiejszy trening.', hu: 'A pihenőd, a következő sorozat vagy a mai edzés.', tr: 'Dinlenmen, sıradaki setin ya da bugünkü antrenman.', ru: 'Отдых, следующий подход или сегодняшняя тренировка.', uk: 'Відпочинок, наступний підхід або сьогоднішнє тренування.', ar: 'راحتك، أو مجموعتك التالية، أو تمرين اليوم.', hi: 'आपका आराम, अगला सेट, या आज का वर्कआउट।', bn: 'আপনার বিশ্রাম, পরের সেট, বা আজকের ওয়ার্কআউট।', th: 'ช่วงพัก เซ็ตถัดไป หรือการฝึกวันนี้', ko: '휴식, 다음 세트, 또는 오늘의 운동.', 'zh-Hans': '你的休息、下一组或今天的训练。', 'zh-Hant': '你的休息、下一組或今天的訓練。',
  },
  'Opens openGym.': {
    de: 'Öffnet openGym.', fr: 'Ouvre openGym.', es: 'Abre openGym.', it: 'Apre openGym.', 'pt-PT': 'Abre o openGym.', 'pt-BR': 'Abre o openGym.', pl: 'Otwiera openGym.', hu: 'Megnyitja az openGymet.', tr: 'openGym’i açar.', ru: 'Открывает openGym.', uk: 'Відкриває openGym.', ar: 'يفتح openGym.', hi: 'openGym खोलता है।', bn: 'openGym খোলে।', th: 'เปิด openGym', ko: 'openGym을 열어요.', 'zh-Hans': '打开 openGym。', 'zh-Hant': '打開 openGym。',
  },
}

// Info.plist's own (the Apple Health permission prompts), into InfoPlist.strings.
const PLIST = {
  NSHealthShareUsageDescription: {
    de: 'openGym zeigt deinen Puls während des Trainings und neben jedem Satz.', fr: 'openGym affiche ton pouls pendant la séance et à côté de chaque série.',
    es: 'openGym muestra tu pulso durante el entreno y junto a cada serie.', it: 'openGym mostra il tuo battito durante l’allenamento e accanto a ogni serie.',
    'pt-PT': 'O openGym mostra a tua frequência cardíaca durante o treino e ao lado de cada série.', 'pt-BR': 'O openGym mostra sua frequência cardíaca durante o treino e ao lado de cada série.',
    pl: 'openGym pokazuje tętno podczas treningu i przy każdej serii.', hu: 'Az openGym edzés közben és minden sorozat mellett mutatja a pulzusodat.',
    tr: 'openGym antrenman sırasında ve her setin yanında nabzını gösterir.', ru: 'openGym показывает пульс во время тренировки и рядом с каждым подходом.',
    uk: 'openGym показує пульс під час тренування і біля кожного підходу.', ar: 'يعرض openGym نبضك أثناء التمرين وبجانب كل مجموعة.',
    hi: 'openGym वर्कआउट के दौरान और हर सेट के साथ आपकी धड़कन दिखाता है।', bn: 'openGym ওয়ার্কআউটের সময় আর প্রতিটি সেটের পাশে আপনার হার্ট রেট দেখায়।',
    th: 'openGym แสดงอัตราการเต้นของหัวใจระหว่างฝึกและข้างแต่ละเซ็ต', ko: 'openGym이 운동 중과 각 세트 옆에 심박수를 보여줘요.',
    'zh-Hans': 'openGym 会在训练中和每组旁显示你的心率。', 'zh-Hant': 'openGym 會在訓練中和每組旁顯示你的心率。',
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
  },
}

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
  for (const [k, [appKey, f]] of Object.entries(COMPOSED)) put(k, dict[appKey] && f(dict[appKey]))
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
  for (const k of keys) lines.push(`"${esc(k)}" = "${esc(k)}";`)
  for (const dir of [out, widgets]) {
    mkdirSync(join(dir, 'en.lproj'), { recursive: true })
    writeFileSync(join(dir, 'en.lproj', 'Localizable.strings'), lines.join('\n') + '\n')
  }
}
if (problems) process.exit(1)
console.log(`wrote ${Object.keys(LANGS).length} languages`)
