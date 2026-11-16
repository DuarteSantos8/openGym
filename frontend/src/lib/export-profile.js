// The one place a profile becomes a backup file. Both the one-tap Settings export and the
// mobile auto-backup go through it, so the shape they write can never drift apart.

export const BACKUP_FMT = 2

export function buildProfileBackup(S) {
  const out = { ...S, opengym_backup: BACKUP_FMT }
  delete out._rev
  return out
}
