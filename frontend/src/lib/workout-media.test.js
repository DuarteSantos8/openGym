// The photos and videos of a logged workout: the list on the saved record (add, remove, cap,
// stamp), what the sync merge keeps of it, what the history editor does with it, and the places
// that must never carry it (copy as text, a routine saved from the workout, a plan file).
import { describe, expect, it } from 'vitest'
import { addWorkoutMedia, removeWorkoutMedia } from './workout-media.js'
import { WORKOUT_MEDIA_MAX, workoutMediaOf, referencedHashes, referencedFiles, stateMediaRefs } from './media-refs.js'
import { mergeStates } from './sync-merge.js'
import { editCompletedSession, saveWorkoutEdit } from './session-edit.js'
import { workoutText } from './workout-text.js'
import { saveSessionAsRoutine } from './session-routines.js'
import { buildPlanBundle } from './plan-share.js'

const H = n => String(n).repeat(64).slice(0, 64)
const photo = (h, poster) => ({ kind: 'image', hash: h, mime: 'image/webp', size: 1000, width: 800, height: 600, ...(poster ? { poster: { hash: poster, mime: 'image/webp', size: 100, width: 480, height: 360 } } : {}), at: 1 })
const clip = (h, poster) => ({ kind: 'video', hash: h, mime: 'video/mp4', size: 500000, width: 1280, height: 720, dur: 8, codec: 'avc1', ...(poster ? { poster: { hash: poster, mime: 'image/webp', size: 100, width: 480, height: 270 } } : {}), at: 2 })
const set = (w, r) => ({ w, r, done: true })
const workout = over => ({ id: 'w1', d: '2026-09-20', start: 1000, end: 4000, name: 'Push', routineIds: [], routineId: null, entries: [{ id: 'bench', sets: [set(60, 5)], topW: 60, target: null }], exposures: [{ exposureId: 'x1', exerciseId: 'bench', mode: 'reps', performance: { sets: [{ role: 'work', status: 'completed', observations: [{ metric: 'repetitions', value: 5 }], resistance: { kind: 'external-load', value: 60 } }] } }], prs: [], vol: 300, ...over })
const state = (...ws) => ({ unit: 'kg', workouts: ws, routines: [], customEx: [], exWeights: {}, bodyweight: [], active: null })

describe('addWorkoutMedia / removeWorkoutMedia', () => {
  it('adds a normalised ref to the saved record and stamps it', () => {
    const S = state(workout())
    expect(addWorkoutMedia(S, { id: 'w1' }, { ...photo(H(1), H(2)), name: 'IMG_1.HEIC' }, 777)).toBe('added')
    expect(S.workouts[0].media).toEqual([photo(H(1), H(2))])
    expect(S.workouts[0]._ts).toBe(777)
  })

  it('finds a workout from before ids by its day and start', () => {
    const legacy = workout({ id: undefined })
    delete legacy.id
    const S = state(legacy)
    expect(addWorkoutMedia(S, { d: legacy.d, start: legacy.start }, photo(H(1)), 5)).toBe('added')
    expect(S.workouts[0].media).toHaveLength(1)
    expect(S.workouts[0].id).toBeUndefined()
  })

  it('refuses a malformed ref, the same file twice, a deleted workout and a seventh item — without stamping', () => {
    const S = state(workout({ _ts: 3 }))
    expect(addWorkoutMedia(S, { id: 'w1' }, { ...photo(H(1)), mime: 'image/svg+xml' }, 9)).toBe('invalid')
    expect(addWorkoutMedia(S, { id: 'nope' }, photo(H(1)), 9)).toBe('gone')
    expect(S.workouts[0]._ts).toBe(3)
    for (let i = 0; i < WORKOUT_MEDIA_MAX; i++) expect(addWorkoutMedia(S, { id: 'w1' }, photo(H(i)), 10 + i)).toBe('added')
    expect(workoutMediaOf(S.workouts[0])).toHaveLength(WORKOUT_MEDIA_MAX)
    const stamp = S.workouts[0]._ts
    expect(addWorkoutMedia(S, { id: 'w1' }, photo(H(0)), 99)).toBe('dup')
    expect(addWorkoutMedia(S, { id: 'w1' }, photo(H(9)), 99)).toBe('full')
    expect(S.workouts[0].media).toHaveLength(WORKOUT_MEDIA_MAX)
    expect(S.workouts[0]._ts).toBe(stamp)
  })

  it('removes one by hash, stamps, and drops the field with the last one', () => {
    const S = state(workout({ media: [photo(H(1)), clip(H(2), H(3))] }))
    expect(removeWorkoutMedia(S, { id: 'w1' }, H(1), 50)).toBe(true)
    expect(S.workouts[0].media.map(m => m.hash)).toEqual([H(2)])
    expect(S.workouts[0]._ts).toBe(50)
    expect(removeWorkoutMedia(S, { id: 'w1' }, H(1), 60)).toBe(false)
    expect(S.workouts[0]._ts).toBe(50)
    expect(removeWorkoutMedia(S, { id: 'w1' }, H(2), 70)).toBe(true)
    expect('media' in S.workouts[0]).toBe(false)
    // …and its files are no longer referenced: the GCs take them (after the server's grace).
    expect(referencedHashes(S).size).toBe(0)
  })

  it('edits the list as it stands: a ref it cannot show, one past the cap and unknown fields stay on the record', () => {
    const future = { kind: 'model3d', hash: H(7), mime: 'model/gltf-binary', size: 10, width: 1, height: 1, at: 1 }
    const tagged = { ...photo(H(1)), caption: 'front' }
    const many = [tagged, future, ...[2, 3, 4, 5, 6, 8].map(n => photo(H(n)))]   // seven that show
    const S = state(workout({ _ts: 3, media: structuredClone(many) }))
    expect(workoutMediaOf(S.workouts[0])).toHaveLength(WORKOUT_MEDIA_MAX)
    expect(addWorkoutMedia(S, { id: 'w1' }, photo(H(9)), 9)).toBe('full')
    expect(addWorkoutMedia(S, { id: 'w1' }, photo(H(8)), 9)).toBe('dup')   // past the cap, still on it
    expect(S.workouts[0].media).toEqual(many)
    expect(removeWorkoutMedia(S, { id: 'w1' }, H(3), 10)).toBe(true)
    expect(S.workouts[0].media).toEqual(many.filter(m => m.hash !== H(3)))
    // The one past the cap moves up into view; the unknown kind and the caption are still there.
    expect(workoutMediaOf(S.workouts[0]).map(m => m.hash)).toEqual([1, 2, 4, 5, 6, 8].map(H))
    expect(S.workouts[0].media[0].caption).toBe('front')
    // With room again, an add goes on the end of the raw list.
    expect(removeWorkoutMedia(S, { id: 'w1' }, H(4), 11)).toBe(true)
    expect(addWorkoutMedia(S, { id: 'w1' }, photo(H(9)), 12)).toBe('added')
    expect(S.workouts[0].media.at(-1)).toEqual(photo(H(9)))
    expect(S.workouts[0].media[1]).toEqual(future)
  })
})

