import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkForUpdate, sha256, resetUpdateCheck } from './update.js'

// __APP_VERSION__ is defined at build time by vite.config.js (reads package.json).
// In the test environment vitest applies the same define, so it's available here.

describe('sha256', () => {
  it('computes the correct hash for a known input', async () => {
    const input = new TextEncoder().encode('hello world')
    const hash = await sha256(input.buffer)
    // Well-known SHA-256 of "hello world"
    expect(hash).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('computes a different hash for different input', async () => {
    const a = await sha256(new TextEncoder().encode('aaa').buffer)
    const b = await sha256(new TextEncoder().encode('bbb').buffer)
    expect(a).not.toBe(b)
  })

  it('returns a 64-character hex string', async () => {
    const hash = await sha256(new TextEncoder().encode('test').buffer)
    expect(hash).toHaveLength(64)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('checkForUpdate', () => {
  let originalFetch

  beforeEach(() => { originalFetch = globalThis.fetch; resetUpdateCheck() })
  afterEach(() => { globalThis.fetch = originalFetch })

  function mockFetch(body, status = 200) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }))
  }

  it('reports no update when the latest release matches the current version', async () => {
    mockFetch([{ tag_name: 'v' + __APP_VERSION__, assets: { links: [] } }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe(__APP_VERSION__)
    expect(result.apkUrl).toBe(null)
    expect(result.hashUrl).toBe(null)
  })

  it('reports no update when the latest release is older than current', async () => {
    mockFetch([{ tag_name: 'v0.0.1', assets: { links: [] } }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe('0.0.1')
  })

  it('reports an update when the latest release is newer', async () => {
    mockFetch([{ tag_name: 'v99.0.0', assets: { links: [] } }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(true)
    expect(result.latestVersion).toBe('99.0.0')
  })

  it('strips the v prefix from the tag name', async () => {
    mockFetch([{ tag_name: 'v99.1.2', assets: { links: [] } }])
    const result = await checkForUpdate()
    expect(result.latestVersion).toBe('99.1.2')
  })

  it('handles tag names without a v prefix', async () => {
    mockFetch([{ tag_name: '99.0.0', assets: { links: [] } }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(true)
    expect(result.latestVersion).toBe('99.0.0')
  })

  it('finds the APK download URL from release asset links', async () => {
    const apkUrl = 'https://gitlab.com/project/-/releases/v2.0.0/downloads/opengym.apk'
    mockFetch([{
      tag_name: 'v99.0.0',
      assets: { links: [{ url: apkUrl, direct_asset_url: apkUrl }] }
    }])
    const result = await checkForUpdate()
    expect(result.apkUrl).toBe(apkUrl)
  })

  it('prefers direct_asset_url over url for APK links', async () => {
    mockFetch([{
      tag_name: 'v99.0.0',
      assets: {
        links: [{
          url: 'https://redirect.example/opengym.apk',
          direct_asset_url: 'https://direct.example/opengym.apk'
        }]
      }
    }])
    const result = await checkForUpdate()
    expect(result.apkUrl).toBe('https://direct.example/opengym.apk')
  })

  it('returns null apkUrl when no .apk link exists', async () => {
    mockFetch([{
      tag_name: 'v99.0.0',
      assets: { links: [{ url: 'https://example.com/changelog.md', direct_asset_url: 'https://example.com/changelog.md' }] }
    }])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(true)
    expect(result.apkUrl).toBe(null)
  })

  it('finds the .sha256 hash URL from release asset links', async () => {
    const hashUrl = 'https://gitlab.com/project/-/releases/v2.0.0/downloads/opengym.apk.sha256'
    mockFetch([{
      tag_name: 'v99.0.0',
      assets: {
        links: [
          { url: 'https://example.com/opengym.apk', direct_asset_url: 'https://example.com/opengym.apk' },
          { url: hashUrl, direct_asset_url: hashUrl },
        ]
      }
    }])
    const result = await checkForUpdate()
    expect(result.hashUrl).toBe(hashUrl)
  })

  it('finds hash URL by link name containing sha256', async () => {
    mockFetch([{
      tag_name: 'v99.0.0',
      assets: {
        links: [
          { name: 'APK', url: 'https://example.com/opengym.apk', direct_asset_url: 'https://example.com/opengym.apk' },
          { name: 'SHA256 checksum', url: 'https://example.com/checksum.txt', direct_asset_url: 'https://example.com/checksum.txt' },
        ]
      }
    }])
    const result = await checkForUpdate()
    expect(result.hashUrl).toBe('https://example.com/checksum.txt')
  })

  // The exact JSON gitlab.com returns for GET /projects/85678327/releases?per_page=1 (v1.3.1,
  // fetched 2026-09-05, description and commit trimmed). The CI publishes the APK and its
  // checksum as generic-package links, and the checksum link is listed BEFORE the APK — the
  // detection must not confuse the two.
  const REAL_RELEASE = [
    {
      "tag_name": "v1.3.1",
      "name": "openGym v1.3.1",
      "assets": {
        "count": 7,
        "sources": [
          {
            "format": "zip",
            "url": "https://gitlab.com/DuarteSantos8/opengym/-/archive/v1.3.1/opengym-v1.3.1.zip"
          },
          {
            "format": "tar.gz",
            "url": "https://gitlab.com/DuarteSantos8/opengym/-/archive/v1.3.1/opengym-v1.3.1.tar.gz"
          },
          {
            "format": "tar.bz2",
            "url": "https://gitlab.com/DuarteSantos8/opengym/-/archive/v1.3.1/opengym-v1.3.1.tar.bz2"
          },
          {
            "format": "tar",
            "url": "https://gitlab.com/DuarteSantos8/opengym/-/archive/v1.3.1/opengym-v1.3.1.tar"
          }
        ],
        "links": [
          {
            "id": 12790840,
            "name": "Container images (api + web)",
            "url": "https://gitlab.com/DuarteSantos8/opengym/container_registry",
            "direct_asset_url": "https://gitlab.com/DuarteSantos8/opengym/container_registry",
            "link_type": "image"
          },
          {
            "id": 12790839,
            "name": "openGym-1.3.1.apk.sha256 (checksum)",
            "url": "https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/1.3.1/openGym-1.3.1.apk.sha256",
            "direct_asset_url": "https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/1.3.1/openGym-1.3.1.apk.sha256",
            "link_type": "other"
          },
          {
            "id": 12790838,
            "name": "openGym-1.3.1.apk (Android, sideload)",
            "url": "https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/1.3.1/openGym-1.3.1.apk",
            "direct_asset_url": "https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/1.3.1/openGym-1.3.1.apk",
            "link_type": "package"
          }
        ]
      }
    }
  ]

  it('finds the APK and its checksum in a real gitlab.com release payload', async () => {
    mockFetch(REAL_RELEASE)
    const result = await checkForUpdate()
    expect(result.latestVersion).toBe('1.3.1')
    expect(result.apkUrl).toBe('https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/1.3.1/openGym-1.3.1.apk')
    expect(result.hashUrl).toBe('https://gitlab.com/api/v4/projects/85678327/packages/generic/opengym-android/1.3.1/openGym-1.3.1.apk.sha256')
  })

  it('returns null hashUrl when no hash link exists', async () => {
    mockFetch([{
      tag_name: 'v99.0.0',
      assets: { links: [{ url: 'https://example.com/opengym.apk', direct_asset_url: 'https://example.com/opengym.apk' }] }
    }])
    const result = await checkForUpdate()
    expect(result.hashUrl).toBe(null)
  })

  it('returns no update when the releases array is empty', async () => {
    mockFetch([])
    const result = await checkForUpdate()
    expect(result.hasUpdate).toBe(false)
    expect(result.latestVersion).toBe(__APP_VERSION__)
    expect(result.hashUrl).toBe(null)
  })

  it('throws when the API responds with an error status', async () => {
    mockFetch(null, 500)
    await expect(checkForUpdate()).rejects.toThrow('GitLab API 500')
  })

  it('throws on network failure', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')))
    await expect(checkForUpdate()).rejects.toThrow('Network error')
  })
})

describe('semver comparison (via checkForUpdate behavior)', () => {
  let originalFetch
  beforeEach(() => { originalFetch = globalThis.fetch; resetUpdateCheck() })
  afterEach(() => { globalThis.fetch = originalFetch })

  function mockRelease(tag) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve([{ tag_name: tag, assets: { links: [] } }]),
    }))
  }

  // Versions are derived from the running __APP_VERSION__ so the suite never breaks
  // when package.json bumps. bump(2, +1) raises the patch; bump(0, +1) raises the major.
  const [MAJ, MIN, PATCH] = __APP_VERSION__.split('.').map(Number)
  const bump = (idx, by) => {
    const parts = [MAJ, MIN, PATCH]
    parts[idx] += by
    return 'v' + parts.join('.')
  }

  it('detects a patch bump as an update', async () => {
    mockRelease(bump(2, 1))
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })

  it('detects a minor bump as an update', async () => {
    mockRelease(bump(1, 1))
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })

  it('detects a major bump as an update', async () => {
    mockRelease(bump(0, 1))
    expect((await checkForUpdate()).hasUpdate).toBe(true)
  })

  it('does not flag an older patch as an update', async () => {
    // One patch below current (current patch is always >= our test floor)
    mockRelease('v' + [MAJ, MIN, Math.max(0, PATCH - 1)].join('.'))
    // Only meaningful when we could actually go lower; when patch is 0 this equals current,
    // which correctly reports no update either way.
    expect((await checkForUpdate()).hasUpdate).toBe(false)
  })

  it('does not flag an older minor as an update', async () => {
    // A version guaranteed lower than any 1.x+ release: same major, minor 0, patch 0,
    // minus one on the minor when possible.
    mockRelease('v' + [MAJ, Math.max(0, MIN - 1), 0].join('.'))
    expect((await checkForUpdate()).hasUpdate).toBe(false)
  })
})
