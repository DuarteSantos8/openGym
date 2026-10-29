#!/usr/bin/env node
// Writes what Siri and the launcher shortcuts say in every language the app speaks (v1.4.4,
// ios/App/App/VoiceIntents.swift, android res/xml/shortcuts.xml):
//
//   ios/App/App/<lang>.lproj/AppShortcuts.strings   the Siri phrases (each keeps ${applicationName})
//   ios/App/App/<lang>.lproj/Localizable.strings    the intents' names and Siri's answers
//   android/app/src/main/res/values-<x>/voice_strings.xml   the long-press shortcuts' labels
//
// The page shows the same phrases in Settings → Siri & Shortcuts (components/VoiceShortcuts.jsx,
// in src/locales; lib/voice-strings.test.js keeps the two in step). Run it after changing a
// phrase below, and commit what it writes:
//
//   node frontend/ios/ci/voice-strings.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const IOS_OUT = join(here, '..', 'App', 'App')
const ANDROID_RES = join(here, '..', '..', 'android', 'app', 'src', 'main', 'res')

export const LPROJ = ['de', 'fr', 'es', 'it', 'pt-PT', 'pt-BR', 'pl', 'hu', 'tr', 'ru', 'uk', 'ar', 'hi', 'bn', 'th', 'ko', 'zh-Hans', 'zh-Hant', 'sv']
// The page's locale (src/locales/<x>.js) for each .lproj.
export const PAGE_LOCALE = { 'pt-PT': 'pt', 'zh-Hans': 'zh', 'zh-Hant': 'zh-TW' }
// Android's resource folder for each .lproj.
const ANDROID_DIR = { 'pt-PT': 'values-pt', 'pt-BR': 'values-pt-rBR', 'zh-Hans': 'values-zh-rCN', 'zh-Hant': 'values-zh-rTW' }

