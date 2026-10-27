// The importers in lib/import-apps.js, each against a small synthetic file in its app's documented
// format (the sources are named in import-apps.js). No real person's data in here.
import { describe, it, expect, afterEach } from 'vitest'
import { parseImportFile, mergeImportedRoutines, freshRoutines, liftosaurMatchName, liftoscriptDay, LIFTOFF } from './import-apps.js'
import { mergeImport, matchExercise } from './import-csv.js'
import { EXIDX } from './exercises.js'

const was = process.env.TZ
afterEach(() => { if (was === undefined) delete process.env.TZ; else process.env.TZ = was })
const inTz = (tz, fn) => { process.env.TZ = tz; return fn() }
const state = () => ({ workouts: [], routines: [], customEx: [], exWeights: {}, bodyweight: [] })
const entry = (w, id) => w.entries.find(e => e.id === id)
const hhmm = ms => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

/* --------------------------------------------------------------- Liftosaur CSV */
// History_exportAsCSV's header (src/models/history.ts), all 25 columns.
const LIFTOSAUR_HEAD = 'Workout DateTime,Program,Day Name,Exercise,Is Warmup Set?,Required Reps,Completed Reps,Is AMRAP?,Required RPE,Completed RPE,Log RPE?,Required Weight Value,Required Weight Unit,Completed Weight Value,Completed Weight Unit,Ask Weight?,Completed Reps Time,Target Muscles,Synergist Muscles,Notes,Completed Reps Left,Required Set Time Seconds,Is Overflow Set Time?,Completed Set Time Seconds,Completed Set Time Left Seconds'
const lrow = (when, ex, { warm = 0, reps = 5, done = reps, rpe = '', w = 100, u = 'kg', at = when, note = '', secs = '', day = 'Day 1' } = {}) =>
  [when, 'GZCLP', day, ex.includes(',') ? `"${ex}"` : ex, warm, reps, done, 0, '', rpe, 0, w, u, done === '' ? '' : w, done === '' ? '' : u, 0, at, '"Quadriceps"', '""', note, '', secs ? 60 : '', 0, secs, ''].join(',')
const LIFTOSAUR_CSV = [LIFTOSAUR_HEAD,
  lrow('2026-03-10T17:00:00.000Z', 'Squat', { warm: 1, w: 60, at: '2026-03-10T17:05:00.000Z' }),
  lrow('2026-03-10T17:00:00.000Z', 'Squat', { w: 100, rpe: 8, at: '2026-03-10T17:10:00.000Z', note: 'felt fast' }),
  lrow('2026-03-10T17:00:00.000Z', 'Squat', { w: 100, done: '', at: '' }),                 // planned, never done
  lrow('2026-03-10T17:00:00.000Z', 'Bench Press, Dumbbell', { w: 30, at: '2026-03-10T17:20:00.000Z' }),
  lrow('2026-03-10T17:00:00.000Z', 'Front Raise', { w: 10, at: '2026-03-10T17:30:00.000Z' }),
  lrow('2026-03-10T17:00:00.000Z', 'Plank', { reps: 1, done: 1, w: 0, secs: 45, at: '2026-03-10T17:40:00.000Z' }),
  lrow('2026-03-10T17:00:00.000Z', 'Zottman Shuffle', { w: 12, at: '2026-03-10T17:50:00.000Z' }),
  lrow('2026-03-12T17:00:00.000Z', 'Deadlift', { w: 225, u: 'lb', at: '2026-03-12T17:15:00.000Z', day: 'Day 2' }),
].join('\n')

