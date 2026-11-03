// What is behind each door of the advent calendar (lib/advent.js), as data. Fetched with the
// Christmas theme's chunk only. Every string is an English key, translated where it is shown;
// seasonal/advent.test.js checks each one is in every locale pack.
//
// Kinds:
//   fact, joke, tip   a line to read
//   challenge         a small thing to do today, ticked off with a tap (S.advent.done)
//   stretch           a gentle routine of holds that can be added to the user's routines
//   stat              a number from the user's own year (`stat`: 'best' or 'year')
// Door 24 is always SPECIAL. The other 23 turn by five places each year, so next December does
// not open on the same fact; within a year, a day always opens to the same thing.

export const DOOR_LIST = [
  { kind: 'fact', text: 'Reindeer can see ultraviolet light. Handy for spotting lichen in the snow, and probably your chalk marks.' },
  { kind: 'challenge', text: '10 push-ups before dinner. Knees on the floor count just the same.' },
  { kind: 'joke', text: 'Why did the gingerbread person skip the gym? They were feeling a bit crumbly.' },
  { kind: 'tip', text: 'Busy week? Two short sessions beat zero long ones. Twenty minutes counts.' },
  { kind: 'stat', stat: 'best' },
  { kind: 'fact', text: 'Walking in snow takes more energy than walking on a dry path. Every trip to the shops is a bonus workout.' },
  { kind: 'challenge', text: 'A 15-minute walk today. Bonus points for admiring someone else’s fairy lights.' },
  { kind: 'joke', text: 'What is a snowman’s favourite exercise? Snow angels. Three sets, lots of giggling.' },
  { kind: 'stretch' },
  { kind: 'tip', text: 'Cold outside? Warm up a little longer. Your joints like to be asked nicely.' },
  { kind: 'fact', text: 'Shivering is your muscles doing tiny, very fast reps to keep you warm.' },
  { kind: 'challenge', text: '20 squats while the kettle boils.' },
  { kind: 'joke', text: 'Santa only does one cardio session a year. To be fair, it is a very long one.' },
  { kind: 'tip', text: 'Big festive dinner? Brilliant fuel. Plan a heavy day after it and enjoy every bite.' },
  { kind: 'fact', text: 'Almost every snowflake has six arms, because of the way water lines up as it freezes.' },
  { kind: 'challenge', text: 'Hold a plank for 30 seconds. Hum a winter song in your head to pass the time.' },
  { kind: 'joke', text: 'The elves asked for a deload week. It is called January.' },
  { kind: 'stat', stat: 'year' },
  { kind: 'tip', text: 'Sleep is the best supplement there is, and it is free. Early night tonight?' },
  { kind: 'fact', text: 'Muscles get stronger while you rest, not while you lift. A nap is basically part of the plan.' },
  { kind: 'challenge', text: 'Drink a big glass of water before your next coffee or cocoa.' },
  { kind: 'joke', text: 'Rudolph never skips leg day. Have you seen how far those legs pull a sleigh?' },
  { kind: 'tip', text: 'Travelling for the holidays? Push-ups, squats and lunges fit in any suitcase.' },
]

export const SPECIAL = { kind: 'special' }

/** What door `day` (1 to 24) of `year` opens to. Always the same for the same day and year. */
export function doorFor(day, year) {
  if (day === 24) return SPECIAL
  const n = DOOR_LIST.length
  const shift = ((Number(year) - 2026) * 5) % n
  return DOOR_LIST[(((day - 1 + shift) % n) + n) % n]
}

/* The stretch door's routine: six gentle holds of 40 seconds a side or so, all on the floor or a
   mat, nothing to load. Catalogue ids; the routine's name is translated when it is added. */
export const STRETCH = [
  ['0945', 2, 40],   // child pose
  ['1051', 2, 30],   // cat stretch
  ['1053', 2, 40],   // kneeling hip flexor stretch
  ['0692', 2, 40],   // seated single leg hamstring stretch
  ['1056', 2, 40],   // lying glute stretch
  ['1271', 2, 30],   // chest and front of shoulder stretch
]

/** The English keys of everything behind the doors, for the locale check. */
export const DOOR_STRINGS = DOOR_LIST.map(d => d.text).filter(Boolean)