// The Siri phrases: VoiceIntents.swift's, with {app} for ${applicationName}.
export const PHRASES = {
  'Start my workout in {app}': {
    de: 'Starte mein Training in {app}', fr: 'Lance ma séance dans {app}', es: 'Empieza mi entreno en {app}',
    it: 'Avvia il mio allenamento in {app}', 'pt-PT': 'Começa o meu treino no {app}', 'pt-BR': 'Começar meu treino no {app}',
    pl: 'Rozpocznij mój trening w {app}', hu: 'Indítsd az edzésem az {app} appban', tr: '{app} ile antrenmanımı başlat',
    ru: 'Начни мою тренировку в {app}', uk: 'Почни моє тренування в {app}', ar: 'ابدأ تمريني في {app}',
    hi: '{app} में मेरा वर्कआउट शुरू करो', bn: '{app}-এ আমার ওয়ার্কআউট শুরু করো', th: 'เริ่มการฝึกของฉันใน {app}',
    ko: '{app}에서 운동 시작해 줘', 'zh-Hans': '在 {app} 中开始我的训练', 'zh-Hant': '在 {app} 中開始我的訓練', sv: 'Starta mitt träningspass i {app}',
  },
  'Start a workout with {app}': {
    de: 'Training starten mit {app}', fr: 'Commence une séance avec {app}', es: 'Empieza un entreno con {app}',
    it: 'Inizia un allenamento con {app}', 'pt-PT': 'Inicia um treino com o {app}', 'pt-BR': 'Iniciar um treino com o {app}',
    pl: 'Zacznij trening z {app}', hu: 'Edzés kezdése az {app} appal', tr: '{app} ile antrenman başlat',
    ru: 'Начать тренировку в {app}', uk: 'Почати тренування в {app}', ar: 'ابدأ تمرينًا مع {app}',
    hi: '{app} के साथ वर्कआउट शुरू करो', bn: '{app} দিয়ে ওয়ার্কআউট শুরু করো', th: 'เริ่มฝึกด้วย {app}',
    ko: '{app}로 운동 시작', 'zh-Hans': '用 {app} 开始训练', 'zh-Hant': '用 {app} 開始訓練', sv: 'Börja träna med {app}',
  },
  'Log my weight in {app}': {
    de: 'Trag mein Gewicht in {app} ein', fr: 'Note mon poids dans {app}', es: 'Registra mi peso en {app}',
    it: 'Registra il mio peso in {app}', 'pt-PT': 'Regista o meu peso no {app}', 'pt-BR': 'Registrar meu peso no {app}',
    pl: 'Zapisz moją wagę w {app}', hu: 'Rögzítsd a súlyom az {app} appban', tr: '{app} uygulamasına kilomu kaydet',
    ru: 'Запиши мой вес в {app}', uk: 'Запиши мою вагу в {app}', ar: 'سجّل وزني في {app}',
    hi: '{app} में मेरा वज़न दर्ज करो', bn: '{app}-এ আমার ওজন লিখে রাখো', th: 'บันทึกน้ำหนักของฉันใน {app}',
    ko: '{app}에 내 체중 기록해 줘', 'zh-Hans': '在 {app} 中记录我的体重', 'zh-Hant': '在 {app} 中記錄我的體重', sv: 'Logga min vikt i {app}',
  },
  'Log a weigh-in in {app}': {
    de: 'Gewicht eintragen in {app}', fr: 'Ajoute une pesée dans {app}', es: 'Apunta mi peso en {app}',
    it: 'Aggiungi una pesata in {app}', 'pt-PT': 'Adiciona uma pesagem no {app}', 'pt-BR': 'Adicionar uma pesagem no {app}',
    pl: 'Dodaj ważenie w {app}', hu: 'Új mérés az {app} appban', tr: '{app} uygulamasına tartı ekle',
    ru: 'Добавь взвешивание в {app}', uk: 'Додай зважування в {app}', ar: 'أضف وزنًا جديدًا في {app}',
    hi: '{app} में वज़न जोड़ो', bn: '{app}-এ ওজন যোগ করো', th: 'เพิ่มการชั่งน้ำหนักใน {app}',
    ko: '{app}에 체중 추가', 'zh-Hans': '在 {app} 中添加一次称重', 'zh-Hant': '在 {app} 中新增一次量體重', sv: 'Lägg till en vägning i {app}',
  },
  "What's my workout today in {app}": {
    de: 'Was ist mein Training heute in {app}', fr: 'Quelle est ma séance du jour dans {app}', es: 'Cuál es mi entreno de hoy en {app}',
    it: 'Qual è il mio allenamento di oggi in {app}', 'pt-PT': 'Qual é o meu treino de hoje no {app}', 'pt-BR': 'Qual é meu treino de hoje no {app}',
    pl: 'Jaki mam dziś trening w {app}', hu: 'Mi a mai edzésem az {app} appban', tr: '{app} bugünkü antrenmanım ne',
    ru: 'Какая у меня сегодня тренировка в {app}', uk: 'Яке в мене сьогодні тренування в {app}', ar: 'ما تمريني اليوم في {app}',
    hi: '{app} में आज मेरा वर्कआउट क्या है', bn: '{app}-এ আজ আমার ওয়ার্কআউট কী', th: 'วันนี้ฉันฝึกอะไรใน {app}',
    ko: '{app}에서 오늘 운동 뭐야', 'zh-Hans': '{app} 里我今天练什么', 'zh-Hant': '{app} 裡我今天練什麼', sv: 'Vad är mitt pass i dag i {app}',
  },
  "What's planned today in {app}": {
    de: 'Was steht heute an in {app}', fr: 'Quel est le programme du jour dans {app}', es: 'Qué toca hoy en {app}',
    it: 'Che cosa ho in programma oggi in {app}', 'pt-PT': 'O que está planeado para hoje no {app}', 'pt-BR': 'O que está planejado para hoje no {app}',
    pl: 'Co mam dziś w planie w {app}', hu: 'Mi van ma tervben az {app} appban', tr: '{app} bugün ne planlı',
    ru: 'Что запланировано на сегодня в {app}', uk: 'Що заплановано на сьогодні в {app}', ar: 'ما المخطط لليوم في {app}',
    hi: '{app} में आज क्या प्लान है', bn: '{app}-এ আজ কী প্ল্যান আছে', th: 'วันนี้มีแผนอะไรใน {app}',
    ko: '{app}에서 오늘 계획 알려 줘', 'zh-Hans': '{app} 里今天有什么计划', 'zh-Hant': '{app} 裡今天有什麼計畫', sv: 'Vad är planerat i dag i {app}',
  },
  "How's my streak in {app}": {
    de: 'Wie steht meine Serie in {app}', fr: 'Où en est ma série dans {app}', es: 'Cómo va mi racha en {app}',
    it: 'Come va la mia serie in {app}', 'pt-PT': 'Como está a minha sequência no {app}', 'pt-BR': 'Como está minha sequência no {app}',
    pl: 'Jak idzie moja seria w {app}', hu: 'Hogy áll a sorozatom az {app} appban', tr: '{app} serim nasıl gidiyor',
    ru: 'Как моя серия в {app}', uk: 'Як моя серія в {app}', ar: 'كيف سلسلتي في {app}',
    hi: '{app} में मेरी स्ट्रीक कैसी है', bn: '{app}-এ আমার স্ট্রিক কেমন চলছে', th: 'สถิติต่อเนื่องของฉันใน {app} เป็นอย่างไร',
    ko: '{app}에서 내 연속 기록 어때', 'zh-Hans': '我在 {app} 的连续纪录怎么样', 'zh-Hant': '我在 {app} 的連續紀錄怎麼樣', sv: 'Hur går min svit i {app}',
  },
  "What's my {app} streak": {
    de: 'Wie lang ist meine {app} Serie', fr: 'Quelle est ma série {app}', es: 'Cuál es mi racha de {app}',
    it: 'Qual è la mia serie su {app}', 'pt-PT': 'Qual é a minha sequência do {app}', 'pt-BR': 'Qual é minha sequência do {app}',
    pl: 'Jaka jest moja seria w {app}', hu: 'Mekkora az {app} sorozatom', tr: '{app} serim kaç hafta',
    ru: 'Какая у меня серия в {app}', uk: 'Яка в мене серія в {app}', ar: 'ما طول سلسلتي في {app}',
    hi: 'मेरी {app} स्ट्रीक कितनी है', bn: 'আমার {app} স্ট্রিক কত', th: 'สถิติ {app} ของฉันเท่าไร',
    ko: '내 {app} 연속 기록 몇 주야', 'zh-Hans': '我的 {app} 连续纪录是多少', 'zh-Hant': '我的 {app} 連續紀錄是多少', sv: 'Hur lång är min {app}-svit',
  },
}

