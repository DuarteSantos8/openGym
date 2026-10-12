import { describe, it, expect } from 'vitest'
import { matchVideoName, FOLLOW_ALONG, singular, draftRows, rowConfidence, mergeRows, buildVideoRoutine, mergeVideoRoutine, videoLinkAt } from './import-video.js'
import { EXIDX } from './exercises.js'
import { supersetUnits } from './history.js'

// What follow-along videos write on screen, and the catalogue entry each has to land on.
// The strict importer matcher (import-csv matchExercise) missed every one of these or chose a
// combo move ("inchworm and mountain climbers" for "Mountain Climbers").
const NAMES = {
  'Jumping Jacks': '3094',
  BURPEES: '1160',
  'Mountain Climbers': '0630',
  'MOUNTAIN CLIMBER': '0630',
  'High Knees': '3556',
  'Squat Jumps': '0514',
  'Jump Squat': '0514',
  Plank: '0463',
  'Push Ups': '0662',
  'Butt Kicks': '3037',
  'Russian Twist': '0687',
  Lunges: '0612',
  "Child's Pose": '0945',
  'Plank Jacks': '3930',
  'Bicycle Crunches': '6211',
  'Side Plank': '0715',
  'Arm Circles': '3905',
  'Quad Stretch': '4300',
  'Hamstring Stretch': '1511',
}

describe('video captions resolve to the catalogue', () => {
  for (const [name, id] of Object.entries(NAMES)) {
    it(`"${name}" → ${id} (${EXIDX[id]?.n})`, () => {
      const m = matchVideoName(name)
      expect(m.id).toBe(id)
      expect(m.conf).toBeGreaterThanOrEqual(0.6)
      expect(m.candidates[0]).toBe(id)
    })
  }

  it('every follow-along alias points at an exercise that exists', () => {
    for (const [k, id] of Object.entries(FOLLOW_ALONG)) expect(EXIDX[id], k).toBeTruthy()
  })

  it('the profile’s own exercise wins over the catalogue', () => {
    const S = { customEx: [{ id: 'c1', n: 'Burpee', bp: 'cardio', custom: true }] }
    expect(matchVideoName('BURPEES', S)).toMatchObject({ id: 'c1', conf: 1, how: 'custom' })
  })

  it('a name with nothing close is a question, not a guess — with candidates to pick from', () => {
    const m = matchVideoName('Turbo Frog Shuffle')
    expect(m.id).toBeNull()
    expect(Array.isArray(m.candidates)).toBe(true)
    expect(matchVideoName('').id).toBeNull()
    expect(matchVideoName('qwxzv').candidates).toEqual([])
  })

  it('equipment the caption never named is not chosen for it', () => {
    const m = matchVideoName('Glute Bridge')
    if (m.id) expect(EXIDX[m.id].n).not.toMatch(/barbell|dumbbell|band/)
  })

  it('singular', () => {
    expect(['burpees', 'crunches', 'lunges', 'knees', 'press', 'circles', 'bodies', 'abs', 'ups'].map(singular))
      .toEqual(['burpee', 'crunch', 'lunge', 'knee', 'press', 'circle', 'body', 'abs', 'up'])
  })
})

// The worker's draft for warm-up → 3 rounds of 40/20 → stretch (video-import/src/classify.js).
const RESULT = {
  source: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', id: 'dQw4w9WgXcQ', title: '20 MIN HIIT', channel: 'Coach' },
  draft: {
    sections: [
      { kind: 'warmup', rows: [
        { id: 'v1', name: 'Jumping Jacks', conf: 0.9, sec: 60, rest: 0, rounds: 1, side: false, occurrences: [{ start: 0, dur: 60 }], thumb: 'data:image/jpeg;base64,AA' },
        { id: 'v2', name: 'Arm Circles', conf: 0.85, sec: 30, rest: 0, rounds: 1, side: false, occurrences: [{ start: 60, dur: 30 }] }
      ] },
      { kind: 'interval', rounds: 3, work: 40, rest: 20, rows: [
        { id: 'v3', name: 'Burpees', conf: 0.9, sec: 40, rest: 20, rounds: 3, occurrences: [{ start: 90, dur: 40 }, { start: 210, dur: 40 }, { start: 330, dur: 40 }] },
        { id: 'v4', name: 'Turbo Frog Shuffle', conf: 0.7, sec: 40, rest: 20, rounds: 3, occurrences: [{ start: 150, dur: 40 }] }
      ] },
      { kind: 'stretch', rows: [
        { id: 'v5', name: 'Quad Stretch', conf: 0.8, sec: 30, rest: 0, rounds: 1, side: true, occurrences: [{ start: 400, dur: 30 }, { start: 430, dur: 30 }] },
        { id: 'v6', name: "Child's Pose", conf: 0.9, sec: 45, rest: 0, rounds: 1, side: false, occurrences: [{ start: 460, dur: 45 }], thumb: 'javascript:alert(1)' }
      ] }
    ]
  }
}
const LABELS = { warmup: 'Warm-up', stretch: 'Stretching', other: 'Block' }

