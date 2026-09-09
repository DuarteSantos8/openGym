import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  matchHevyTemplate, buildHevyExerciseMap, parseHevyWorkouts, parseHevyBodyweight,
  parseHevyRoutines, mergeHevyRoutines, localWhen, importHevyData, HevyApiError, HEVY_ID_MAP,
} from './import-hevy.js'
import { EXIDX } from './exercises.js'
import { mergeImport } from './import-csv.js'

const TEMPLATES = [
  {
    id: '3303376C', title: 'Elliptical Trainer', type: 'distance_duration',
    primary_muscle_group: 'cardio', secondary_muscle_groups: [], equipment: 'machine', is_custom: false,
  },
  {
    id: '4E5257DE', title: 'Lat Pulldown - Close Grip (Cable)', type: 'weight_reps',
    primary_muscle_group: 'lats', secondary_muscle_groups: [], equipment: 'machine', is_custom: false,
  },
  {
    id: 'DEADBEEF', title: 'My Invented Landmine Twist', type: 'weight_reps',
    primary_muscle_group: 'abdominals', secondary_muscle_groups: [], equipment: 'other', is_custom: true,
  },
  {
    id: '99D5F10E', title: 'Ab Wheel', type: 'reps_only',
    primary_muscle_group: 'abdominals', secondary_muscle_groups: [], equipment: 'other', is_custom: false,
  },
]

const WORKOUT = {
  id: 'w1',
  title: 'Oberkörper 2',
  start_time: '2026-08-25T10:10:24+00:00',
  end_time: '2026-08-25T11:10:08+00:00',
  exercises: [
    {
      index: 0,
      title: 'Crosstrainer', // localized — must NOT drive the match
      exercise_template_id: '3303376C',
      sets: [{
        index: 0, type: 'normal', weight_kg: null, reps: null,
        distance_meters: 480, duration_seconds: 180, rpe: null,
      }],
    },
    {
      index: 1,
      title: 'Latzug - Enger Griff (Kabel)',
      exercise_template_id: '4E5257DE',
      sets: [
        { index: 0, type: 'warmup', weight_kg: 25, reps: 15, distance_meters: null, duration_seconds: null, rpe: null },
        { index: 1, type: 'normal', weight_kg: 52, reps: 15, distance_meters: null, duration_seconds: null, rpe: 8 },
        { index: 2, type: 'normal', weight_kg: 52, reps: 10, distance_meters: null, duration_seconds: null, rpe: null },
      ],
    },
    {
      index: 2,
      title: 'Meine Eigenkreation',
      exercise_template_id: 'DEADBEEF',
      sets: [
        { index: 0, type: 'normal', weight_kg: 20, reps: 12, distance_meters: null, duration_seconds: null, rpe: null },
      ],
    },
  ],
}

describe('HEVY_ID_MAP', () => {
  it('only points at real catalogue ids', () => {
    for (const id of Object.values(HEVY_ID_MAP)) {
      expect(EXIDX[id], `catalogue missing ${id}`).toBeTruthy()
    }
  })

  // Real import leftovers: same lifts under Hevy's naming. Map lookup is the
  // only resolution path — titles are never guessed at runtime.
  const PINNED = {
    B5D3A742: '0410', // Bulgarian Split Squat (Dumbbell)
    '914F3A96': '0327', // Chest Supported Incline Row (Dumbbell)
    '98237BA2': '0826', // Knee Raise Parallel Bars
    '4E5257DE': '2616', // Lat Pulldown - Close Grip (Cable)
    C315DC2A: '0602', // Rear Delt Reverse Fly (Cable)
    FFDA283B: '0381', // Reverse Lunge (Dumbbell)
    '8BAB2735': '0318', // Seated Incline Curl (Dumbbell)
    '9237BAD1': '0603', // Seated Shoulder Press (Machine)
    B05C2C29: '0605', // Single Leg Standing Calf Raise (Machine)
    '3303376C': '2141', // Elliptical Trainer
    '99D5F10E': '0857', // Ab Wheel
  }
  for (const [hid, want] of Object.entries(PINNED)) {
    it(`maps ${hid} → ${want} (${EXIDX[want]?.n})`, () => {
      expect(HEVY_ID_MAP[hid]).toBe(want)
      expect(matchHevyTemplate({ id: hid, title: 'ignored localized name' })).toBe(want)
    })
  }

  it('leaves catalogue gaps unmapped (import as custom)', () => {
    for (const id of ['68CE0B9B', '0222DB42', 'D1CD146F']) {
      expect(HEVY_ID_MAP[id]).toBeUndefined()
      expect(matchHevyTemplate({ id, title: 'whatever' })).toBeNull()
    }
  })
})

