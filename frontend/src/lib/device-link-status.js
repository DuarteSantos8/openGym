// The rules behind the link sign in the workout's top bar and its Devices sheet: raw signals in,
// one row per device and an overall state out. Pure; the live signals are gathered elsewhere.
// docs/dev/DEVICE_LINK_STATUS.md holds the states.

export const DELAYED_MS = 5 * 60_000 // not heard for longer than this while not answering: offline (past a long rest: a sleeping watch is not a lost one)
export const FAST_MS = 1000     // ping round trip at or under this is "fast", over it "slow"
const GRACE_MS = 15_000         // after a workout starts, a watch that has not answered yet is still being looked for
const HR_FRESH_MS = 60_000

const row = (id, kind, state, over = {}) => ({
  id, kind, state, speed: null, lastHeard: null, warn: false, fix: null, ...over,
})
const down = (id, kind, over) => row(id, kind, 'offline', { warn: true, ...over })

// server: connectionView plus `waited` (a wait past its grace turns amber)
// input: { platform, watchOn, watch, seen, heard, ping, activeId, startedAt, server, relay, hr }
export function deviceRows(input, now) {
  const { platform, watchOn, watch, seen, heard, ping, activeId, startedAt, server, relay, hr } = input
  const rows = []
  let checking = false

  if (watchOn && watch && (watch.paired || watch.installed || seen)) {
    const kind = platform === 'android' ? 'wear' : 'apple'
    const fix = 'watchSettings'
    const heardNow = !!heard && activeId != null && heard.wid === activeId
    if (watch.reachable) {
      const speed = ping?.ok ? (ping.ms <= FAST_MS ? 'fast' : 'slow') : null
      rows.push(row('watch', kind, 'live', { speed }))
    } else if (heardNow) {
      // Wear OS drops out at once when no node is left; the rest wait out the delay
      const gone = (platform === 'android' && !watch.paired) || now - heard.at > DELAYED_MS
      rows.push(gone ? down('watch', kind, { lastHeard: heard.at, fix }) : row('watch', kind, 'delayed'))
    } else if (!watch.paired) {
      rows.push(row('watch', kind, 'notFound', { reason: 'unpaired', warn: true, fix }))
    } else if (!watch.installed) {
      rows.push(row('watch', kind, 'notFound', { reason: 'notInstalled', warn: true, fix }))
    } else if (startedAt != null && now - startedAt < GRACE_MS) {
      checking = true
    } else {
      rows.push(row('watch', kind, 'notAnswering', { warn: true, fix }))
    }
  }

  if (relay?.linked) {
    rows.push(relay.reachable ? row('zepp', 'zepp', 'live') : down('zepp', 'zepp', { lastHeard: relay.seen, fix: 'watchSettings' }))
  }

  if (hr && now - hr.at < HR_FRESH_MS) rows.push(row('hr', 'hr', 'live', { bpm: hr.bpm }))

  if (server?.tone === 'ok') rows.push(row('server', 'server', 'ok'))
  else if (server?.tone === 'wait') rows.push(row('server', 'server', 'wait', server.waited ? { warn: true, fix: 'server', action: server.action } : {}))
  else if (server?.tone === 'off' || server?.tone === 'bad') rows.push(down('server', 'server', { fix: 'server', action: server.action }))

  const overall = rows.some(r => r.warn) ? 'warn' : checking ? 'checking' : rows.length ? 'ok' : 'none'
  return { rows, overall }
}
