// Consent and sync markers belong to this device, server and account, never to the profile.
export function healthOwner(store) {
  const s = store.getState()
  return JSON.stringify([s.sync?.server || 'local', s.user?.id || 'local', !!s.isGuest?.()])
}