describe('workoutMediaOf / the state walk', () => {
  it('shows only valid refs, each file once, at most six', () => {
    const w = workout({ media: [photo(H(1)), 'x', null, { hash: 'bad' }, photo(H(1)), ...[2, 3, 4, 5, 6, 7, 8].map(n => photo(H(n)))] })
    expect(workoutMediaOf(w).map(m => m.hash)).toEqual([1, 2, 3, 4, 5, 6].map(H))
    expect(workoutMediaOf(workout({ media: photo(H(1)) }))).toEqual([])
    expect(workoutMediaOf(null)).toEqual([])
  })

  it('referencedFiles lists a workout\'s posters first, with what a download is checked against', () => {
    const S = state(workout({ media: [clip(H(1), H(2)), photo(H(3))] }))
    expect(referencedFiles(S)).toEqual([
      { hash: H(2), mime: 'image/webp', size: 100, poster: true },
      { hash: H(1), mime: 'video/mp4', size: 500000, poster: false },
      { hash: H(3), mime: 'image/webp', size: 1000, poster: false },
    ])
  })

  it('the session in progress is not walked (media only live on saved workouts)', () => {
    expect(stateMediaRefs({ active: { media: [photo(H(1))] } })).toEqual([])
  })
})

describe('the sync keeps a media edit', () => {
  it('a photo added on the phone survives the desktop copy that is newer as a whole', () => {
    const base = state(workout({ _ts: 10 }))
    const phone = structuredClone(base)
    addWorkoutMedia(phone, { id: 'w1' }, photo(H(1)), 200)
    phone._ts = 200
    const desktop = structuredClone(base)
    desktop.bodyweight = [{ d: '2026-09-21', w: 80, t: 300 }]
    desktop._ts = 300
    for (const merged of [mergeStates(desktop, phone), mergeStates(phone, desktop)]) {
      expect(merged.workouts[0].media.map(m => m.hash)).toEqual([H(1)])
      expect(merged.bodyweight).toHaveLength(1)
    }
  })

  it('a photo added on one device survives the other device\'s later note edit of the same workout', () => {
    const base = state(workout({ _ts: 10 }))
    const phone = structuredClone(base)
    addWorkoutMedia(phone, { id: 'w1' }, photo(H(1)), 200)
    phone._ts = 200
    const desktop = structuredClone(base)
    desktop.workouts[0].note = 'Felt strong'
    desktop.workouts[0]._ts = 300   // stampWorkout: the note edit is the later edit of this workout
    desktop._ts = 300
    for (const merged of [mergeStates(desktop, phone), mergeStates(phone, desktop)]) {
      expect(merged.workouts[0].note).toBe('Felt strong')
      expect(merged.workouts[0].media.map(m => m.hash)).toEqual([H(1)])
      expect(merged.workouts[0]._ts).toBe(300)
    }
  })

  it('a photo on each device: both are kept, the later-edited copy\'s first', () => {
    const base = state(workout({ _ts: 10, media: [photo(H(1))] }))
    const phone = structuredClone(base)
    addWorkoutMedia(phone, { id: 'w1' }, photo(H(2)), 200)
    phone._ts = 200
    const desktop = structuredClone(base)
    addWorkoutMedia(desktop, { id: 'w1' }, clip(H(3), H(4)), 300)
    desktop._ts = 300
    for (const merged of [mergeStates(desktop, phone), mergeStates(phone, desktop)]) {
      expect(merged.workouts[0].media.map(m => m.hash)).toEqual([H(1), H(3), H(2)])
      expect(merged.workouts[0].media[1]).toEqual(clip(H(3), H(4)))
    }
  })

  it('signing in (prefer) keeps the preferred version but not at the cost of the other\'s photo', () => {
    const base = state(workout({ _ts: 10 }))
    const device = structuredClone(base)
    addWorkoutMedia(device, { id: 'w1' }, photo(H(1)), 200)
    const server = structuredClone(base)
    server.workouts[0].note = 'server'
    const merged = mergeStates(server, device, { prefer: 'a' })
    expect(merged.workouts[0].note).toBe('server')
    expect(merged.workouts[0].media.map(m => m.hash)).toEqual([H(1)])
  })

  it('a removal inside the conflict window comes back from the copy that still lists it (resurrected beats lost); one already pulled sticks', () => {
    const base = state(workout({ _ts: 10, media: [photo(H(1)), photo(H(2))] }))
    const a = structuredClone(base)
    removeWorkoutMedia(a, { id: 'w1' }, H(1), 200)
    a._ts = 200
    const b = structuredClone(base)
    b._ts = 400
    expect(mergeStates(b, a).workouts[0].media.map(m => m.hash)).toEqual([H(2), H(1)])
    // Once the other device has the removal, neither copy lists it and it stays gone.
    const pulled = structuredClone(a)
    pulled.bodyweight = [{ d: '2026-09-21', w: 80, t: 500 }]
    pulled._ts = 500
    expect(mergeStates(pulled, a).workouts[0].media.map(m => m.hash)).toEqual([H(2)])
  })

  it('a media edit does not count as an edit of the sets (the kept loads are left alone)', () => {
    const base = state(workout({ _ts: 10 }))
    base.exWeights = { bench: { w: 60, d: '2026-09-20' } }
    const a = structuredClone(base)
    addWorkoutMedia(a, { id: 'w1' }, photo(H(1)), 200)
    const b = structuredClone(base)
    b.exWeights = { bench: { w: 65, d: '2026-09-22' } }
    b._ts = 300
    expect(mergeStates(b, a).exWeights.bench.w).toBe(65)
  })
})

