// How many dated copies "Auto-backup on changes" keeps in its folder (Settings → Data). Fourteen
// unless the person picked another count: a sync app that keeps its own history needs few, a
// folder nothing else watches may want a month. Its own module because the Settings tests mock
// lib/mobile.js wholesale, and both read the same answer.
export const AUTO_BACKUP_KEEP = 14
export const AUTO_BACKUP_KEEP_CHOICES = [5, 14, 30, 60]

/** The count to keep for this profile: its own pick when it is one of the choices, else 14. */
export const autoBackupKeepOf = S =>
  AUTO_BACKUP_KEEP_CHOICES.includes(S?.autoBackupKeep) ? S.autoBackupKeep : AUTO_BACKUP_KEEP
