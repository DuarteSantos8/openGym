#!/usr/bin/env node
// Writes the widget extension's own strings (ios/App/OpenGymWidgets/<lang>.lproj/
// Localizable.strings) in every language the app speaks: the names and descriptions iOS shows in
// its widget gallery, and the line a widget shows before the app ever wrote anything. Everything
// else a widget says comes from the app, in the app's language (lib/widgets.js). Run it after
// changing the phrases below, and commit what it writes:
//
//   node frontend/ios/ci/widget-strings.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'App', 'OpenGymWidgets')
const LPROJ = ['de', 'fr', 'es', 'it', 'pt-PT', 'pt-BR', 'pl', 'hu', 'tr', 'ru', 'uk', 'ar', 'hi', 'bn', 'th', 'ko', 'zh-Hans', 'zh-Hant']

// The Swift source's key → its words per .lproj.
export const STRINGS = {
  'Today’s workout': {
    de: 'Heutiges Training', fr: 'Séance du jour', es: 'Entreno de hoy', it: 'Allenamento di oggi', 'pt-PT': 'Treino de hoje', 'pt-BR': 'Treino de hoje',
    pl: 'Dzisiejszy trening', hu: 'Mai edzés', tr: 'Bugünün antrenmanı', ru: 'Тренировка на сегодня', uk: 'Тренування на сьогодні', ar: 'تمرين اليوم',
    hi: 'आज का वर्कआउट', bn: 'আজকের ওয়ার্কআউট', th: 'การฝึกวันนี้', ko: '오늘의 운동', 'zh-Hans': '今日训练', 'zh-Hant': '今日訓練',
  },
  'Your plan for today, the week ahead and your streak.': {
    de: 'Dein Plan für heute, die Woche und deine Serie.', fr: 'Ton programme du jour, la semaine à venir et ta série.',
    es: 'Tu plan de hoy, la semana que viene y tu racha.', it: 'Il tuo piano di oggi, la settimana e la tua serie.',
    'pt-PT': 'O teu plano de hoje, a semana e a tua sequência.', 'pt-BR': 'Seu plano de hoje, a semana e sua sequência.',
    pl: 'Twój plan na dziś, nadchodzący tydzień i twoja seria.', hu: 'A mai terved, a hét és a sorozatod.',
    tr: 'Bugünkü planın, önündeki hafta ve serin.', ru: 'Ваш план на сегодня, неделю вперёд и ваша серия.',
    uk: 'Твій план на сьогодні, тиждень наперед і твоя серія.', ar: 'خطتك لليوم والأسبوع القادم وسلسلتك.',
    hi: 'आज का प्लान, आने वाला हफ़्ता और आपकी स्ट्रीक।', bn: 'আজকের প্ল্যান, সামনের সপ্তাহ আর আপনার স্ট্রিক।',
    th: 'แผนวันนี้ สัปดาห์ข้างหน้า และสถิติต่อเนื่องของคุณ', ko: '오늘의 계획, 다가오는 한 주, 연속 기록.',
    'zh-Hans': '今天的计划、接下来一周和你的连续纪录。', 'zh-Hant': '今天的計畫、接下來一週和你的連續紀錄。',
  },
  'Streak': {
    de: 'Serie', fr: 'Série', es: 'Racha', it: 'Serie', 'pt-PT': 'Sequência', 'pt-BR': 'Sequência', pl: 'Seria', hu: 'Sorozat', tr: 'Seri',
    ru: 'Серия', uk: 'Серія', ar: 'السلسلة', hi: 'स्ट्रीक', bn: 'স্ট্রিক', th: 'ต่อเนื่อง', ko: '연속 기록', 'zh-Hans': '连续纪录', 'zh-Hant': '連續紀錄',
  },
  'Weeks in a row with a workout.': {
    de: 'Wochen in Folge mit Training.', fr: 'Semaines d’affilée avec une séance.', es: 'Semanas seguidas con entreno.',
    it: 'Settimane di fila con un allenamento.', 'pt-PT': 'Semanas seguidas com treino.', 'pt-BR': 'Semanas seguidas com treino.',
    pl: 'Tygodnie z rzędu z treningiem.', hu: 'Egymást követő hetek edzéssel.', tr: 'Antrenmanlı art arda haftalar.',
    ru: 'Недели подряд с тренировкой.', uk: 'Тижні поспіль із тренуванням.', ar: 'أسابيع متتالية فيها تمرين.',
    hi: 'लगातार हफ़्ते जिनमें वर्कआउट हुआ।', bn: 'টানা যত সপ্তাহে ওয়ার্কআউট হয়েছে।', th: 'จำนวนสัปดาห์ติดต่อกันที่มีการฝึก',
    ko: '운동한 주가 연속으로 이어진 횟수.', 'zh-Hans': '连续有训练的周数。', 'zh-Hant': '連續有訓練的週數。',
  },
  'Open openGym once to see your plan here.': {
    de: 'Öffne openGym einmal, dann siehst du hier deinen Plan.', fr: 'Ouvre openGym une fois pour voir ton programme ici.',
    es: 'Abre openGym una vez para ver aquí tu plan.', it: 'Apri openGym una volta per vedere qui il tuo piano.',
    'pt-PT': 'Abre o openGym uma vez para veres aqui o teu plano.', 'pt-BR': 'Abra o openGym uma vez para ver seu plano aqui.',
    pl: 'Otwórz openGym raz, a zobaczysz tu swój plan.', hu: 'Nyisd meg egyszer az openGymet, és itt látod a terved.',
    tr: 'Planını burada görmek için openGym’i bir kez aç.', ru: 'Откройте openGym один раз, и здесь появится ваш план.',
    uk: 'Відкрий openGym один раз, і тут з’явиться твій план.', ar: 'افتح openGym مرة واحدة لترى خطتك هنا.',
    hi: 'अपना प्लान यहाँ देखने के लिए openGym एक बार खोलें।', bn: 'আপনার প্ল্যান এখানে দেখতে openGym একবার খুলুন।',
    th: 'เปิด openGym สักครั้งเพื่อดูแผนของคุณที่นี่', ko: 'openGym을 한 번 열면 여기에서 계획을 볼 수 있어요.',
    'zh-Hans': '打开一次 openGym，就能在这里看到你的计划。', 'zh-Hant': '打開一次 openGym，就能在這裡看到你的計畫。',
  },
}

const esc = s => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const l of LPROJ) {
    const lines = ['/* Written by ios/ci/widget-strings.mjs: change it there. */']
    for (const [k, tr] of Object.entries(STRINGS)) {
      if (!tr[l]) throw new Error(`${k}: no ${l}`)
      lines.push(`"${esc(k)}" = "${esc(tr[l])}";`)
    }
    const dir = join(out, `${l}.lproj`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'Localizable.strings'), lines.join('\n') + '\n')
  }
  console.log(`wrote ${LPROJ.length} languages to ${out}`)
}