describe('Liftosaur CSV', () => {
  it('reads sets, warm-ups, RPE, notes, a timed set and skips the set never done', () => {
    const p = inTz('Europe/Zurich', () => parseImportFile(LIFTOSAUR_CSV, { unit: 'kg' }))
    expect(p.source).toBe('Liftosaur')
    expect(p.workouts).toHaveLength(2)
    const [a, b] = p.workouts
    expect(a.name).toBe('GZCLP · Day 1')
    const squat = entry(a, '0043')
    expect(squat.sets).toHaveLength(2)
    expect(squat.sets[0].phase).toBe('warmup')
    expect(squat.sets[1]).toMatchObject({ w: 100, r: 5, rpe: 8 })
    expect(squat.note).toBe('felt fast')
    // The default equipment decides: a Liftosaur "Front Raise" is a dumbbell one.
    expect(entry(a, '0289').sets[0]).toMatchObject({ w: 30, r: 5 })
    expect(entry(a, '0310')).toBeTruthy()
    expect(entry(a, '0463').sets[0]).toMatchObject({ sec: 45 })
    expect(p.unmatchedNames).toEqual(['Zottman Shuffle'])
    // Per-row units: the lb deadlift lands in kg on a kg profile.
    expect(entry(b, '0032').sets[0].w).toBeCloseTo(102.06, 2)
    expect(p.mixedUnits).toBe(true)
    expect(p.warmups).toBe(1)
    expect(p.rpeSets).toBe(1)
  })

  it('reads the workout time on this device’s clock, never shifting the day through UTC', () => {
    const la = inTz('America/Los_Angeles', () => parseImportFile(LIFTOSAUR_CSV, { unit: 'kg' }))
    expect(la.workouts[0].d).toBe('2026-03-10')
    expect(hhmm(la.workouts[0].start)).toBe('10:00')      // 17:00 UTC is 10:00 in Los Angeles
    expect(hhmm(la.workouts[0].end)).toBe('10:50')        // the last set
    const late = LIFTOSAUR_CSV.replace(/2026-03-12T17:00:00.000Z/g, '2026-03-13T05:30:00.000Z').replace(/2026-03-12T17:15/, '2026-03-13T05:45')
    const la2 = inTz('America/Los_Angeles', () => parseImportFile(late, { unit: 'kg' }))
    expect(la2.workouts[1].d).toBe('2026-03-12')          // 22:30 on the 12th there, not the 13th
    const tokyo = inTz('Asia/Tokyo', () => parseImportFile(late, { unit: 'kg' }))
    expect(tokyo.workouts[1].d).toBe('2026-03-13')
  })

  it('imports a day once, however often the file comes in', () => {
    const S = state()
    const p = parseImportFile(LIFTOSAUR_CSV, { unit: 'kg' })
    expect(mergeImport(S, p).added).toBe(2)
    expect(mergeImport(S, parseImportFile(LIFTOSAUR_CSV, { unit: 'kg', customEx: S.customEx })).added).toBe(0)
    expect(S.workouts).toHaveLength(2)
    expect(S.customEx.filter(c => c.n === 'zottman shuffle')).toHaveLength(1)
  })

  it('says it could not read a file with Liftosaur’s header and no readable row', () => {
    const bad = [LIFTOSAUR_HEAD, 'yesterday,GZCLP,Day 1,Squat,0,5,5,0,,,0,100,kg,100,kg,0,,,,,,,,,'].join('\n')
    expect(parseImportFile(bad)).toEqual({ error: 'format', app: 'Liftosaur' })
  })
})

describe('Liftosaur names', () => {
  it('puts the equipment in front, the default one when the name leaves it out', () => {
    expect(liftosaurMatchName('Front Raise')).toBe('dumbbell Front Raise')
    expect(liftosaurMatchName('Squat')).toBe('barbell Squat')
    expect(liftosaurMatchName('Chest Press, Leverage Machine')).toBe('lever Chest Press')
    expect(liftosaurMatchName('Cable Crunch')).toBe('Cable Crunch')
    expect(liftosaurMatchName('Elliptical Machine')).toBe('Elliptical Machine')
    expect(liftosaurMatchName('Standing Row Rear Delt, Horizontal, With Rope')).toBe('cable Standing Row Rear Delt, Horizontal, With Rope')
    expect(liftosaurMatchName('My Own Thing')).toBe('My Own Thing')
  })

  it('maps the names checked by hand, and keeps the near misses the user’s own', () => {
    expect(matchExercise('Bench Dip')).toBe('0129')
    expect(matchExercise('dumbbell Shoulder Press')).toBe('0405')
    expect(matchExercise(liftosaurMatchName('Crunch'))).toBe('0274')
    expect(matchExercise(liftosaurMatchName('Hip Abductor'))).toBe('0597')
    expect(matchExercise('barbell Bench Press Wide Grip')).toBeNull()
    expect(matchExercise(liftosaurMatchName('Reverse Lunge'))).toBeNull()
    // The alias table still answers the established names the same way.
    expect(matchExercise('Bench Press (Barbell)')).toBe('0025')
    expect(matchExercise('Squat')).toBe('0043')
  })
})