// The intents' names and Siri's answers: VoiceIntents.swift's keys (%@ and %d stay as they are).
export const STRINGS = {
  'Start workout': {
    de: 'Training starten', fr: 'Lancer la séance', es: 'Empezar entreno', it: 'Inizia allenamento', 'pt-PT': 'Iniciar treino', 'pt-BR': 'Iniciar treino',
    pl: 'Rozpocznij trening', hu: 'Edzés indítása', tr: 'Antrenmanı başlat', ru: 'Начать тренировку', uk: 'Почати тренування', ar: 'ابدأ التمرين',
    hi: 'वर्कआउट शुरू करें', bn: 'ওয়ার্কআউট শুরু করুন', th: 'เริ่มการฝึก', ko: '운동 시작', 'zh-Hans': '开始训练', 'zh-Hant': '開始訓練', sv: 'Starta passet',
  },
  'Starts today’s planned workout, or opens the one already running.': {
    de: 'Startet das heute geplante Training oder öffnet das laufende.', fr: 'Lance la séance prévue aujourd’hui, ou ouvre celle en cours.',
    es: 'Empieza el entreno previsto para hoy o abre el que ya está en marcha.', it: 'Avvia l’allenamento di oggi, o apre quello già in corso.',
    'pt-PT': 'Inicia o treino planeado para hoje, ou abre o que já está a decorrer.', 'pt-BR': 'Inicia o treino planejado para hoje, ou abre o que já está em andamento.',
    pl: 'Rozpoczyna dzisiejszy trening z planu albo otwiera ten, który już trwa.', hu: 'Elindítja a mai tervezett edzést, vagy megnyitja a már futót.',
    tr: 'Bugün planlanan antrenmanı başlatır ya da süren antrenmanı açar.', ru: 'Начинает тренировку на сегодня или открывает уже идущую.',
    uk: 'Починає тренування на сьогодні або відкриває те, що вже триває.', ar: 'يبدأ تمرين اليوم المخطط، أو يفتح التمرين الجاري.',
    hi: 'आज का प्लान किया वर्कआउट शुरू करता है, या चल रहा वर्कआउट खोलता है।', bn: 'আজকের প্ল্যান করা ওয়ার্কআউট শুরু করে, বা চলতি ওয়ার্কআউট খোলে।',
    th: 'เริ่มการฝึกที่วางแผนไว้วันนี้ หรือเปิดการฝึกที่กำลังทำอยู่', ko: '오늘 계획된 운동을 시작하거나 진행 중인 운동을 엽니다.',
    'zh-Hans': '开始今天计划的训练，或打开正在进行的训练。', 'zh-Hant': '開始今天計畫的訓練，或打開正在進行的訓練。',
    sv: 'Startar dagens planerade pass, eller öppnar det som redan pågår.',
  },
  'Log weight': {
    de: 'Gewicht eintragen', fr: 'Noter le poids', es: 'Registrar peso', it: 'Registra peso', 'pt-PT': 'Registar peso', 'pt-BR': 'Registrar peso',
    pl: 'Zapisz wagę', hu: 'Súly rögzítése', tr: 'Kilo kaydet', ru: 'Записать вес', uk: 'Записати вагу', ar: 'سجّل الوزن',
    hi: 'वज़न दर्ज करें', bn: 'ওজন লিখুন', th: 'บันทึกน้ำหนัก', ko: '체중 기록', 'zh-Hans': '记录体重', 'zh-Hant': '記錄體重', sv: 'Logga vikt',
  },
  'Logs your body weight without opening openGym.': {
    de: 'Trägt dein Körpergewicht ein, ohne openGym zu öffnen.', fr: 'Note ton poids sans ouvrir openGym.', es: 'Registra tu peso sin abrir openGym.',
    it: 'Registra il tuo peso senza aprire openGym.', 'pt-PT': 'Regista o teu peso sem abrir o openGym.', 'pt-BR': 'Registra seu peso sem abrir o openGym.',
    pl: 'Zapisuje twoją wagę bez otwierania openGym.', hu: 'Rögzíti a testsúlyod az openGym megnyitása nélkül.', tr: 'openGym’i açmadan kilonu kaydeder.',
    ru: 'Записывает ваш вес, не открывая openGym.', uk: 'Записує твою вагу, не відкриваючи openGym.', ar: 'يسجّل وزنك دون فتح openGym.',
    hi: 'openGym खोले बिना आपका वज़न दर्ज करता है।', bn: 'openGym না খুলেই আপনার ওজন লিখে রাখে।', th: 'บันทึกน้ำหนักตัวโดยไม่ต้องเปิด openGym',
    ko: 'openGym을 열지 않고 체중을 기록합니다.', 'zh-Hans': '不打开 openGym 就记录你的体重。', 'zh-Hant': '不打開 openGym 就記錄你的體重。',
    sv: 'Loggar din kroppsvikt utan att öppna openGym.',
  },
  'Weight': {
    de: 'Gewicht', fr: 'Poids', es: 'Peso', it: 'Peso', 'pt-PT': 'Peso', 'pt-BR': 'Peso', pl: 'Waga', hu: 'Súly', tr: 'Kilo', ru: 'Вес', uk: 'Вага',
    ar: 'الوزن', hi: 'वज़न', bn: 'ওজন', th: 'น้ำหนัก', ko: '체중', 'zh-Hans': '体重', 'zh-Hant': '體重', sv: 'Vikt',
  },
  'What’s your weight?': {
    de: 'Wie viel wiegst du?', fr: 'Tu pèses combien ?', es: '¿Cuánto pesas?', it: 'Quanto pesi?', 'pt-PT': 'Quanto pesas?', 'pt-BR': 'Quanto você pesa?',
    pl: 'Ile ważysz?', hu: 'Mennyi a súlyod?', tr: 'Kaç kilosun?', ru: 'Сколько вы весите?', uk: 'Скільки ти важиш?', ar: 'كم وزنك؟',
    hi: 'आपका वज़न कितना है?', bn: 'আপনার ওজন কত?', th: 'คุณหนักเท่าไร', ko: '체중이 얼마예요?', 'zh-Hans': '你的体重是多少？', 'zh-Hant': '你的體重是多少？', sv: 'Hur mycket väger du?',
  },
  'Today’s workout': {
    de: 'Heutiges Training', fr: 'Séance du jour', es: 'Entreno de hoy', it: 'Allenamento di oggi', 'pt-PT': 'Treino de hoje', 'pt-BR': 'Treino de hoje',
    pl: 'Dzisiejszy trening', hu: 'Mai edzés', tr: 'Bugünün antrenmanı', ru: 'Тренировка на сегодня', uk: 'Тренування на сьогодні', ar: 'تمرين اليوم',
    hi: 'आज का वर्कआउट', bn: 'আজকের ওয়ার্কআউট', th: 'การฝึกวันนี้', ko: '오늘의 운동', 'zh-Hans': '今日训练', 'zh-Hant': '今日訓練', sv: 'Dagens pass',
  },
  'Tells you what’s planned for today.': {
    de: 'Sagt dir, was heute ansteht.', fr: 'Te dit ce qui est prévu aujourd’hui.', es: 'Te dice qué toca hoy.', it: 'Ti dice cosa c’è in programma oggi.',
    'pt-PT': 'Diz-te o que está planeado para hoje.', 'pt-BR': 'Diz o que está planejado para hoje.', pl: 'Mówi, co masz dziś w planie.',
    hu: 'Megmondja, mi van ma tervben.', tr: 'Bugün ne planlandığını söyler.', ru: 'Говорит, что запланировано на сегодня.',
    uk: 'Каже, що заплановано на сьогодні.', ar: 'يخبرك بما هو مخطط لليوم.', hi: 'बताता है कि आज क्या प्लान है।', bn: 'আজ কী প্ল্যান আছে তা জানায়।',
    th: 'บอกว่าวันนี้มีแผนอะไร', ko: '오늘 계획을 알려 줍니다.', 'zh-Hans': '告诉你今天的计划。', 'zh-Hant': '告訴你今天的計畫。', sv: 'Berättar vad som är planerat i dag.',
  },
  'Week streak': {
    de: 'Wochen-Serie', fr: 'Série de semaines', es: 'Racha semanal', it: 'Serie settimanale', 'pt-PT': 'Sequência semanal', 'pt-BR': 'Sequência semanal',
    pl: 'Seria tygodni', hu: 'Heti sorozat', tr: 'Haftalık seri', ru: 'Серия недель', uk: 'Серія тижнів', ar: 'سلسلة الأسابيع',
    hi: 'हफ़्तों की स्ट्रीक', bn: 'সপ্তাহের স্ট্রিক', th: 'สัปดาห์ต่อเนื่อง', ko: '주간 연속 기록', 'zh-Hans': '每周连续纪录', 'zh-Hant': '每週連續紀錄', sv: 'Veckosvit',
  },
  'Tells you how many weeks in a row you trained.': {
    de: 'Sagt dir, wie viele Wochen in Folge du trainiert hast.', fr: 'Te dit combien de semaines d’affilée tu t’es entraîné.',
    es: 'Te dice cuántas semanas seguidas has entrenado.', it: 'Ti dice quante settimane di fila ti sei allenato.',
    'pt-PT': 'Diz-te quantas semanas seguidas treinaste.', 'pt-BR': 'Diz quantas semanas seguidas você treinou.',
    pl: 'Mówi, ile tygodni z rzędu trenujesz.', hu: 'Megmondja, hány egymást követő héten edzettél.', tr: 'Kaç haftadır aralıksız antrenman yaptığını söyler.',
    ru: 'Говорит, сколько недель подряд вы тренировались.', uk: 'Каже, скільки тижнів поспіль ти тренувався.', ar: 'يخبرك بعدد الأسابيع المتتالية التي تمرنت فيها.',
    hi: 'बताता है कि आपने लगातार कितने हफ़्ते ट्रेनिंग की।', bn: 'টানা কত সপ্তাহ ট্রেনিং করেছেন তা জানায়।', th: 'บอกว่าคุณฝึกติดต่อกันมากี่สัปดาห์',
    ko: '몇 주 연속으로 운동했는지 알려 줍니다.', 'zh-Hans': '告诉你连续训练了几周。', 'zh-Hant': '告訴你連續訓練了幾週。', sv: 'Berättar hur många veckor i rad du har tränat.',
  },
  'Open openGym once, then ask me again.': {
    de: 'Öffne openGym einmal, dann frag mich noch mal.', fr: 'Ouvre openGym une fois, puis redemande-moi.', es: 'Abre openGym una vez y vuelve a preguntarme.',
    it: 'Apri openGym una volta, poi chiedimelo di nuovo.', 'pt-PT': 'Abre o openGym uma vez e pergunta-me outra vez.', 'pt-BR': 'Abra o openGym uma vez e me pergunte de novo.',
    pl: 'Otwórz openGym raz, a potem zapytaj mnie jeszcze raz.', hu: 'Nyisd meg egyszer az openGymet, aztán kérdezz újra.', tr: 'openGym’i bir kez aç, sonra bana yine sor.',
    ru: 'Откройте openGym один раз, а потом спросите снова.', uk: 'Відкрий openGym один раз, а тоді спитай знову.', ar: 'افتح openGym مرة واحدة، ثم اسألني من جديد.',
    hi: 'openGym एक बार खोलें, फिर मुझसे दोबारा पूछें।', bn: 'openGym একবার খুলুন, তারপর আবার জিজ্ঞেস করুন।', th: 'เปิด openGym สักครั้ง แล้วถามฉันอีกครั้ง',
    ko: 'openGym을 한 번 연 다음 다시 물어봐 주세요.', 'zh-Hans': '先打开一次 openGym，再来问我。', 'zh-Hant': '先打開一次 openGym，再來問我。', sv: 'Öppna openGym en gång och fråga mig sedan igen.',
  },
  'You’re in the middle of %@.': {
    de: 'Du bist mitten in %@.', fr: 'Tu es en plein %@.', es: 'Estás en mitad de %@.', it: 'Sei nel mezzo di %@.', 'pt-PT': 'Estás a meio de %@.', 'pt-BR': 'Você está no meio de %@.',
    pl: 'Jesteś w trakcie: %@.', hu: 'Épp ezt csinálod: %@.', tr: 'Şu an %@ yapıyorsun.', ru: 'Вы сейчас на тренировке: %@.', uk: 'Ти зараз на тренуванні: %@.', ar: 'أنت الآن في منتصف %@.',
    hi: 'आप अभी %@ के बीच में हैं।', bn: 'আপনি এখন %@ করছেন।', th: 'คุณกำลังฝึก %@ อยู่', ko: '지금 %@ 하는 중이에요.', 'zh-Hans': '你正在进行 %@。', 'zh-Hant': '你正在進行 %@。', sv: 'Du är mitt i %@.',
  },
  'You’re in the middle of a workout.': {
    de: 'Du bist mitten im Training.', fr: 'Tu es en pleine séance.', es: 'Estás en mitad de un entreno.', it: 'Sei nel mezzo di un allenamento.',
    'pt-PT': 'Estás a meio de um treino.', 'pt-BR': 'Você está no meio de um treino.', pl: 'Jesteś w trakcie treningu.', hu: 'Épp edzel.',
    tr: 'Şu an antrenman yapıyorsun.', ru: 'Вы сейчас на тренировке.', uk: 'Ти зараз на тренуванні.', ar: 'أنت الآن في منتصف تمرين.',
    hi: 'आप अभी वर्कआउट के बीच में हैं।', bn: 'আপনি এখন ওয়ার্কআউট করছেন।', th: 'คุณกำลังฝึกอยู่', ko: '지금 운동 중이에요.', 'zh-Hans': '你正在训练中。', 'zh-Hant': '你正在訓練中。', sv: 'Du är mitt i ett pass.',
  },
  'Your workout': {
    de: 'Dein Training', fr: 'Ta séance', es: 'Tu entreno', it: 'Il tuo allenamento', 'pt-PT': 'O teu treino', 'pt-BR': 'Seu treino', pl: 'Twój trening', hu: 'Az edzésed',
    tr: 'Antrenmanın', ru: 'Ваша тренировка', uk: 'Твоє тренування', ar: 'تمرينك', hi: 'आपका वर्कआउट', bn: 'আপনার ওয়ার্কআউট', th: 'การฝึกของคุณ', ko: '오늘 운동',
    'zh-Hans': '你的训练', 'zh-Hant': '你的訓練', sv: 'Ditt pass',
  },
  '%@ is done for today. Nice work.': {
    de: '%@ ist für heute erledigt. Stark.', fr: '%@ est fait pour aujourd’hui. Bien joué.', es: '%@ ya está hecho por hoy. Buen trabajo.',
    it: '%@ è fatto per oggi. Ottimo lavoro.', 'pt-PT': '%@ está feito por hoje. Bom trabalho.', 'pt-BR': '%@ está feito por hoje. Mandou bem.',
    pl: '%@ na dziś zrobione. Dobra robota.', hu: '%@ mára kész. Szép munka.', tr: '%@ bugünlük tamam. Eline sağlık.', ru: '%@ на сегодня готово. Отличная работа.',
    uk: '%@ на сьогодні готово. Чудова робота.', ar: 'انتهى %@ لليوم. أحسنت.', hi: 'आज का %@ हो गया। बढ़िया।', bn: 'আজকের %@ শেষ। দারুণ।',
    th: '%@ ของวันนี้เสร็จแล้ว เยี่ยมมาก', ko: '오늘 %@ 끝! 수고했어요.', 'zh-Hans': '今天的 %@ 完成了，干得好。', 'zh-Hant': '今天的 %@ 完成了，做得好。', sv: '%@ är klart för i dag. Snyggt jobbat.',
  },
  'Today: %@.': {
    de: 'Heute: %@.', fr: 'Aujourd’hui : %@.', es: 'Hoy: %@.', it: 'Oggi: %@.', 'pt-PT': 'Hoje: %@.', 'pt-BR': 'Hoje: %@.', pl: 'Dziś: %@.', hu: 'Ma: %@.',
    tr: 'Bugün: %@.', ru: 'Сегодня: %@.', uk: 'Сьогодні: %@.', ar: 'اليوم: %@.', hi: 'आज: %@।', bn: 'আজ: %@।', th: 'วันนี้: %@', ko: '오늘: %@.', 'zh-Hans': '今天：%@。', 'zh-Hant': '今天：%@。', sv: 'I dag: %@.',
  },
  'Rest day today. Next up: %@ on %@.': {
    de: 'Heute ist Ruhetag. Als Nächstes: %@ am %@.', fr: 'Repos aujourd’hui. Ensuite : %@, %@.', es: 'Hoy toca descanso. Lo siguiente: %@ el %@.',
    it: 'Oggi riposo. Prossimo: %@, %@.', 'pt-PT': 'Hoje é dia de descanso. A seguir: %@, %@.', 'pt-BR': 'Hoje é dia de descanso. Próximo: %@, %@.',
    pl: 'Dziś dzień odpoczynku. Następny: %@, %@.', hu: 'Ma pihenőnap. A következő: %@, %@.', tr: 'Bugün dinlenme günü. Sıradaki: %@, %@.',
    ru: 'Сегодня отдых. Дальше: %@, %@.', uk: 'Сьогодні відпочинок. Далі: %@, %@.', ar: 'اليوم يوم راحة. التالي: %@ يوم %@.',
    hi: 'आज आराम का दिन है। अगला: %@, %@।', bn: 'আজ বিশ্রামের দিন। এরপর: %@, %@।', th: 'วันนี้วันพัก ถัดไป: %@ วัน%@',
    ko: '오늘은 쉬는 날이에요. 다음: %@, %@.', 'zh-Hans': '今天休息。下一次：%@，%@。', 'zh-Hant': '今天休息。下一次：%@，%@。', sv: 'Vilodag i dag. Nästa: %@ på %@.',
  },
  'Nothing planned today.': {
    de: 'Heute ist nichts geplant.', fr: 'Rien de prévu aujourd’hui.', es: 'Hoy no hay nada previsto.', it: 'Niente in programma oggi.', 'pt-PT': 'Nada planeado para hoje.',
    'pt-BR': 'Nada planejado para hoje.', pl: 'Na dziś nic nie zaplanowano.', hu: 'Mára nincs semmi tervezve.', tr: 'Bugün planlı bir şey yok.', ru: 'На сегодня ничего не запланировано.',
    uk: 'На сьогодні нічого не заплановано.', ar: 'لا شيء مخطط لليوم.', hi: 'आज कुछ प्लान नहीं है।', bn: 'আজ কিছু প্ল্যান নেই।', th: 'วันนี้ไม่มีแผน',
    ko: '오늘은 계획된 운동이 없어요.', 'zh-Hans': '今天没有计划。', 'zh-Hant': '今天沒有計畫。', sv: 'Inget planerat i dag.',
  },
  'No streak yet. One workout this week starts one.': {
    de: 'Noch keine Serie. Ein Training diese Woche startet eine.', fr: 'Pas encore de série. Une séance cette semaine en lance une.',
    es: 'Aún no tienes racha. Un entreno esta semana la empieza.', it: 'Ancora nessuna serie. Un allenamento questa settimana la fa partire.',
    'pt-PT': 'Ainda sem sequência. Um treino esta semana começa uma.', 'pt-BR': 'Ainda sem sequência. Um treino nesta semana começa uma.',
    pl: 'Jeszcze bez serii. Jeden trening w tym tygodniu ją zaczyna.', hu: 'Még nincs sorozatod. Egy edzés ezen a héten elindítja.',
    tr: 'Henüz serin yok. Bu hafta bir antrenman yeni bir seri başlatır.', ru: 'Серии пока нет. Одна тренировка на этой неделе её начнёт.',
    uk: 'Серії ще немає. Одне тренування цього тижня її почне.', ar: 'لا توجد سلسلة بعد. تمرين واحد هذا الأسبوع يبدأ واحدة.',
    hi: 'अभी कोई स्ट्रीक नहीं। इस हफ़्ते एक वर्कआउट से शुरू हो जाएगी।', bn: 'এখনও কোনো স্ট্রিক নেই। এই সপ্তাহে একটা ওয়ার্কআউটেই শুরু হবে।',
    th: 'ยังไม่มีสถิติต่อเนื่อง ฝึกสักครั้งในสัปดาห์นี้เพื่อเริ่ม', ko: '아직 연속 기록이 없어요. 이번 주에 한 번 운동하면 시작돼요.',
    'zh-Hans': '还没有连续纪录。本周练一次就开始了。', 'zh-Hant': '還沒有連續紀錄。本週練一次就開始了。', sv: 'Ingen svit än. Ett pass den här veckan startar en.',
  },
  'Week streak: %d. This week already counts.': {
    de: 'Wochen-Serie: %d. Diese Woche zählt schon.', fr: 'Série : %d semaines. Cette semaine compte déjà.', es: 'Racha: %d semanas. Esta semana ya cuenta.',
    it: 'Serie: %d settimane. Questa settimana conta già.', 'pt-PT': 'Sequência: %d semanas. Esta semana já conta.', 'pt-BR': 'Sequência: %d semanas. Esta semana já conta.',
    pl: 'Seria tygodni: %d. Ten tydzień już się liczy.', hu: 'Heti sorozat: %d. Ez a hét már megvan.', tr: 'Haftalık seri: %d. Bu hafta zaten sayılıyor.',
    ru: 'Серия недель: %d. Эта неделя уже засчитана.', uk: 'Серія тижнів: %d. Цей тиждень уже зараховано.', ar: 'سلسلة الأسابيع: %d. هذا الأسبوع محسوب بالفعل.',
    hi: 'हफ़्तों की स्ट्रीक: %d। यह हफ़्ता पहले ही गिना जा चुका है।', bn: 'সপ্তাহের স্ট্রিক: %d। এই সপ্তাহ আগেই গোনা হয়ে গেছে।',
    th: 'สัปดาห์ต่อเนื่อง: %d สัปดาห์นี้นับแล้ว', ko: '주간 연속 기록: %d. 이번 주는 이미 채웠어요.', 'zh-Hans': '每周连续纪录：%d。本周已经算上了。',
    'zh-Hant': '每週連續紀錄：%d。本週已經算上了。', sv: 'Veckosvit: %d. Den här veckan räknas redan.',
  },
  'Week streak: %d. One workout this week keeps it going.': {
    de: 'Wochen-Serie: %d. Ein Training diese Woche hält sie am Laufen.', fr: 'Série : %d semaines. Une séance cette semaine la prolonge.',
    es: 'Racha: %d semanas. Un entreno esta semana la mantiene.', it: 'Serie: %d settimane. Un allenamento questa settimana la tiene viva.',
    'pt-PT': 'Sequência: %d semanas. Um treino esta semana mantém-na.', 'pt-BR': 'Sequência: %d semanas. Um treino nesta semana mantém ela viva.',
    pl: 'Seria tygodni: %d. Jeden trening w tym tygodniu ją utrzyma.', hu: 'Heti sorozat: %d. Egy edzés ezen a héten életben tartja.',
    tr: 'Haftalık seri: %d. Bu hafta bir antrenman seriyi sürdürür.', ru: 'Серия недель: %d. Одна тренировка на этой неделе её продлит.',
    uk: 'Серія тижнів: %d. Одне тренування цього тижня її продовжить.', ar: 'سلسلة الأسابيع: %d. تمرين واحد هذا الأسبوع يحافظ عليها.',
    hi: 'हफ़्तों की स्ट्रीक: %d। इस हफ़्ते एक वर्कआउट इसे जारी रखेगा।', bn: 'সপ্তাহের স্ট্রিক: %d। এই সপ্তাহে একটা ওয়ার্কআউটে এটা চালু থাকবে।',
    th: 'สัปดาห์ต่อเนื่อง: %d ฝึกสักครั้งในสัปดาห์นี้เพื่อรักษาไว้', ko: '주간 연속 기록: %d. 이번 주에 한 번만 더 운동하면 이어져요.',
    'zh-Hans': '每周连续纪录：%d。本周练一次就能保持。', 'zh-Hant': '每週連續紀錄：%d。本週練一次就能保持。', sv: 'Veckosvit: %d. Ett pass den här veckan håller den vid liv.',
  },
  'That doesn’t sound like a weight. Try again?': {
    de: 'Das klingt nicht nach einem Gewicht. Noch mal?', fr: 'Ça ne ressemble pas à un poids. On réessaie ?', es: 'Eso no suena a un peso. ¿Lo intentamos otra vez?',
    it: 'Non sembra un peso. Riproviamo?', 'pt-PT': 'Isso não parece um peso. Tentamos outra vez?', 'pt-BR': 'Isso não parece um peso. Vamos tentar de novo?',
    pl: 'To nie brzmi jak waga. Spróbujemy jeszcze raz?', hu: 'Ez nem hangzik súlynak. Újra?', tr: 'Bu bir kilo gibi durmuyor. Tekrar dener misin?',
    ru: 'Это не похоже на вес. Попробуем ещё раз?', uk: 'Це не схоже на вагу. Спробуємо ще раз?', ar: 'هذا لا يبدو وزنًا. نحاول مرة أخرى؟',
    hi: 'यह वज़न जैसा नहीं लगता। फिर से कोशिश करें?', bn: 'এটা ওজনের মতো শোনাচ্ছে না। আবার চেষ্টা করবেন?', th: 'ฟังดูไม่เหมือนน้ำหนัก ลองอีกครั้งไหม',
    ko: '체중 같지 않아요. 다시 해 볼까요?', 'zh-Hans': '这听起来不像体重。再试一次？', 'zh-Hant': '這聽起來不像體重。再試一次？', sv: 'Det låter inte som en vikt. Försöka igen?',
  },
  'Logged %@.': {
    de: '%@ eingetragen.', fr: '%@ noté.', es: '%@ registrado.', it: '%@ registrato.', 'pt-PT': '%@ registado.', 'pt-BR': '%@ registrado.',
    pl: 'Zapisano %@.', hu: '%@ rögzítve.', tr: '%@ kaydedildi.', ru: 'Записано: %@.', uk: 'Записано: %@.', ar: 'تم تسجيل %@.',
    hi: '%@ दर्ज हो गया।', bn: '%@ লেখা হয়েছে।', th: 'บันทึก %@ แล้ว', ko: '%@ 기록했어요.', 'zh-Hans': '已记录 %@。', 'zh-Hant': '已記錄 %@。', sv: '%@ loggat.',
  },
}

