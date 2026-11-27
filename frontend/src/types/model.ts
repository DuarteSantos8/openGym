// The app's data, as types (docs/dev/TYPESCRIPT.md). This is the shape the profile document has
// on every path: the store, sync, backups, the watch bridge, the MCP server. It grows as files move
// to TypeScript: a field goes in when a converted file reads it, with the meaning the code gives it.
// Older profiles miss newer fields, so almost everything is optional; readers fall back as the
// JavaScript always did. The index signatures keep the parts not described yet usable as `unknown`.

/** A calendar day, 'YYYY-MM-DD', in the profile's own time zone. */
export type ISODate = string
/** Milliseconds since the epoch. */
export type Millis = number
export type WeightUnit = 'kg' | 'lb'

/** Prep or the real thing (lib/workout-model.js phaseForSet). Legacy rows say `warmup: true`. */
export type SetPhase = 'work' | 'warmup'
/** What shape a row is beyond warm-up/work (docs/dev/SET_TYPES.md). */
export type SetShape = 'straight' | 'dropset' | 'restpause'
/** How an exercise is measured: weight × reps, a timed hold, cardio, or a carry over metres. */
export type SetMode = 'reps' | 'time' | 'cardio' | 'distance'

/** A weight drop after a drop set's main set: extra work on top of the row's own w × r. */
export interface Drop { w?: number | null; r?: number | null }
/** A rest-pause burst: a breakdown of the row's own `r`, never extra on top of it. */
export interface Cluster { r?: number | null; restSec?: number | null }

/** One set row in a workout entry. */
export interface SetRow {
  /** Weight in the profile's unit; null for bodyweight or not entered. */
  w?: number | null
  /** Reps. For a rest-pause row the total across every burst. */
  r?: number | null
  /** Seconds, for timed holds (and cardio minutes are stored as seconds too). */
  sec?: number | null
  /** Metres, for carries and sleds. */
  m?: number | null
  done?: boolean
  phase?: SetPhase | string
  /** Legacy warm-up flag, read only when `phase` is missing. */
  warmup?: boolean
  type?: SetShape | string
  drops?: Drop[]
  clusters?: Cluster[]
  /** A cluster set rides on the rest-pause shape with this flag for its name. */
  cluster?: boolean
  rir?: number | null
  rpe?: number | null
  failure?: boolean
  [key: string]: unknown
}

/** One exercise in a workout, with its sets. `id` is the exercise's catalogue or custom id. */
export interface Entry {
  id: string
  sets: SetRow[]
  note?: string
  [key: string]: unknown
}

/** A logged (or running) session. */
export interface Workout {
  id: string
  /** The day it counts for. */
  d: ISODate
  start?: Millis
  end?: Millis
  name?: string
  /** Body weight that day, when known. */
  bw?: number | null
  /** The routines it was started from; empty for freestyle. */
  routineIds?: string[]
  /** Before routineIds (one routine per session). */
  routineId?: string | null
  note?: string
  entries: Entry[]
  /** Volume as Finish stores it. */
  vol?: number
  [key: string]: unknown
}

/** An exercise in a routine, with its plan. */
export interface RoutineSlot {
  id: string
  sets?: number
  reps?: number
  repsMin?: number
  setsMax?: number
  sec?: number
  m?: number
  note?: string
  [key: string]: unknown
}

export interface Routine {
  id: string
  name: string
  emoji?: string | null
  ex: RoutineSlot[]
  /** Plan's folder for it (a block, a goal, or Archive). */
  folder?: string | null
  [key: string]: unknown
}

/** 0 (Sunday) to 6, as Date#getDay. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** The profile document (store/useStore.js DEF overlaid with what was saved). */
export interface State {
  unit?: WeightUnit
  /** First day of the week: 1 (Monday, the default) or 0 (Sunday). */
  weekStart?: number
  workouts: Workout[]
  routines: Routine[]
  /** Weekday plan: which routines each weekday holds. */
  week?: Partial<Record<Weekday | `${Weekday}`, string[]>>
  /** Per-date overrides: a routine id, 'rest', or a pinned queue session. */
  dayPlan?: Record<ISODate, string>
  /** The running session, if any. */
  active?: Workout | null
  /** The week and month recap card (Settings → Look & Home); false switches it off. */
  recap?: boolean
  /** The recap its × put away, by its key ('w:YYYY-MM-DD' or 'm:YYYY-MM'). */
  recapSeen?: string | null
  [key: string]: unknown
}