/* -------------------------------------------------------------- Liftosaur JSON */
// The storage ImportExporter_exportStorage writes (types in src/types.ts), cut to what is read.
const at = iso => Date.parse(iso)
const set = (reps, w, unit = 'kg', extra = {}) => ({ vtype: 'set', index: 0, id: 'x', reps, completedReps: reps, completedWeight: { value: w, unit }, weight: { value: w, unit }, isCompleted: true, ...extra })
const LIFTOSAUR_JSON = JSON.stringify({
  version: '20260901000000',
  settings: { units: 'kg', exercises: { abc123: { vtype: 'custom_exercise', id: 'abc123', name: 'Grip Wizardry', isDeleted: false } } },
  stats: {},
  history: [
    {
      vtype: 'history_record', id: 1, date: '2026-04-02T16:00:00.000Z', startTime: at('2026-04-02T16:00:00.000Z'), endTime: at('2026-04-02T17:05:00.000Z'),
      programId: 'p1', programName: 'Basic', day: 1, dayName: 'Workout A',
      entries: [
        { vtype: 'history_entry', id: 'e1', index: 0, exercise: { id: 'benchPress', equipment: 'barbell' }, notes: 'paused',
          warmupSets: [set(5, 40)], sets: [set(5, 80, 'kg', { completedRpe: 9 }), set(5, 80, 'kg', { isCompleted: false, completedReps: undefined })] },
        { vtype: 'history_entry', id: 'e2', index: 1, exercise: { id: 'bicepCurl', equipment: 'cable' }, warmupSets: [], sets: [set(12, 50, 'lb')] },
        { vtype: 'history_entry', id: 'e3', index: 2, exercise: { id: 'abc123' }, warmupSets: [], sets: [set(1, 0, 'kg', { completedSetTimer: 30 })] },
      ],
    },
    { vtype: 'progress', id: 2, date: '2026-04-03T16:00:00.000Z', startTime: 0, programId: 'p1', programName: 'Basic', day: 2, dayName: 'B', entries: [] },
  ],
  programs: [
    { vtype: 'program', id: 'p1', name: 'Basic', planner: { vtype: 'planner', name: 'Basic', weeks: [
      { name: 'Week 1', days: [
        { name: 'Workout A', exerciseText: [
          '// pause on the chest',
          't1 / used: none / 3x5 / 60kg / progress: lp(2.5kg)',
          'Squat / ...t1',
          'Bench Press, Dumbbell / 3x8-12 / 20kg / warmup: none / superset: A',
          'Lateral Raise / 3x15 / superset: A',
          'Plank / 3x1 60s|30s',
          'Deadlift / 1x5, 1x3, 1x1 / 75% / progress: custom() {~',
          '  if (completedReps >= reps) { rm1 += 5lb }',
          '~}',
          'this line is not liftoscript',
        ].join('\n') },
        { name: 'Workout B', exerciseText: 'Overhead Press / 5x5 / 100lb' },
      ] },
      { name: 'Week 2', days: [{ name: 'Workout A', exerciseText: 'Squat / 5x3 / 70kg' }] },
    ] } },
    { vtype: 'program', id: 'old', name: 'Before the planner', days: [] },
  ],
})