describe('matchHevyTemplate', () => {
  it('is map-only — title never overrides the id', () => {
    expect(matchHevyTemplate({ id: '3303376C', title: 'Totally Wrong Name' })).toBe('2141')
    expect(matchHevyTemplate({ id: 'DEADBEEF', title: 'Bench Press' })).toBeNull()
  })
})

describe('parseHevyWorkouts', () => {
  it('maps by template id, not the localized workout title', () => {
    const parsed = parseHevyWorkouts([WORKOUT], TEMPLATES, { unit: 'kg' })
    expect(parsed.error).toBeUndefined()
    expect(parsed.source).toBe('Hevy')
    expect(parsed.workouts).toHaveLength(1)

    const entries = parsed.workouts[0].entries
    const elliptical = entries.find(e => e.id === '2141')
    expect(elliptical).toBeTruthy()
    expect(elliptical.sets[0]).toMatchObject({ min: 3, done: true })

    const pulldown = entries.find(e => e.id === '2616')
    expect(pulldown).toBeTruthy()
    expect(pulldown.sets[0]).toMatchObject({ w: 25, r: 15, phase: 'warmup' })
    expect(pulldown.sets[1]).toMatchObject({ w: 52, r: 15, rpe: 8 })
    expect(pulldown.topW).toBe(52)
    expect(parsed.warmups).toBe(1)
    expect(parsed.rpeSets).toBe(1)

    const custom = entries.find(e => String(e.id).startsWith('im'))
    expect(custom).toBeTruthy()
    expect(parsed.customEx.some(c => c.id === custom.id && c.n === 'my invented landmine twist')).toBe(true)
    expect(parsed.customEx.find(c => c.id === custom.id).bp).toBe('waist')
    expect(parsed.unmatchedNames).toContain('My Invented Landmine Twist')
  })

  it('converts kg weights into a lb profile', () => {
    const parsed = parseHevyWorkouts([WORKOUT], TEMPLATES, { unit: 'lb' })
    const pulldown = parsed.workouts[0].entries.find(e => e.id === '2616')
    expect(pulldown.sets.find(s => s.r === 15 && !s.phase).w).toBeCloseTo(114.6, 0)
    expect(parsed.converted).toBe(true)
  })

  it('merges two Hevy sessions on the same local day', () => {
    const a = { ...WORKOUT, id: 'a', title: 'AM', exercises: [WORKOUT.exercises[0]] }
    const b = {
      ...WORKOUT, id: 'b', title: 'PM',
      start_time: '2026-08-25T18:00:00+00:00',
      end_time: '2026-08-25T19:00:00+00:00',
      exercises: [WORKOUT.exercises[1]],
    }
    const parsed = parseHevyWorkouts([a, b], TEMPLATES, { unit: 'kg' })
    expect(parsed.workouts).toHaveLength(1)
    expect(parsed.workouts[0].entries.length).toBeGreaterThanOrEqual(2)
  })
})

describe('parseHevyBodyweight', () => {
  it('reads weigh-ins in the profile unit', () => {
    const parsed = parseHevyBodyweight([
      { id: 1, date: '2026-08-23', weight_kg: 83.2, created_at: '2026-08-23T18:22:48.070Z' },
    ], { unit: 'kg' })
    expect(parsed.bodyweight).toEqual([{ d: '2026-08-23', w: 83.2, t: expect.any(Number) }])
  })
})

describe('mergeImport with Hevy payloads', () => {
  it('adds workouts and skips days that already exist', () => {
    const parsed = parseHevyWorkouts([WORKOUT], TEMPLATES, { unit: 'kg' })
    const S = { workouts: [], customEx: [], exWeights: {}, bodyweight: [] }
    const first = mergeImport(S, parsed)
    expect(first.added).toBe(1)
    expect(S.customEx.length).toBe(1)
    const second = mergeImport(S, parsed)
    expect(second.added).toBe(0)
    expect(S.workouts).toHaveLength(1)
  })
})

