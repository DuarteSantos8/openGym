// LIFTIQ-FORK: plain-English texts of the integration (deliberately not t() keys, see LIFTIQ-FORK.md).
export function batteryText(b) {
  if (!b || b.kind === 'waiting') return 'Waiting for the first reading'
  if (b.kind === 'none') return 'No battery detected (USB power?)'
  return '~' + b.percent + ' % (' + b.volts.toFixed(2) + ' V, estimate)'
}

export function statusText(s) {
  if (s.status === 'connecting') return 'Connecting…'
  if (s.status === 'connected') return 'Connected' + (s.name ? ' to ' + s.name : '')
  if (s.status === 'error') return 'Not connected'
  return 'Not connected'
}

// m:ss.t of a sensor-clock time in seconds
export function clock(sec) {
  const s = Math.max(0, Number(sec) || 0)
  const m = Math.floor(s / 60)
  return m + ':' + (s - m * 60).toFixed(1).padStart(4, '0')
}