describe('Liftosaur JSON', () => {
  it('reads history the way the CSV does: same names, units per set, timed sets, unfinished sets left out', () => {
    const p = inTz('Europe/Zurich', () => parseImportFile(LIFTOSAUR_JSON, { unit: 'kg' }))
    expect(p.source).toBe('Liftosaur')
    expect(p.workouts).toHaveLength(1)
    const w = p.workouts[0]
    expect(w).toMatchObject({ d: '2026-04-02', name: 'Basic · Workout A' })
    expect(hhmm(w.start)).toBe('18:00')
    expect(hhmm(w.end)).toBe('19:05')
    const bench = entry(w, '0025')
    expect(bench.sets.map(s => s.phase || s.w)).toEqual(['warmup', 80])
    expect(bench.sets[1].rpe).toBe(9)
    expect(bench.note).toBe('paused')
    // Not the default equipment: "Bicep Curl, Cable", 50 lb in kg.
    const curl = w.entries.find(e => e.id !== '0025' && e.sets[0].w)
    expect(curl.sets[0].w).toBeCloseTo(22.68, 2)
    expect(matchExercise(liftosaurMatchName('Bicep Curl, Cable'))).toBe(curl.id)
    expect(p.unmatchedNames).toEqual(['Grip Wizardry'])
    expect(w.entries.find(e => e.sets[0].sec).sets[0].sec).toBe(30)
  })

  it('turns week 1 of a planner program into routines and keeps the Liftoscript as notes', () => {
    const p = parseImportFile(LIFTOSAUR_JSON, { unit: 'kg' })
    const r = p.routines
    expect(r.routines.map(x => x.name)).toEqual(['Basic · Workout A', 'Basic · Workout B'])
    const [a, b] = r.routines
    const squat = a.ex.find(e => e.id === '0043')
    expect(squat).toMatchObject({ sets: 3, reps: 5, weight: 60, mode: 'reps', note: 'progress: lp(2.5kg)' })
    const db = a.ex.find(e => e.id === '0289')
    expect(db).toMatchObject({ sets: 3, reps: 8, weight: 20, warmupSets: 0, note: '3x8-12' })
    expect(db.sg).toBeTruthy()
    expect(a.ex.find(e => e.id === '0334').sg).toBe(db.sg)
    expect(a.ex.find(e => e.id === '0463')).toMatchObject({ sets: 3, sec: 60, mode: 'time' })
    const dl = a.ex.find(e => e.id === '0032')
    expect(dl).toMatchObject({ sets: 3, pyramid: [5, 3, 1], weight: 0 })
    expect(dl.note).toBe('1x5, 1x3, 1x1 / progress: custom() {…}')
    expect(r.skippedLines).toBe(2)          // the line that is not Liftoscript, the program without a planner
    expect(b.ex[0]).toMatchObject({ id: '0091', sets: 5, reps: 5, weight: 45.36 })
    // A profile in lb gets the numbers in lb.
    const lb = parseImportFile(LIFTOSAUR_JSON, { unit: 'lb' }).routines.routines[0].ex.find(e => e.id === '0043')
    expect(lb.weight).toBeCloseTo(132.28, 2)
  })

  it('adds routines once, sharing custom exercises with the history', () => {
    const S = state()
    const p = parseImportFile(LIFTOSAUR_JSON, { unit: 'kg' })
    mergeImport(S, p)
    expect(freshRoutines(S, p.routines)).toBe(2)
    expect(mergeImportedRoutines(S, p.routines)).toEqual({ added: 2, skipped: 0 })
    expect(S.routines[0].importKey).toBe('liftosaur|p1|0')
    const again = parseImportFile(LIFTOSAUR_JSON, { unit: 'kg', customEx: S.customEx })
    expect(freshRoutines(S, again.routines)).toBe(0)
    expect(mergeImportedRoutines(S, again.routines)).toEqual({ added: 0, skipped: 2 })
    expect(mergeImport(S, again).added).toBe(0)
    expect(S.routines).toHaveLength(2)
  })

  it('reads one day of Liftoscript on its own', () => {
    const day = liftoscriptDay('main: Squat[1-4] / 4x5, 1x5+ / 100kg', { unit: 'kg', resolve: () => '0043' })
    expect(day.ex[0]).toMatchObject({ id: '0043', sets: 5, reps: 5, weight: 100, note: '4x5, 1x5+' })
  })
})

