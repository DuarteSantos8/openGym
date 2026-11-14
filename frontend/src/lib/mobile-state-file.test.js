// The phone's durable copy of the profile (lib/mobile.js nativeSave / nativeLoad): written whole to
// a second file and moved over the first, so a write cut short never leaves half a file where the
// last good copy was (data safety, owner 2026-10-14).
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ files: new Map(), failRename: false, failWrite: new Set() }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    readFile: async ({ path }) => {
      if (!h.files.has(path)) throw new Error('File does not exist')
      return { data: h.files.get(path) }
    },
    writeFile: async ({ path, data }) => {
      if (h.failWrite.has(path)) throw new Error('No space left on device')
      h.files.set(path, data)
    },
    rename: async ({ from, to }) => {
      if (h.failRename) throw new Error('interrupted')
      h.files.set(to, h.files.get(from))
      h.files.delete(from)
    },
  },
}))

let M
beforeEach(async () => {
  h.files.clear(); h.failRename = false; h.failWrite.clear()
  M = await import('./mobile.js')
})

describe('the state file', () => {
  it('lands under its own name, with nothing left beside it', async () => {
    await M.nativeSave({ _ts: 1, workouts: ['a'] })
    expect([...h.files.keys()]).toEqual(['opengym-state.json'])
    expect(await M.nativeLoad()).toEqual({ _ts: 1, workouts: ['a'] })
  })

  it('a move cut short keeps both copies, and the later one is read', async () => {
    await M.nativeSave({ _ts: 1, workouts: ['a'] })
    h.failRename = true
    h.failWrite.add('opengym-state.json')          // and the plain write after it fails too
    await M.nativeSave({ _ts: 2, workouts: ['a', 'b'] })
    expect(JSON.parse(h.files.get('opengym-state.json'))._ts).toBe(1)
    expect(await M.nativeLoad()).toEqual({ _ts: 2, workouts: ['a', 'b'] })
  })

  it('a half-written main file is not the end: the other copy is read', async () => {
    await M.nativeSave({ _ts: 1, workouts: ['a'] })
    h.files.set('opengym-state.next.json', JSON.stringify({ _ts: 1, workouts: ['a'] }))
    h.files.set('opengym-state.json', '{"_ts":2,"workouts":["a",')
    expect(await M.nativeLoad()).toEqual({ _ts: 1, workouts: ['a'] })
  })

  it('an older leftover never wins over the main file', async () => {
    h.files.set('opengym-state.next.json', JSON.stringify({ _ts: 1 }))
    await M.nativeSave({ _ts: 5 })
    h.files.set('opengym-state.next.json', JSON.stringify({ _ts: 1 }))
    expect((await M.nativeLoad())._ts).toBe(5)
  })

  it('without a move (an older plugin), it writes the file itself as before', async () => {
    const { Filesystem } = await import('@capacitor/filesystem')
    const rename = Filesystem.rename
    delete Filesystem.rename
    try {
      await M.nativeSave({ _ts: 3 })
      expect([...h.files.keys()]).toEqual(['opengym-state.json'])
      expect((await M.nativeLoad())._ts).toBe(3)
    } finally { Filesystem.rename = rename }
  })
})