describe('draft → review rows', () => {
  const rows = draftRows(RESULT)
  it('one row per detected exercise, matched, unmatched ones waiting to be created', () => {
    expect(rows.map(r => [r.section, r.exId])).toEqual([
      ['warmup', '3094'], ['warmup', '3905'], ['interval', '1160'], ['interval', null], ['stretch', '4300'], ['stretch', '0945']
    ])
    const skater = rows[3]
    expect(skater.create).toEqual({ n: 'turbo frog shuffle', bp: 'cardio' })
    expect(skater.start).toBe(150)
  })
  it('only image data URLs survive as thumbnails', () => {
    expect(rows[0].thumb).toMatch(/^data:image\//)
    expect(rows[5].thumb).toBeNull()
  })
  it('confidence is the weaker of reading and matching; unmatched is 0', () => {
    expect(rowConfidence(rows[2])).toBe(0.9)
    expect(rowConfidence(rows[3])).toBe(0)
  })
  it('merging two readings of one interval exercise adds their rounds', () => {
    const m = mergeRows(rows, rows[2].rid, rows[3].rid)
    expect(m).toHaveLength(5)
    expect(m[2].rounds).toBe(6)
    expect(m[2].variants).toContain('Turbo Frog Shuffle')
    expect(mergeRows(rows, 'nope', rows[3].rid)).toBe(rows)
  })
})

describe('rows → routine', () => {
  const rows = draftRows(RESULT)
  const built = buildVideoRoutine(rows, { name: '', source: RESULT.source, labels: LABELS })
  const { routine } = built

  it('interval exercises are rounds × timed sets with the rest between them', () => {
    const burpees = routine.ex.find(e => e.id === '1160')
    expect(burpees).toEqual({ id: '1160', mode: 'time', sec: 40, weight: 0, sets: 3, restSec: 20 })
    expect(burpees.sg).toBeUndefined()
  })

  it('warm-up and stretch are named groups of single timed sets', () => {
    const warm = routine.ex.filter(e => e.sgName === 'Warm-up')
    expect(warm.map(e => [e.id, e.sets, e.sec])).toEqual([['3094', 1, 60], ['3905', 1, 30]])
    expect(new Set(warm.map(e => e.sg)).size).toBe(1)
    const stretch = routine.ex.filter(e => e.sgName === 'Stretching')
    expect(stretch.map(e => [e.id, e.side === true])).toEqual([['4300', true], ['0945', false]])
    // The app reads them as two supersets, so each section runs straight through.
    const units = supersetUnits(routine.ex)
    expect(units.filter(u => u.length > 1).map(u => u.length)).toEqual([2, 2])
  })

  it('an unmatched name becomes the profile’s own exercise, never dropped', () => {
    expect(built.customEx).toHaveLength(1)
    const c = built.customEx[0]
    expect(c).toMatchObject({ n: 'turbo frog shuffle', custom: true, bp: 'cardio' })
    expect(routine.ex.some(e => e.id === c.id && e.sets === 3)).toBe(true)
  })

  it('order: warm-up, intervals, stretch; the source video travels on the routine', () => {
    expect(routine.ex.map(e => e.id)).toEqual(['3094', '3905', '1160', built.customEx[0].id, '4300', '0945'])
    expect(routine.sourceUrl).toBe(RESULT.source.url)
    expect(routine.videoId).toBe('dQw4w9WgXcQ')
    expect(routine.name).toBe('20 MIN HIIT')
  })

  it('a lone stretch is not a superset of one', () => {
    const one = buildVideoRoutine(rows.filter(r => r.rid !== 'v6'), { labels: LABELS })
    const quad = one.routine.ex.find(e => e.id === '4300')
    expect(quad.sg).toBeUndefined(); expect(quad.sgName).toBeUndefined()
  })

  it('numbers are clamped', () => {
    const wild = buildVideoRoutine([{ ...rows[2], rounds: 999, sec: -5, rest: 'x' }], {})
    expect(wild.routine.ex[0]).toMatchObject({ sets: 20, sec: 1 })
    expect(wild.routine.ex[0].restSec).toBeUndefined()
  })
})

describe('into state', () => {
  it('adds once, then replaces the same video in place', () => {
    const S = { routines: [{ id: 'r0', name: 'Mine', ex: [] }], customEx: [] }
    const rows = draftRows(RESULT)
    const first = mergeVideoRoutine(S, buildVideoRoutine(rows, { source: RESULT.source, labels: LABELS }))
    expect(first.added).toBe(1)
    expect(S.routines).toHaveLength(2)
    expect(S.customEx).toHaveLength(1)
    const again = mergeVideoRoutine(S, buildVideoRoutine(rows.slice(0, 3), { name: 'Renamed', source: RESULT.source, labels: LABELS, customEx: S.customEx }))
    expect(again).toEqual({ updated: 1, id: first.id })
    expect(S.routines).toHaveLength(2)
    expect(S.routines[1].name).toBe('Renamed')
    expect(S.routines[1].ex).toHaveLength(3)
    expect(S.customEx).toHaveLength(1)
  })
})

it('a link that starts the video at a row', () => {
  expect(videoLinkAt('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 90.7)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90s')
  expect(videoLinkAt('', 3)).toBeNull()
})

it('two interval blocks with a finisher between them keep the video’s order', () => {
  const sec = (kind, rows) => ({ kind, rows })
  const row = (id, name, start) => ({ id, name, conf: 0.9, sec: 30, rest: 15, rounds: 2, occurrences: [{ start, dur: 30 }] })
  const result = { draft: { sections: [
    sec('interval', [row('a', 'Burpees', 0), row('b', 'Plank Jacks', 45)]),
    sec('other', [row('c', 'Wall Sit', 200)]),
    sec('interval', [row('d', 'Jump Squat', 300)]),
  ] } }
  const { routine } = buildVideoRoutine(draftRows(result), {})
  expect(routine.ex.map(e => e.id)).toEqual(['1160', '3930', '0734', '0514'])
})

describe('captions from a real video (B7-F2UcHmqk, a dumbbell workout)', () => {
  it('equipment workouts land on the equipment lift, via the importers’ aliases', () => {
    const m = matchVideoName('Goblet Squat')
    expect(m.id).toBe('1760')
    expect(EXIDX[m.id].n).not.toMatch(/clock/)
  })
  it('OCR debris comes off the ends of a name', async () => {
    const { tidyName } = await import('./import-video.js')
    expect(tidyName("Front Loaded Deadlif%‘!")).toBe('Front Loaded Deadlif')
    expect(tidyName('Calf Raises+')).toBe('Calf Raises')
    expect(tidyName('Wide Chest Press (feet At Go).')).toBe('Wide Chest Press (feet At Go)')
    expect(tidyName('"Push-Ups')).toBe('Push-Ups')
  })
})

describe('a dumbbell workout read off the screen (B7-F2UcHmqk)', () => {
  const kit = 'dumbbell'
  const name = id => EXIDX[id]?.n
  const m = n => matchVideoName(n, {}, { kit })
  it('takes the kit from the title', async () => {
    const { equipmentHint } = await import('./import-video.js')
    expect(equipmentHint('60 Minute Full Body Dumbbell Strength Workout [With Audio Cues]')).toBe('dumbbell')
    expect(equipmentHint('20 min Kettlebells HIIT')).toBe('kettlebell')
    expect(equipmentHint('No Equipment HIIT')).toBeNull()
  })
  it('the lift with the video’s kit, not the barbell one', () => {
    expect(name(m('Sumo Deadlift').id)).toBe('dumbbell sumo deadlift')
    expect(name(m('Side Squats').id)).toBe('dumbbell side squat')
    expect(name(m('Goblet Squat').id)).toBe('dumbbell goblet squat')
  })
  it('captions with a misread letter or a word the catalogue lacks still find their lift', () => {
    expect(name(m('Tricep Kicback').id)).toMatch(/dumbbell .*triceps kickback/)
    expect(name(m('Wide Bent Over Row').id)).toBe('dumbbell bent over row')
    expect(name(m('Alternating Single Leg Deadlift').id)).toBe('dumbbell single leg deadlift')
    expect(name(m('Alternating Curls').id)).toMatch(/dumbbell alternat\w* bicep/)
  })
  it('a guess is marked as one: lower confidence than an exact name', () => {
    expect(m('Wide Bent Over Row').conf).toBeLessThan(m('Sumo Deadlift').conf)
  })
  it('OCR noise matches nothing', () => {
    expect(m('Ey Ww').id).toBeNull()
    expect(m('Ak-Al').id).toBeNull()
  })
})