/* ---------------------------------------------------------------------- Liftoff */
// liftoff-export-cli `workouts list --format json` (Post in cmd/workouts.go).
const LIFTOFF_POSTS = JSON.stringify([
  { id: 'post1', startedAt: '2026-05-04T03:30:00.000Z', postedAt: '2026-05-04T04:40:00.000Z', sessionDuration: '01 hours 06 minutes 01 seconds',
    sessionNotes: 'late one', bodyweight: 80, caloriesBurned: 0, prCount: 0, sessionDurationSeconds: 3961,
    exerciseData: [
      { exerciseIndex: 0, exerciseName: 'Machine Tricep Extension', exerciseId: 'x', exerciseTypes: 'WR', exerciseNotes: '', setsData: [
        { setIndex: 0, setType: 'warmup', inputOne: 30, inputTwo: 12 }, { setIndex: 1, setType: 'normal', inputOne: 50, inputTwo: 10 }] },
      { exerciseIndex: 1, exerciseName: 'Assisted Pull Ups', exerciseId: 'y', exerciseTypes: 'AB', exerciseNotes: 'band', setsData: [{ setIndex: 0, setType: 'normal', inputOne: 20, inputTwo: 8 }] },
      { exerciseIndex: 2, exerciseName: 'Walking', exerciseId: 'z', exerciseTypes: 'DD', exerciseNotes: '', setsData: [{ setIndex: 0, setType: 'normal', inputOne: 1.6, inputTwo: 1080 }] },
      { exerciseIndex: 3, exerciseName: 'Something new', exerciseId: 'q', exerciseTypes: 'ZZ', exerciseNotes: '', setsData: [{ setIndex: 0, setType: 'normal', inputOne: 1, inputTwo: 1 }] },
    ] },
])

describe('Liftoff (liftoff-export-cli JSON)', () => {
  it('reads workouts with their warm-ups, cardio and length, and imports weights as written', () => {
    const p = inTz('America/New_York', () => parseImportFile(LIFTOFF_POSTS, { unit: 'lb' }))
    expect(p.source).toBe(LIFTOFF)
    const w = p.workouts[0]
    expect(w.d).toBe('2026-05-03')                        // 23:30 the evening before, in New York
    expect(hhmm(w.start)).toBe('23:30')
    expect(w.end - w.start).toBe(3960000)                 // the minute the clock shows, 1 h 06
    expect(w.note).toBe('late one')
    expect(w.entries[0].sets.map(s => s.phase || s.w)).toEqual(['warmup', 50])
    expect(w.entries[1].sets[0]).toMatchObject({ w: 20, r: 8 })
    expect(w.entries[2].sets[0]).toMatchObject({ min: 18 })
    expect(p.skipped).toBe(1)                             // the type the CLI does not document
    expect(p.fileUnit).toBe('')
    expect(p.converted).toBe(false)
  })

  it('reads routines (presets) from `routines list --format json`', () => {
    const presets = JSON.stringify({ folders: [{ id: 'f', name: 'Push', presetsOrder: [], presets: [
      { id: 'r1', name: 'Push A', exerciseData: [
        { exerciseName: 'Dumbbell Bench Press', exerciseTypes: 'WR', superset: null, exerciseNotes: 'slow', setsData: [
          { setType: 'warmup', inputOne: 10, inputTwo: 10 }, { setType: 'normal', inputOne: 30, inputTwo: 8 }, { setType: 'normal', inputOne: 30, inputTwo: 8 }] },
      ] }] }], presetsWithoutFolder: [] })
    const p = parseImportFile(presets, { unit: 'kg' })
    expect(p.workouts).toEqual([])
    expect(p.routines.routines[0]).toMatchObject({ name: 'Push A', ex: [{ id: '0289', sets: 2, reps: 8, weight: 30, warmupSets: 1, note: 'slow' }] })
  })
})

/* ------------------------------------------------------------------- StrongLifts */
// Header as in the StrongLifts exports LiftLog tests against (tests/csv-import-test-files).
const SL_HEAD = 'Date (yyyy/mm/dd),Workout,Workout Name,Program Name,Body Weight (KG),Exercise,Sets×Reps,Sets×Time,Top Set (Reps×KG),e1RM (KG),Reps,Volume (KG),Workout Volume (KG),Duration (hours),Start Time (h:mm),End Time (h:mm),Notes,Set 1 (Reps),Set 1 (KG),Set 2 (Reps),Set 2 (KG),Set 3 (Reps),Set 3 (KG)'
const STRONGLIFTS = [SL_HEAD,
  '2026/02/03,1,"Workout A","Stronglifts 5×5",80,"Squat",5/5/-,,5×60,70,10,600,900,0.5,6:10 AM,6:40 AM,"",5,60,5,60,0,60',
  '2026/02/03,1,"Workout A","Stronglifts 5×5",80,"Bench Press",5/5/5,,5×40,46,15,600,900,0.5,6:10 AM,6:40 AM,"grip",5,40,5,40,5,40',
  '2026/02/03,2,"Workout B","Stronglifts 5×5",80,"Overhead Press",5/5/5,,5×30,35,15,450,450,0.3,11:50 PM,11:58 PM,"",5,30,5,30,5,30',
].join('\n')