describe('the history editor (#203) leaves a workout\'s media on the record', () => {
  it('the editor\'s copy carries none, and Save keeps the record\'s', () => {
    const S = state(workout({ media: [photo(H(1))] }))
    editCompletedSession(S, 'w1')
    expect(S.active.media).toBeUndefined()
    S.active.entries[0].sets[0].r = 6
    const saved = saveWorkoutEdit(S, 500)
    expect(saved.media.map(m => m.hash)).toEqual([H(1)])
    expect(referencedHashes(S)).toEqual(new Set([H(1)]))
  })

  it('a photo removed from the detail sheet while the editor was open stays removed', () => {
    const S = state(workout({ media: [photo(H(1)), photo(H(2))] }))
    editCompletedSession(S, 'w1')
    removeWorkoutMedia(S, { id: 'w1' }, H(1), 400)
    S.active.entries[0].sets[0].r = 6
    const saved = saveWorkoutEdit(S, 500)
    expect(saved.media.map(m => m.hash)).toEqual([H(2)])
  })
})

describe('workout media never leave through the side doors', () => {
  const S = state(workout({ media: [clip(H(1), H(2))] }))
  const leaks = v => { const s = JSON.stringify(v); return [H(1), H(2)].some(h => s.includes(h)) || /"media"/.test(s) }

  it('Copy as text', () => {
    const txt = workoutText(S.workouts[0], { unit: 'kg', nameOf: e => e.id })
    expect(txt).not.toContain(H(1))
    expect(txt).not.toMatch(/video|photo/i)
  })

  it('a routine saved from the workout, and a plan file built from it', () => {
    const st = structuredClone(S)
    const id = saveSessionAsRoutine(st, st.workouts[0], 'From workout')
    expect(leaks(st.routines.find(r => r.id === id))).toBe(false)
    expect(leaks(buildPlanBundle(st, 'Mine'))).toBe(false)
  })
})
