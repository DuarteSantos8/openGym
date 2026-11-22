// Learn (EP24): the words and the basics a first-time lifter otherwise leaves the app to look up.
// Bundled with the app, so it reads offline and makes no request of its own.
//
// WHAT THIS IS, AND IS NOT
//   General education for healthy adults, written to be safe to follow without supervision. It
//   is not medical advice, diagnoses nothing and promises nothing (docs/next/adr/0012). Where a
//   number is given, the guide names where it comes from in `sources`.
//
// TRANSLATION
//   The text is English data, shown through t(variable): a locale pack that carries a string
//   shows it translated, every other language shows the English. The screens' own labels are
//   ordinary translated strings in all languages (views/Learn.jsx).
//
// A guide is { id, icon, title, summary, blocks, sources? }; a block is { h?, p?, list? }.
// A term is { id, term, def, also? } — `also` are other spellings the search should find.

export const GLOSSARY = [
  { id: 'rep', term: 'Rep', also: ['repetition', 'reps'], def: 'One complete movement of an exercise: down and up once in a squat is one rep.' },
  { id: 'set', term: 'Set', also: ['sets'], def: 'A group of reps done without stopping. "3 sets of 10" means ten reps, a rest, ten more, a rest, and ten more.' },
  { id: 'rest', term: 'Rest', also: ['rest time', 'rest timer'], def: 'The pause between two sets. Longer for heavy lifts (2 to 3 minutes), shorter for lighter ones (about a minute). The timer starts itself when you tick a set.' },
  { id: 'warm-up', term: 'Warm-up', also: ['warmup', 'warm up'], def: 'A few minutes of easy movement, then one or two lighter sets of the exercise itself before the real ones. It gets the joints moving and lets you practise the movement.' },
  { id: 'working-set', term: 'Working set', also: ['work set'], def: 'A set that counts: done at the planned weight after the warm-up.' },
  { id: 'cool-down', term: 'Cool-down', also: ['cooldown'], def: 'A few easy minutes at the end, such as a slow walk. Optional, and a pleasant way to finish.' },
  { id: 'form', term: 'Form', also: ['technique'], def: 'How you do the movement. Good form means the muscles you are training do the work and your joints move the way they are built to. It comes before weight, always.' },
  { id: 'rom', term: 'Range of motion', also: ['rom', 'full range'], def: 'How far a joint moves during a rep. Use as much range as you can control without pain: a lighter weight through the full range beats a heavy one through half of it.' },
  { id: 'tempo', term: 'Tempo', def: 'How fast you move the weight. A simple rule to start with: lower it under control in about two seconds, lift it without jerking.' },
  { id: 'bracing', term: 'Bracing', also: ['brace', 'core tight'], def: 'Tightening your middle before a lift, as if someone were about to poke you in the stomach. It keeps your back steady under load.' },
  { id: 'compound', term: 'Compound exercise', also: ['multi-joint'], def: 'A movement that uses several joints and muscles at once, such as a squat, a push-up or a row. Most of a beginner plan is made of these.' },
  { id: 'isolation', term: 'Isolation exercise', also: ['single-joint', 'accessory'], def: 'A movement that works mainly one muscle around one joint, such as a biceps curl.' },
  { id: 'free-weights', term: 'Free weights', also: ['dumbbell', 'barbell', 'kettlebell'], def: 'Weights you hold and steer yourself: dumbbells (one in each hand), a barbell (one long bar) and kettlebells (a ball with a handle).' },
  { id: 'machine', term: 'Machine', also: ['cable', 'selectorized', 'pin'], def: 'Equipment that guides the path of the movement. You choose the weight with a pin in a stack. Machines are a good place to start: there is less to balance.' },
  { id: 'bodyweight', term: 'Bodyweight exercise', also: ['calisthenics'], def: 'An exercise where your own body is the load: push-ups, squats, planks.' },
  { id: 'plate', term: 'Plate', also: ['plates', 'bumper'], def: 'A weight disc that slides onto a barbell. The bar itself has weight too, usually 20 kg (45 lb) for a full-size one.' },
  { id: 'grip', term: 'Grip', also: ['overhand', 'underhand', 'neutral', 'pronated', 'supinated'], def: 'How your hands hold the bar or handle: overhand (palms down), underhand (palms up) or neutral (palms facing each other).' },
  { id: 'per-side', term: 'Per side', also: ['unilateral', 'each side', 'single-arm', 'single-leg'], def: 'An exercise done with one arm or leg at a time. "10 per side" means ten with the left and ten with the right.' },
  { id: 'spotter', term: 'Spotter', also: ['spot'], def: 'Someone who stands ready to help if you cannot finish a rep on a lift like the bench press. Without one, stop a rep or two early or use the safety bars.' },
  { id: 'progressive-overload', term: 'Progressive overload', also: ['progression', 'overload'], def: 'Doing a little more over time: one more rep, or slightly more weight. Muscles adapt to what you ask of them, so the ask has to grow slowly. This is the one idea that makes training work.' },
  { id: 'linear-progression', term: 'Linear progression', def: 'The simplest way to progress: add a small amount of weight each time you complete all your sets and reps. It works well for the first months.' },
  { id: 'double-progression', term: 'Double progression', def: 'Progressing reps first, then weight: stay at one weight until you reach the top of a rep range (say 12), then add weight and start again at the bottom (say 8).' },
  { id: 'volume', term: 'Volume', also: ['total volume', 'weekly sets'], def: 'How much work you did. Most simply the number of hard sets per muscle in a week; the app also shows weight × reps added up.' },
  { id: 'intensity', term: 'Intensity', def: 'How heavy the weight is compared with the most you could lift. Not the same as how tired you feel.' },
  { id: '1rm', term: '1RM', also: ['one rep max', 'one-rep max', 'max'], def: 'One-rep max: the heaviest weight you could lift once with good form. Beginners do not need to test it.' },
  { id: 'e1rm', term: 'Estimated 1RM', also: ['e1rm', 'estimated max'], def: 'A calculation of your one-rep max from an ordinary set, such as 8 reps at 40 kg. Handy for seeing strength rise without ever lifting a true maximum.' },
  { id: 'pr', term: 'PR', also: ['personal record', 'pb', 'personal best'], def: 'Personal record: the best you have done on an exercise, in weight or in reps. The app spots them for you.' },
  { id: 'rir', term: 'RIR', also: ['reps in reserve'], def: 'Reps in reserve: how many more reps you could have done when you stopped. RIR 2 means you had two left. Most beginner sets should end around RIR 2 to 3.' },
  { id: 'rpe', term: 'RPE', also: ['rate of perceived exertion', 'effort'], def: 'Rate of perceived exertion: how hard a set felt on a scale to 10. RPE 8 means about two reps were left, the same thing as RIR 2 said the other way round.' },
  { id: 'failure', term: 'Failure', also: ['to failure'], def: 'The point where you cannot complete another rep with good form. You do not need to reach it to make progress, and when you are new it is better not to.' },
  { id: 'superset', term: 'Superset', def: 'Two exercises done back to back with no rest between them, then a rest. Saves time.' },
  { id: 'circuit', term: 'Circuit', def: 'Several exercises done one after another, then the whole round repeated.' },
  { id: 'drop-set', term: 'Drop set', def: 'Finishing a set, taking weight off straight away and carrying on. An advanced way to add work; not needed in your first months.' },
  { id: 'rest-pause', term: 'Rest-pause', also: ['burst', 'mini-set'], def: 'Finishing a set, resting a few breaths and squeezing out a few more reps. Advanced, like the drop set.' },
  { id: 'amrap', term: 'AMRAP', also: ['as many reps as possible'], def: 'As many reps as possible: a set where you keep going until you have about one good rep left.' },
  { id: 'deload', term: 'Deload', also: ['deload week', 'light week'], def: 'A planned lighter week, with less weight or fewer sets, so your body catches up. The app suggests one when it sees you stalling.' },
  { id: 'plateau', term: 'Plateau', also: ['stall', 'stalling'], def: 'A stretch where a lift stops improving. Normal. Usually fixed by sleep, food, patience or a lighter week.' },
  { id: 'split', term: 'Split', also: ['training split'], def: 'How a week of training is divided between body parts. Full body, upper/lower and push/pull/legs are the common ones.' },
  { id: 'full-body', term: 'Full body', def: 'A plan where every session trains the whole body. The usual best start: you practise each movement several times a week.' },
  { id: 'upper-lower', term: 'Upper / Lower', def: 'A plan that alternates upper-body days and lower-body days, usually four sessions a week.' },
  { id: 'ppl', term: 'Push / Pull / Legs', also: ['ppl'], def: 'A plan with one day for pushing muscles (chest, shoulders, triceps), one for pulling muscles (back, biceps) and one for legs.' },
  { id: '5x5', term: '5×5', also: ['5x5', 'five by five'], def: 'Five sets of five reps on a few heavy barbell lifts. A classic strength plan, for when the movements already feel familiar.' },
  { id: 'rotation', term: 'Rotation', also: ['a/b', 'loop'], def: 'A plan without fixed weekdays: sessions A, B, C simply follow each other, whenever you train.' },
  { id: 'hypertrophy', term: 'Hypertrophy', also: ['muscle growth', 'building muscle'], def: 'Muscle growth. Trained with moderate weights, roughly 6 to 15 reps a set, and enough sets each week.' },
  { id: 'mobility', term: 'Mobility', also: ['flexibility'], def: 'How freely and comfortably your joints move through their range under your own control.' },
  { id: 'doms', term: 'Muscle soreness (DOMS)', also: ['doms', 'sore', 'soreness'], def: 'The stiff, tender feeling a day or two after new or harder training. Harmless and it fades in a few days; it is not a measure of a good workout. Sharp pain during a movement is something else: stop.' },
  { id: 'rest-day', term: 'Rest day', also: ['recovery day'], def: 'A day without hard training. Muscles get stronger between sessions, not during them, so rest days are part of the plan, not a gap in it.' },
  { id: 'recovery', term: 'Recovery', def: 'What happens between sessions: sleep, food and time turn the work into progress.' },
  { id: 'streak', term: 'Streak', def: 'How many weeks in a row you have trained. It counts weeks, not days, so rest days never break it.' },
]