describe('StrongLifts 5×5 CSV', () => {
  it('spreads the set columns into sets, leaves out the ones not done and keeps two workouts of a day apart', () => {
    const p = inTz('Pacific/Auckland', () => parseImportFile(STRONGLIFTS, { unit: 'kg' }))
    expect(p.source).toBe('StrongLifts')
    expect(p.workouts).toHaveLength(2)
    const [a, b] = p.workouts
    expect(a).toMatchObject({ d: '2026-02-03', name: 'Workout A' })
    expect(hhmm(a.start)).toBe('06:10')
    expect(hhmm(a.end)).toBe('06:40')
    expect(entry(a, '0043').sets).toHaveLength(2)
    expect(entry(a, '0025').note).toBe('grip')
    expect(b.d).toBe('2026-02-03')
    expect(hhmm(b.start)).toBe('23:50')
    expect(p.fileUnit).toBe('kg')
  })

  it('reads an lb export as lb', () => {
    const lb = STRONGLIFTS.replace(/Set (\d) \(KG\)/g, 'Set $1 (LB)')
    const p = parseImportFile(lb, { unit: 'kg' })
    expect(p.fileUnit).toBe('lb')
    expect(entry(p.workouts[0], '0043').sets[0].w).toBeCloseTo(27.22, 2)
  })

  it('fails clearly without set columns', () => {
    expect(parseImportFile('Date (yyyy/mm/dd),Workout,Exercise,Set 1 (Reps)\n2026/02/03,1,Squat,5')).toEqual({ error: 'format', app: 'StrongLifts' })
  })
})

/* ------------------------------------------------------------------------ Fitbod */
const FITBOD = ['Date,Exercise,Reps,Weight(kg),Duration(s),Distance(m),Incline,Resistance,isWarmup,Note,multiplier',
  '2026-01-05 23:30:00 -0800,Barbell Bench Press, 10,40.0,0.0,0.0,0.0,0.0,true,, 1.0',
  '2026-01-05 23:30:00 -0800,Barbell Bench Press, 5,80.0,0.0,0.0,0.0,0.0,false,"felt heavy, stop at 8", 1.0',
  '2026-01-05 23:30:00 -0800,Elliptical, 0,0.0,600.0,1500.0,0.0,0.0,false,, 0.0',
  '2026-01-05 23:30:00 -0800,Plank, 0,0.0,60.0,0.0,0.0,0.0,false,, 0.0',
  '2026-01-07 07:00:00 -0800,Machine Leg Press, 12,140.0,0.0,0.0,0.0,0.0,false,, 1.0',
].join('\n')

describe('Fitbod CSV', () => {
  it('reads warm-ups, cardio and holds, and keeps the day the phone showed', () => {
    for (const tz of ['UTC', 'Asia/Tokyo', 'America/Los_Angeles']) {
      const p = inTz(tz, () => parseImportFile(FITBOD, { unit: 'kg' }))
      expect(p.source).toBe('Fitbod')
      expect(p.workouts.map(w => w.d)).toEqual(['2026-01-05', '2026-01-07'])
      expect(hhmm(p.workouts[0].start)).toBe('23:30')
    }
    const p = parseImportFile(FITBOD, { unit: 'kg' })
    const w = p.workouts[0]
    expect(entry(w, '0025').sets.map(s => s.phase || s.w)).toEqual(['warmup', 80])
    expect(entry(w, '0025').note).toBe('felt heavy, stop at 8')
    expect(w.entries.find(e => e.sets[0].min).sets[0]).toMatchObject({ min: 10, speed: 9 })
    expect(entry(w, '0463').sets[0]).toMatchObject({ sec: 60 })
    expect(entry(p.workouts[1], '0739')).toBeTruthy()
    expect(p.fileUnit).toBe('kg')
  })

  it('reads the support team’s database extract (Android) too', () => {
    const p = parseImportFile('date,exercise_name,Reps,weight_kg,duration_seconds,distance_meters,Incline,Resistance,isWarmup\n2025-06-23,Seated Leg Curl,5,31.751465900000003,,,,,false\n', { unit: 'kg' })
    expect(p.workouts[0]).toMatchObject({ d: '2025-06-23' })
    expect(p.workouts[0].entries[0].sets[0]).toMatchObject({ w: 31.75, r: 5 })
  })
})

