// What is behind each door of the advent calendar (lib/advent.js), as data. Fetched with the
// Christmas theme's chunk only. Every string is an English key, translated where it is shown;
// seasonal/advent-doors.test.js checks each one is in every locale pack. Exercises are catalogue
// ids, so their names come translated from the exercise-name packs.
//
// v1.4.5: every door is something to do in the app, not just to read. Kinds:
//   finisher   a few minutes of timed moves, two of them in a superset. Started as a quick
//              workout (or added to the end of the one running), so the app's own hold timer,
//              rest timer and sounds run it, and it is logged like any workout.
//   count      a number to reach over the day (50 squats), counted in the door in steps
//              (S.advent.reps); reaching it does the door.
//   exercise   the exercise of the day, a tap away from today's workout.
//   stat       a number from the user's own year (`stat`: best, volume, muscle, streak, year).
//   stretch    the gentle routine of holds that can be added to the user's routines.
// Each door also carries a line to smile at (`text`), mostly the old calendar's jokes and facts.
// Door 24 is always SPECIAL: a little year in review and a present. The other 23 turn by five
// places each year, so next December does not open on the same thing; within a year, a day
// always opens to the same thing.

export const DOOR_LIST = [
  { kind: 'finisher', name: 'Jingle burner', moves: [['3094', 4, 30], ['3948', 4, 30]], rest: 15, text: 'Shivering is your muscles doing tiny, very fast reps to keep you warm.' },
  { kind: 'count', id: '1197', goal: 50, step: 10, text: 'Rudolph never skips leg day. Have you seen how far those legs pull a sleigh?' },
  { kind: 'stat', stat: 'best' },
  { kind: 'exercise', id: '0549', sets: 3, reps: 15, text: 'Cold outside? Warm up a little longer. Your joints like to be asked nicely.' },
  { kind: 'count', id: '0662', goal: 30, step: 5, text: 'Knees on the floor count just the same.' },
  { kind: 'finisher', name: 'Sleigh pull', moves: [['0630', 3, 40], ['3360', 3, 30]], rest: 20, text: 'Santa only does one cardio session a year. To be fair, it is a very long one.' },
  { kind: 'stat', stat: 'volume' },
  { kind: 'stretch' },
  { kind: 'count', id: '3094', goal: 100, step: 20, text: 'Walking in snow takes more energy than walking on a dry path. Every trip to the shops is a bonus workout.' },
  { kind: 'exercise', id: '1760', sets: 3, reps: 10, text: 'Big festive dinner? Brilliant fuel. Plan a heavy day after it and enjoy every bite.' },
  { kind: 'finisher', name: 'Snow day plank', moves: [['0463', 3, 40], ['3930', 3, 30]], rest: 20, text: 'Almost every snowflake has six arms, because of the way water lines up as it freezes.' },
  { kind: 'stat', stat: 'muscle' },
  { kind: 'count', id: '0612', goal: 40, step: 10, text: 'Travelling for the holidays? Push-ups, squats and lunges fit in any suitcase.' },
  { kind: 'exercise', id: '2290', sets: 3, reps: 8, text: 'Why did the gingerbread person skip the gym? They were feeling a bit crumbly.' },
  { kind: 'finisher', name: 'Chimney climb', moves: [['1160', 4, 20], ['0514', 4, 20]], rest: 20, text: 'What is a snowman’s favourite exercise? Snow angels. Three sets, lots of giggling.' },
  { kind: 'stat', stat: 'streak' },
  { kind: 'count', id: '1160', goal: 20, step: 5, text: 'The elves asked for a deload week. It is called January.' },
  { kind: 'exercise', id: '1060', sets: 3, reps: 10, text: 'Muscles get stronger while you rest, not while you lift. A nap is basically part of the plan.' },
  { kind: 'finisher', name: 'Elf on the floor', moves: [['0612', 3, 40], ['3109', 3, 30]], rest: 15, text: 'Reindeer can see ultraviolet light. Handy for spotting lichen in the snow, and probably your chalk marks.' },
  { kind: 'stat', stat: 'year' },
  { kind: 'count', id: '0630', goal: 60, step: 10, text: 'Busy week? Two short sessions beat zero long ones. Twenty minutes counts.' },
  { kind: 'exercise', id: '2133', sets: 3, sec: 40, text: 'Carry the shopping like it owes you money. Tall chest, slow steps.' },
  { kind: 'finisher', name: 'Last-minute dash', moves: [['1471', 3, 40], ['3094', 3, 30]], rest: 15, text: 'Sleep is the best supplement there is, and it is free. Early night tonight?' },
]

export const SPECIAL = { kind: 'special' }

/** What door `day` (1 to 24) of `year` opens to. Always the same for the same day and year. */
export function doorFor(day, year) {
  if (day === 24) return SPECIAL
  const n = DOOR_LIST.length
  const shift = ((Number(year) - 2026) * 5) % n
  return DOOR_LIST[(((day - 1 + shift) % n) + n) % n]
}

/** A finisher's length in whole minutes: its holds and the rests between them. */
export function finisherMinutes(door) {
  const sec = door.moves.reduce((s, [, sets, hold]) => s + sets * (hold + (door.rest || 0)), 0)
  return Math.max(1, Math.round(sec / 60))
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

/* What a year of lifting weighs, the festive way: a reindeer is about 120 kg (a big one). */
export const REINDEER_KG = 120

/** Every exercise a door names, for the catalogue check. */
export const DOOR_EXERCISES = [...new Set(DOOR_LIST.flatMap(d => (d.moves ? d.moves.map(([id]) => id) : d.id ? [d.id] : [])))]

/** The English keys of everything behind the doors, for the locale check. */
export const DOOR_STRINGS = [...new Set(DOOR_LIST.flatMap(d => [d.text, d.name]).filter(Boolean))]