// The long-press shortcuts (res/xml/shortcuts.xml): resource name → English and the words above.
export const ANDROID = {
  shortcut_start: 'Start workout',
  shortcut_weigh: 'Log weight',
  shortcut_stats: 'Stats',
}
const STATS = {
  de: 'Statistik', fr: 'Stats', es: 'Estadísticas', it: 'Statistiche', 'pt-PT': 'Estatísticas', 'pt-BR': 'Estatísticas', pl: 'Statystyki', hu: 'Statisztika',
  tr: 'İstatistikler', ru: 'Статистика', uk: 'Статистика', ar: 'الإحصاءات', hi: 'आँकड़े', bn: 'পরিসংখ্যান', th: 'สถิติ', ko: '통계', 'zh-Hans': '统计', 'zh-Hant': '統計', sv: 'Statistik',
}
const androidWord = (key, lang) => (key === 'Stats' ? STATS[lang] : STRINGS[key][lang])

const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const xmlEsc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "\\'").replace(/"/g, '\\"')
const appVar = s => s.replace(/\{app\}/g, '${applicationName}')
const HEAD = '/* Written by ios/ci/voice-strings.mjs: change it there. */\n'

function main () {
  for (const lang of LPROJ) {
    const dir = join(IOS_OUT, `${lang}.lproj`)
    mkdirSync(dir, { recursive: true })
    let phrases = HEAD
    for (const [key, t] of Object.entries(PHRASES)) {
      if (!t[lang]) throw new Error(`${lang}: no phrase for ${key}`)
      if (!t[lang].includes('{app}')) throw new Error(`${lang}: the phrase for ${key} lacks the app name`)
      phrases += `"${esc(appVar(key))}" = "${esc(appVar(t[lang]))}";\n`
    }
    writeFileSync(join(dir, 'AppShortcuts.strings'), phrases)
    let strings = HEAD
    for (const [key, t] of Object.entries(STRINGS)) {
      if (!t[lang]) throw new Error(`${lang}: no words for ${key}`)
      const want = (key.match(/%[@d]/g) || []).sort().join()
      if ((t[lang].match(/%[@d]/g) || []).sort().join() !== want) throw new Error(`${lang}: ${key} changes its placeholders`)
      strings += `"${esc(key)}" = "${esc(t[lang])}";\n`
    }
    writeFileSync(join(dir, 'Localizable.strings'), strings)
  }
  const xml = words => '<?xml version="1.0" encoding="utf-8"?>\n<!-- Written by frontend/ios/ci/voice-strings.mjs: change it there. -->\n<resources>\n' +
    Object.entries(words).map(([name, v]) => `    <string name="${name}">${xmlEsc(v)}</string>\n`).join('') + '</resources>\n'
  writeFileSync(join(ANDROID_RES, 'values', 'voice_strings.xml'), xml(ANDROID))
  for (const lang of LPROJ) {
    const dir = join(ANDROID_RES, ANDROID_DIR[lang] || `values-${lang}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'voice_strings.xml'), xml(Object.fromEntries(Object.entries(ANDROID).map(([n, k]) => [n, androidWord(k, lang)]))))
  }
  console.log(`wrote ${LPROJ.length} .lproj folders and ${LPROJ.length} Android value folders`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