/* ------------------------------------------------------------------------- JEFIT */
const JEFIT = [
  '### WORKOUT SESSIONS ###',
  '_id,starttime,endtime,total_time',
  `7,${at('2026-06-01T17:00:00.000Z') / 1000},0,3600`,
  '',
  '### EXERCISE LOGS ###',
  '_id,belongsession,eid,ename,mydate,logs',
  '1,7,1,"Barbell Bench Press",2026-06-01,"60x10,70x8,x12"',
  '2,7,2,"Machine Leg Curl",2026-06-01,"40x12,junk"',
  '3,,3,"Dip",2026-06-03,"0x10"',
].join('\n')

describe('JEFIT CSV', () => {
  it('reads the logs section, sets as weight x reps, times from the session', () => {
    const p = inTz('Europe/Berlin', () => parseImportFile(JEFIT, { unit: 'kg' }))
    expect(p.source).toBe('JEFIT')
    expect(p.workouts).toHaveLength(2)
    const [a, b] = p.workouts
    expect(a.d).toBe('2026-06-01')
    expect(hhmm(a.start)).toBe('19:00')
    expect(a.end - a.start).toBe(3600000)
    expect(entry(a, '0025').sets.map(s => [s.w, s.r])).toEqual([[60, 10], [70, 8], [0, 12]])
    expect(entry(a, '0586').sets).toHaveLength(1)
    expect(p.skipped).toBe(1)
    expect(entry(b, '0814').sets[0]).toMatchObject({ w: 0, r: 10 })
    expect(p.fileUnit).toBe('')
  })

  it('keeps the logged day when the session start falls on another one here', () => {
    const p = inTz('Pacific/Kiritimati', () => parseImportFile(JEFIT, { unit: 'kg' }))   // UTC+14: the 2nd already
    expect(p.workouts[0].d).toBe('2026-06-01')
  })

  it('fails clearly when the logs section is not the one described', () => {
    expect(parseImportFile('### EXERCISE LOGS ###\nfoo,bar\n1,2')).toEqual({ error: 'format', app: 'JEFIT' })
  })
})

/* ---------------------------------------------------------------- the rest ---- */
describe('telling files apart', () => {
  it('leaves the CSVs it already read to the existing reader', () => {
    const strong = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE\n2026-01-02 10:00:00,Legs,1h,Squat (Barbell),1,100,5,0,0,,,\n'
    expect(parseImportFile(strong).source).toBe('Strong')
  })

  it('never imports a JSON it does not know, and points openGym’s own files to their importers', () => {
    expect(parseImportFile('{"hello":1}')).toEqual({ error: 'unrecognised' })
    expect(parseImportFile('[{"a":1}]')).toEqual({ error: 'unrecognised' })
    expect(parseImportFile('{ not json')).toEqual({ error: 'unrecognised' })
    expect(parseImportFile('[]')).toEqual({ error: 'empty' })
    expect(parseImportFile(JSON.stringify({ workouts: [], routines: [], bodyweight: [] }))).toEqual({ error: 'opengym' })
    expect(parseImportFile(JSON.stringify({ opengym_plan: 1, routines: [] }))).toEqual({ error: 'opengym' })
  })

  it('points every alias at an exercise that exists', () => {
    for (const n of ['Machine Hip Abductor', 'Dumbbell Alternating Hammer Curl', 'Cable Rope Tricep Pushdown', 'Machine Assisted Pull-Up', 'Air Squats']) {
      const id = matchExercise(n)
      expect(id, n).toBeTruthy()
      expect(EXIDX[id]).toBeTruthy()
    }
  })
})