export const GUIDES = [
  {
    id: 'first-week', icon: 'flag', title: 'Your first week',
    summary: 'What to expect, and what to ignore.',
    blocks: [
      { p: 'The goal of week one is not to work hard. It is to learn the movements and come back for week two.' },
      { h: 'In the gym', list: [
        'Pick weights that feel almost too easy. You should finish every set knowing you could have done three more reps.',
        'Watch the demonstration and read the steps before each new exercise. Do the first set slowly.',
        'Tick each set when it is done. The rest timer starts by itself; wait for it.',
        'If something hurts in a sharp or pinching way, stop that exercise and swap it for another one for the same muscle.',
      ] },
      { h: 'Afterwards', list: [
        'Expect to be stiff a day or two later, most of all after the very first sessions. That is normal and gets much milder within two weeks.',
        'Leave a day between sessions. Walking on the days in between helps the stiffness.',
        'Next time, the app fills in the weights you used. If all sets felt easy, add a little.',
      ] },
      { p: 'Two or three sessions this week is a full week. More is not better yet.' },
    ],
    sources: ['American College of Sports Medicine. Progression Models in Resistance Training for Healthy Adults. Med Sci Sports Exerc. 2009;41(3):687-708.'],
  },
  {
    id: 'how-heavy', icon: 'scale', title: 'How heavy should I start?',
    summary: 'Two test sets find your starting weight.',
    blocks: [
      { p: 'Nobody can tell you the number in advance, and it does not matter where you begin. Find it like this, once per exercise:' },
      { list: [
        'Take a weight you are sure is light: the empty bar, the lightest dumbbells, or the top few plates of a machine stack. Do the planned reps.',
        'If that was very easy, go up one step and do the reps again.',
        'Stop at the first weight where the last two reps slow down a little but still look the same as the first. That is your starting weight.',
        'If in doubt between two weights, take the lighter one. You will pass it within weeks anyway.',
      ] },
      { h: 'After that', p: 'When you complete every set and rep, add the smallest step available next time: 2.5 kg (5 lb) on a bar, the next dumbbell, one plate on a machine. When you cannot complete them, keep the weight and try again next session.' },
      { p: 'Bodyweight exercises have no weight to choose. If you cannot reach the planned reps, do what you can with good form or pick an easier variation, such as push-ups with your hands on a bench.' },
    ],
    sources: ['American College of Sports Medicine. Progression Models in Resistance Training for Healthy Adults. Med Sci Sports Exerc. 2009;41(3):687-708 (a 2 to 10% load increase once one to two reps over the target are possible).'],
  },
  {
    id: 'warm-up', icon: 'sunrise', title: 'Warming up and cooling down',
    summary: 'Five minutes before, optional five after.',
    blocks: [
      { h: 'Before', list: [
        'Three to five minutes of anything easy that makes you slightly warm: brisk walking, cycling, rowing.',
        'Then, for the first one or two exercises, do one or two lighter sets before the real ones, for example half the weight for eight reps. With "Plates and warm-ups" switched on, the app works these out for you.',
        'You do not need a warm-up set before every exercise, only where the muscles are being used for the first time that day.',
      ] },
      { h: 'After', list: [
        'A few minutes of easy walking brings your breathing down.',
        'Stretching afterwards is optional. If it feels good, hold each stretch gently for 20 to 30 seconds without bouncing.',
      ] },
      { p: 'Long static stretching before lifting is not needed. Moving through the exercise with a light weight is the best preparation for doing it with a heavier one.' },
    ],
  },
  {
    id: 'progress', icon: 'chartLine', title: 'How you get stronger',
    summary: 'A little more, a little at a time.',
    blocks: [
      { p: 'Your body adapts to what you ask of it. Ask for slightly more than last time, recover, and it becomes able to do it. That is the whole method, and it is called progressive overload.' },
      { h: 'What "a little more" means', list: [
        'One more rep with the same weight, or',
        'the same reps with slightly more weight, or',
        'the same weight and reps with better control.',
      ] },
      { h: 'What to expect', list: [
        'In the first two months, progress is fast and comes mostly from your nervous system learning the movements.',
        'After that it slows down. Adding weight every single session stops working, and that is normal, not a failure.',
        'A week where nothing improves is part of training. Sleep, food and a lighter week fix most stalls.',
      ] },
      { p: 'The app keeps the record for you: it fills in last time\'s weights, marks personal records and suggests when to add weight.' },
    ],
    sources: ['American College of Sports Medicine. Progression Models in Resistance Training for Healthy Adults. Med Sci Sports Exerc. 2009;41(3):687-708.'],
  },
  {
    id: 'rest', icon: 'moon', title: 'Rest days, sleep and soreness',
    summary: 'When to train again, and when not to.',
    blocks: [
      { p: 'Training is the signal. The getting stronger happens afterwards, while you rest.' },
      { h: 'Rest days', list: [
        'When you are new, leave about 48 hours before training the same muscles hard again. A plan on Monday, Wednesday and Friday does this for you.',
        'A rest day is not a day on the sofa unless you want it to be. Walking, cycling or easy stretching all help.',
        'Missing a session does not undo anything. Do the next one as planned; do not try to make up for it by doing two.',
      ] },
      { h: 'Sleep', p: 'Adults are advised to sleep at least seven hours a night. If you sleep badly for a few days, expect the weights to feel heavier, and take it easier rather than pushing through.' },
      { h: 'Soreness or pain?', list: [
        'Soreness is dull, spread over the muscle, appears a day or two later and eases as you move. You can train with mild soreness.',
        'Pain is sharp, in one spot, often in or near a joint, and gets worse as you move. Do not train through it.',
      ] },
    ],
    sources: [
      'World Health Organization. WHO guidelines on physical activity and sedentary behaviour. 2020.',
      'Watson NF et al. Recommended Amount of Sleep for a Healthy Adult: A Joint Consensus Statement of the American Academy of Sleep Medicine and Sleep Research Society. Sleep. 2015;38(6):843-844.',
    ],
  },
  {
    id: 'food', icon: 'list', title: 'Food and water basics',
    summary: 'Enough protein, enough water, no magic.',
    blocks: [
      { p: 'You do not need a special diet to start training. Three things are worth knowing.' },
      { h: 'Protein', list: [
        'Muscles are rebuilt from protein. For people who train, sports-nutrition guidance suggests about 1.4 to 2.0 g of protein per kilogram of body weight per day.',
        'Spread it over your meals rather than eating it all at once: roughly 20 to 40 g at a time.',
        'Ordinary food does this: meat, fish, eggs, dairy, beans, lentils, tofu. Protein powder is a convenience, not a requirement.',
      ] },
      { h: 'Enough food overall', list: [
        'To build muscle you need to eat about as much as you burn, or a little more.',
        'To lose fat you need to eat a little less than you burn. Training helps you keep your muscle while you do; most of the loss itself comes from food.',
        'A simple plate: half vegetables or fruit, a quarter protein, a quarter starchy food such as rice, potatoes or bread.',
      ] },
      { h: 'Water', list: [
        'Drink when you are thirsty, and have water with you when you train.',
        'You need more when it is hot or when you sweat a lot.',
      ] },
      { p: 'If you have a medical condition, are pregnant, or have a history of disordered eating, ask a doctor or a registered dietitian before changing how you eat. These are general figures for healthy adults.' },
    ],
    sources: ['Jäger R et al. International Society of Sports Nutrition Position Stand: protein and exercise. J Int Soc Sports Nutr. 2017;14:20.'],
  },
  {
    id: 'gym-day-one', icon: 'dumbbell', title: 'First day in a gym',
    summary: 'How the place works, so nothing surprises you.',
    blocks: [
      { p: 'Everyone in the room had a first day. Nobody is watching you as closely as you think.' },
      { h: 'Finding your way', list: [
        'Most machines have a picture showing the movement and the muscles. The seat and pads adjust, usually with a yellow or red handle: set them so the movement feels natural.',
        'The weight is chosen with a pin in the stack. Start near the top, where it is lightest.',
        'Not sure how something works? Ask the staff. Showing people is their job, and they would rather be asked.',
      ] },
      { h: 'Good manners', list: [
        'Put weights back where they came from.',
        'Wipe down a bench or machine after using it.',
        'If someone is waiting, offer to take turns between sets.',
        'Do not stand directly in front of the dumbbell rack to lift; step back so others can reach it.',
      ] },
      { h: 'What to bring', p: 'Comfortable clothes, shoes with a flat, firm sole, a water bottle and a small towel. Your phone, with this app, is your training log.' },
    ],
  },
  {
    id: 'safety', icon: 'shield', title: 'When to stop',
    summary: 'The signs that mean stop, not push.',
    blocks: [
      { p: 'Effort feels like burning muscles, heavy breathing and shaking on the last rep. That is fine. These are different, and they mean stop:' },
      { list: [
        'Pain, pressure or tightness in your chest.',
        'Feeling faint, dizzy or suddenly unwell.',
        'Being far more out of breath than the effort explains.',
        'Sharp pain, or pain that shoots down an arm or a leg.',
        'Numbness, tingling or sudden weakness.',
      ] },
      { p: 'Stop the session. If chest pain, fainting or severe breathlessness does not pass within minutes of resting, call your local emergency number.' },
      { h: 'Check with a doctor before you start if', list: [
        'you have a heart condition, high blood pressure that is not under control, or you have been told to limit exercise;',
        'you are pregnant or recently gave birth;',
        'you are recovering from surgery or an injury.',
      ] },
      { p: 'This app gives general training information for healthy adults. It does not replace a doctor, a physiotherapist or a coach who can see you move.' },
    ],
  },
]
