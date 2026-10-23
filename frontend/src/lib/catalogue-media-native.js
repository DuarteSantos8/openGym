// Explicit native transport; never patches fetch or shares the account API's credentials.
const ROOT = 'opengym-catalogue-media/'
const ERRORS = new Set(['offline', 'network', 'timeout', 'http', 'no-space', 'cancelled', 'redirect', 'size', 'type', 'hash', 'io', 'ENOENT'])
const allowed = path => typeof path === 'string' && path.startsWith(ROOT) && !path.includes('\\') && path.split('/').every(p => p && p !== '.' && p !== '..')
const normalError = e => {
  const code = /no space|ENOSPC|disk full/i.test(e?.message || '') ? 'no-space'
    : /does not exist|not exist|not found|ENOENT/i.test(e?.message || '') ? 'ENOENT' : ERRORS.has(e?.code) ? e.code : 'io'
  return Object.assign(new Error(e?.message || code), { code, status: e?.status ?? null, retryAfterMs: e?.retryAfterMs ?? null })
}

export async function createCatalogueMediaNative({
  filesystem = () => import('@capacitor/filesystem'),
  core = () => import('@capacitor/core')
} = {}) {
  const [{ Filesystem: fs, Directory, Encoding }, { registerPlugin, Capacitor }] = await Promise.all([filesystem(), core()])
  const native = registerPlugin('CatalogueMedia')
  const opts = path => {
    if (path !== ROOT.slice(0, -1) && !allowed(path)) throw normalError({ code: 'io', message: 'invalid catalogue path' })
    return { path, directory: Directory.Library }
  }
  const invoke = async (name, args) => {
    try {
      const result = await native[name](args)
      if (result?.error) throw result.error
      return result
    } catch (e) { throw normalError(e) }
  }
  const wrap = fn => async (...args) => { try { return await fn(...args) } catch (e) { throw normalError(e) } }
  const files = {
    readText: wrap(async path => (await fs.readFile({ ...opts(path), encoding: Encoding.UTF8 })).data),
    writeText: wrap((path, data) => fs.writeFile({ ...opts(path), data, encoding: Encoding.UTF8, recursive: true })),
    rename: wrap(async (from, to) => {
      opts(from); opts(to)
      // POSIX rename replaces an existing file atomically; never delete the current index
      // first or depend on an undocumented Filesystem overwrite policy.
      await invoke('rename', { from, to })
    }),
    remove: wrap(path => fs.deleteFile(opts(path))),
    list: wrap(async path => (await fs.readdir(opts(path))).files.map(f => typeof f === 'string' ? f : f.name)),
    stat: wrap(async path => ({ bytes: (await fs.stat(opts(path))).size })),
    mkdir: wrap(async path => {
      try { await fs.mkdir({ ...opts(path), recursive: true }) } catch (e) {
        // mkdir may reject an existing directory. Other failures must remain visible.
        const stat = await fs.stat(opts(path)).catch(() => null)
        if (stat?.type !== 'directory') throw e
      }
    }),
    url: wrap(async path => Capacitor.convertFileSrc((await fs.getUri(opts(path))).uri)),
    verify: (path, asset) => { opts(path); return invoke('verify', { path, bytes: asset.bytes, sha256: asset.sha256, format: asset.format }) },
    freeBytes: async () => (await invoke('freeSpace', {})).bytes
  }
  const transport = {
    async download({ url, destination, expectedBytes, onProgress }) {
      opts(destination)
      if (!destination.startsWith(ROOT + 'staging/') || !destination.endsWith('.part')) throw normalError({ code: 'io', message: 'invalid download destination' })
      const listener = onProgress ? await native.addListener('progress', p => {
        if (p.destination === destination) onProgress(p.bytesWritten, expectedBytes)
      }) : null
      try { return await invoke('download', { url, destination, expectedBytes }) } finally { await listener?.remove() }
    }
  }
  return { files, transport }
}
