import { beforeEach, describe, expect, it, vi } from 'vitest'

const { files } = vi.hoisted(() => ({ files: new Map() }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA', Documents: 'DOCUMENTS' }, Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }) => { if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return { data: files.get(path) } },
    writeFile: async ({ path, data }) => { files.set(path, data) }
  }
}))

import { NATIVE_BACKUP_FILE, nativeBackupOnce, writeAutoBackup } from './mobile.js'
import { legacyProgramme, migratedFixture } from './test-fixtures.js'
import { buildSessionExposures } from './session-start.js'
import { programmeView, skipSlot, startProgramme } from './programmes.js'
import { validateCanonicalProfile } from '../../../api/migration/profile-validation.js'

beforeEach(() => files.clear())

describe('nativeBackupOnce', () => {
  it('writes the exact text once, and never replaces it', async () => {
    await nativeBackupOnce('{"routines":[]}')
    expect(files.get(NATIVE_BACKUP_FILE)).toBe('{"routines":[]}')
    await nativeBackupOnce('{"routines":[]}')
    expect(files.get(NATIVE_BACKUP_FILE)).toBe('{"routines":[]}')
  })

  it('keeps a copy with the same or no stamp beside the first one, and refuses a third', async () => {
    files.set(NATIVE_BACKUP_FILE, '{"routines":[]}')
    await nativeBackupOnce('{"routines":[],"later":1}')
    expect(files.get(NATIVE_BACKUP_FILE)).toBe('{"routines":[]}')
    expect(files.get('gym_state_v1.pre-engine-v1.t0.json')).toBe('{"routines":[],"later":1}')
    await expect(nativeBackupOnce('{"routines":[],"later":2}')).rejects.toThrow('native-backup-source-mismatch')
  })

  it('keeps a copy written since an earlier attempt beside the first one, named by its stamp', async () => {
    files.set(NATIVE_BACKUP_FILE, '{"routines":[],"_ts":1}')
    await nativeBackupOnce('{"routines":[],"_ts":2}')
    expect(files.get(NATIVE_BACKUP_FILE)).toBe('{"routines":[],"_ts":1}')
    expect(files.get('gym_state_v1.pre-engine-v1.t2.json')).toBe('{"routines":[],"_ts":2}')
    await nativeBackupOnce('{"routines":[],"_ts":2}')
    await expect(nativeBackupOnce('{"routines":[1],"_ts":2}')).rejects.toThrow('native-backup-source-mismatch')
  })

  it('fails closed on an existing copy that is not v1, or a write that does not read back', async () => {
    files.set(NATIVE_BACKUP_FILE, '{"engineSchemaVersion":2}')
    await expect(nativeBackupOnce('{}')).rejects.toThrow('native-backup-not-v1')
    files.clear()
    const { Filesystem } = await import('@capacitor/filesystem')
    const write = Filesystem.writeFile
    Filesystem.writeFile = async ({ path, data }) => { files.set(path, data.slice(1)) }
    try { await expect(nativeBackupOnce('{"routines":[]}')).rejects.toThrow('native-backup-mismatch') }
    finally { Filesystem.writeFile = write }
  })
})

describe('a full backup of a profile with a programme run', () => {
  it('a full backup restore keeps runs, events, reviews and every prescription they name', async () => {
    const S = migratedFixture({ unit: 'kg', weekStart: 1, routines: [{ id: 'A', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }], workouts: [] })
    S.week = { 1: ['A'] }
    S.oneRepMaxes = { b100: { id: 'b100', exerciseId: '0025', value: 100, unit: 'kg', source: 'manual', capturedAt: '2026-10-01T00:00:00.000Z' } }
    S.programmes = { P: legacyProgramme(S, { id: 'P', name: 'Block', at: 1, weeks: [{ rpe: 7, t: { '0025': { pct: 75 } } }, { rpe: 8, t: { '0025': { pct: 80 } } }], days: { 1: ['A'] } }) }
    startProgramme(S, 'P', { policies: { 't:P:A:o0': { onFailure: 'repeat', onSkipped: 'advance' } }, end: 'extend', today: '2026-10-19' })
    const now = Date.parse('2026-10-19T17:00:00Z')
    const exposures = buildSessionExposures(S, S.routines[0], { now, newId: x => x })
    S.workouts = [{ id: 'mon', d: '2026-10-19', start: now, end: now + 3600000, status: 'completed', exposures: exposures.map(x => ({ ...x, completedAt: '2026-10-19T18:00:00.000Z', actual: { sets: 3, reps: 5 }, performance: { sets: [] } })) }]
    skipSlot(S, 'p2:a0:A:o0', Date.parse('2026-10-26T09:00:00Z'))
    S.refReviews = { 'run:x:t': { candidateId: 'c1', decision: 'later', at: 5 } }
    await writeAutoBackup(S)
    const [path] = [...files.keys()].filter(k => k.startsWith('openGym/opengym-backup-'))
    const { opengym_backup, ...restored } = JSON.parse(files.get(path))
    expect(opengym_backup).toBe(2)
    for (const k of ['programmes', 'programme', 'programmeRuns', 'programmeEvents', 'refReviews']) expect(restored[k]).toEqual(JSON.parse(JSON.stringify(S[k])))
    const named = restored.workouts.flatMap(w => w.exposures.map(x => x.prescriptionId))
    for (const id of named) expect(restored.prescriptions[id]).toEqual(JSON.parse(JSON.stringify(S.prescriptions[id])))
    expect(restored.prescriptions[named[0]].provenance.programme).toEqual(restored.workouts[0].exposures[0].programme)
    expect(validateCanonicalProfile(restored).ok).toBe(true)
    // It replays to the same run.
    expect(programmeView(restored, '2026-11-02').tracks).toEqual(programmeView(S, '2026-11-02').tracks)
  })
})
