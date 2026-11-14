// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ state: { S: { workouts: [], bodyweight: [] }, user: { id: 'one' }, sync: { server: 'https://gym.example' }, ready: true }, subscribers: [], files: new Map(), enabled: vi.fn() }))
vi.mock('react-dom/client', () => ({ createRoot: () => ({ render() {} }) }))
vi.mock('./App.jsx', () => ({ default: () => null }))
vi.mock('./store/useStore.js', () => ({ useStore: {
  getState: () => h.state, subscribe: fn => { h.subscribers.push(fn); return () => {} },
} }))
vi.mock('./lib/media-sync.js', () => ({ startMediaSync() {} }))
vi.mock('./lib/native-keyboard.js', () => ({ startNativeKeyboard() {} }))
vi.mock('./lib/boot.js', () => ({ hideBoot() {}, handOverFromLaunchScreen() {} }))
vi.mock('./lib/mobile.js', () => ({ MOBILE: true, nativePlatform: async () => 'ios',
  readJsonFile: async path => h.files.get(path) || null,
  writeJsonFile: async (path, value) => { h.files.set(path, structuredClone(value)) },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => ({
  status: async () => ({ status: 'available', granted: true }), setEnabled: h.enabled,
}) }))
vi.mock('@capacitor/app', () => ({ App: { addListener() {} } }))
it('the actual mobile entry point resumes scoped Health after profile readiness changes', async () => {
  h.enabled.mockResolvedValue({})
  const hs = await import('./lib/health-sync.js')
  hs.bindHealthOwner(() => h.state)
  await hs.enableHealth(h.state.S)
  h.state = { ...h.state, ready: false }; hs.invalidateHealthSync()
  await vi.waitFor(() => expect(hs.healthWritingEnabled()).toBe(false))
  await import('./main.jsx')
  h.enabled.mockClear()
  const prev = h.state; h.state = { ...prev, ready: true }
  for (const fn of h.subscribers) fn(h.state, prev)
  await vi.waitFor(() => expect(hs.healthWritingEnabled()).toBe(true))
  await vi.waitFor(() => expect(h.enabled).toHaveBeenCalledWith({ on: true }))
})