describe('localWhen', () => {
  it('parses an ISO timestamp into a local calendar day', () => {
    const w = localWhen('2026-08-25T10:10:24+00:00')
    expect(w.d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(w.t).toBeGreaterThanOrEqual(0)
  })
})

describe('importHevyData', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('pages templates and workouts, never persists the key', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url: String(url), key: opts.headers['api-key'] })
      const u = String(url)
      if (u.includes('/exercise_templates')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, exercise_templates: TEMPLATES }) }
      }
      if (u.includes('/workouts')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, workouts: [WORKOUT] }) }
      }
      if (u.includes('/routines')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, routines: [] }) }
      }
      if (u.includes('/body_measurements')) {
        return { ok: true, status: 200, json: async () => ({ page: 1, page_count: 1, body_measurements: [] }) }
      }
      return { ok: false, status: 404, json: async () => ({}) }
    }))

    const result = await importHevyData('test-key-not-stored', { unit: 'kg' })
    expect(result.workouts.workouts).toHaveLength(1)
    expect(result.routines.routines).toHaveLength(0)
    expect(result.bodyweight.bodyweight).toHaveLength(0)
    expect(calls.every(c => c.key === 'test-key-not-stored')).toBe(true)
  })

  it('surfaces a refused key as HevyApiError auth', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })))
    await expect(importHevyData('bad')).rejects.toMatchObject({ name: 'HevyApiError', message: 'auth' })
  })
})

describe('parseHevyRoutines', () => {
  const ROUTINE = {
    id: 'r1',
    title: 'Oberkörper 2',
    exercises: [
      {
        title: 'Crosstrainer',
        exercise_template_id: '3303376C',
        superset_id: null,
        sets: [{ type: 'normal', weight_kg: null, reps: null, distance_meters: 480, duration_seconds: 180 }],
      },
      {
        title: 'Latzug',
        exercise_template_id: '4E5257DE',
        superset_id: 1,
        sets: [
          { type: 'warmup', weight_kg: 25, reps: 15 },
          { type: 'normal', weight_kg: 52, reps: 15 },
          { type: 'normal', weight_kg: 52, reps: 12 },
          { type: 'normal', weight_kg: 52, reps: 10 },
        ],
      },
      {
        title: 'Row partner',
        exercise_template_id: '914F3A96', // chest supported incline row → 0327
        superset_id: 1,
        sets: [
          { type: 'normal', weight_kg: 20, reps: 12 },
          { type: 'normal', weight_kg: 20, reps: 12 },
        ],
      },
    ],
  }

  it('builds openGym routine configs from Hevy sets', () => {
    const parsed = parseHevyRoutines([ROUTINE], TEMPLATES, { unit: 'kg' })
    expect(parsed.routines).toHaveLength(1)
    expect(parsed.routines[0].name).toBe('Oberkörper 2')
    expect(parsed.exerciseCount).toBe(3)

    const [cardio, pull, row] = parsed.routines[0].ex
    expect(cardio.id).toBe('2141')
    expect(cardio).toMatchObject({ sets: 1, min: 3 })
    expect(pull.id).toBe('2616')
    expect(pull).toMatchObject({ sets: 3, reps: 15, weight: 52, warmupSets: 1 })
    expect(row.id).toBe('0327')
    expect(pull.sg).toBeTruthy()
    expect(pull.sg).toBe(row.sg)
  })

  it('mergeHevyRoutines replaces a routine it imported before instead of duplicating it', () => {
    const parsed = parseHevyRoutines([ROUTINE], TEMPLATES, { unit: 'kg' })
    const S = { routines: [], customEx: [] }
    expect(mergeHevyRoutines(S, parsed)).toEqual({ added: 1, updated: 0 })
    expect(S.routines).toHaveLength(1)
    expect(S.routines[0].hevyId).toBe(ROUTINE.id)
    const firstId = S.routines[0].id
    S.routines[0].name = 'renamed locally'
    expect(mergeHevyRoutines(S, parsed)).toEqual({ added: 0, updated: 1 })
    expect(S.routines).toHaveLength(1)
    expect(S.routines[0].id).toBe(firstId)
    expect(S.routines[0].name).toBe(ROUTINE.title)
  })

  it('mergeHevyRoutines still adds a routine that carries no Hevy id', () => {
    const parsed = parseHevyRoutines([{ ...ROUTINE, id: undefined }], TEMPLATES, { unit: 'kg' })
    const S = { routines: [], customEx: [] }
    mergeHevyRoutines(S, parsed); mergeHevyRoutines(S, parsed)
    expect(S.routines).toHaveLength(2)
  })
})

describe('buildHevyExerciseMap', () => {
  it('indexes every template id from the static map', () => {
    const map = buildHevyExerciseMap(TEMPLATES)
    expect(map.get('3303376C')).toBe('2141')
    expect(map.get('4E5257DE')).toBe('2616')
    expect(map.get('DEADBEEF')).toBeNull()
    expect(map.size).toBe(TEMPLATES.length)
  })
})
