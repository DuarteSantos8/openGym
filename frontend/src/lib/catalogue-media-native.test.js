import { describe, it, expect, vi } from 'vitest'
import { createCatalogueMediaNative } from './catalogue-media-native.js'

async function setup() {
  let progress
  const remove = vi.fn()
  const plugin = {
    addListener: vi.fn(async (_name, callback) => { progress = callback; return { remove } }),
    download: vi.fn(async args => ({ bytesWritten: args.expectedBytes, finalUrl: args.url })),
    verify: vi.fn(async args => ({ bytes: args.bytes, sha256: args.sha256, format: args.format })),
    freeSpace: vi.fn(async () => ({ bytes: 1000 })),
    rename: vi.fn(async () => ({}))
  }
  const fs = { stat: vi.fn(async () => ({ size: 12 })), getUri: vi.fn(async ({ path }) => ({ uri: 'file://' + path })) }
  const adapter = await createCatalogueMediaNative({
    filesystem: async () => ({ Filesystem: fs, Directory: { Library: 'LIBRARY' }, Encoding: { UTF8: 'utf8' } }),
    core: async () => ({ registerPlugin: () => plugin, Capacitor: { convertFileSrc: uri => 'play:' + uri } })
  })
  return { ...adapter, fs, plugin, remove, progress: (...args) => progress(...args) }
}

describe('catalogue native adapter', () => {
  it('passes bounded destinations and no credentials; filters concurrent progress by destination', async () => {
    const { transport, plugin, progress, remove } = await setup()
    const onProgress = vi.fn(), destination = 'opengym-catalogue-media/staging/one.part'
    await expect(transport.download({ url: 'https://media.example/objects/a.webp', destination, expectedBytes: 12, onProgress })).resolves.toEqual({ bytesWritten: 12, finalUrl: 'https://media.example/objects/a.webp' })
    expect(plugin.download).toHaveBeenCalledWith({ url: 'https://media.example/objects/a.webp', destination, expectedBytes: 12 })
    progress({ destination: 'opengym-catalogue-media/staging/two.part', bytesWritten: 1 })
    progress({ destination, bytesWritten: 4 })
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(4, 12)
    expect(remove).toHaveBeenCalledOnce()
  })

  it('normalizes native failures and removes listeners even when download fails', async () => {
    const { transport, plugin, remove } = await setup()
    plugin.download.mockResolvedValue({ error: { code: 'http', status: 429, retryAfterMs: 9000, message: 'retry later' } })
    await expect(transport.download({ url: 'https://media.example/a', destination: 'opengym-catalogue-media/staging/job.part', expectedBytes: 12, onProgress: () => {} })).rejects.toMatchObject({ code: 'http', status: 429, retryAfterMs: 9000 })
    expect(remove).toHaveBeenCalledOnce()
  })

  it('rejects file-system escapes and downloads outside staging before calling the bridge', async () => {
    const { files, transport, plugin } = await setup()
    await expect(files.stat('opengym-media/user-photo.mp4')).rejects.toMatchObject({ code: 'io' })
    await expect(files.stat('opengym-catalogue-media/../opengym-state.json')).rejects.toMatchObject({ code: 'io' })
    await expect(transport.download({ destination: 'opengym-catalogue-media/objects/a.webp', expectedBytes: 12 })).rejects.toMatchObject({ code: 'io' })
    expect(plugin.download).not.toHaveBeenCalled()
    expect(await files.freeBytes()).toBe(1000)
  })

  it('maps platform-specific filesystem errors into the shared error vocabulary', async () => {
    const { files, fs } = await setup()
    fs.stat.mockRejectedValue({ code: 'OS-PLUG-FILE-0008', message: 'Permission denied' })
    await expect(files.stat('opengym-catalogue-media/objects/a.webp')).rejects.toMatchObject({ code: 'io', status: null, retryAfterMs: null })
    fs.stat.mockRejectedValue({ code: 'OS-PLUG-FILE-0008', message: 'File does not exist' })
    await expect(files.stat('opengym-catalogue-media/objects/a.webp')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('uses native atomic replacement for the index and object files', async () => {
    const { files, plugin } = await setup()
    await files.rename('opengym-catalogue-media/index.json.tmp', 'opengym-catalogue-media/index.json')
    expect(plugin.rename).toHaveBeenCalledWith({ from: 'opengym-catalogue-media/index.json.tmp', to: 'opengym-catalogue-media/index.json' })
  })
})
