// What happens to a backup once it is read (Settings → Data & backup → Import backup, and Restore
// from WebDAV, #582): the server is asked first whether the profile has workouts the backup does
// not, and the person chooses to replace or to merge; with nothing at stake, one confirm. Kept in
// one place so both ways in ask the very same questions.
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { syncMedia } from '../lib/media-sync.js'
import { limitsFrom } from '../lib/media-limits.js'

/** `read`: what lib/backup-media.js readBackupFile answered. `onDone` after the import. */
export async function confirmBackupImport(read, { onDone } = {}) {
  const toast = m => useUI.getState().toast(m)
  const { importConflict, importBackup } = useStore.getState()
  const apply = async mergeWith => {
    if (read.files.length) {
      const { storeBackupMedia } = await import('../lib/backup-media.js')
      await storeBackupMedia(read.files, { limits: limitsFrom(useStore.getState().config) })
    }
    importBackup(read.state, { mergeWith })
    // The photos it brought are pending here and maybe gone from the server (a reset): sent now,
    // not after the ten-minute dedupe of the run before the reset.
    if (read.files.length) syncMedia({ force: true })
    toast(t('Backup imported'))
    onDone?.()
  }
  // Signed in, the server is asked first: a workout logged since the backup was made, or on
  // another device meanwhile, would be deleted from the profile by the replace — said, with the
  // choice to merge those in instead (useStore importConflict / importBackup).
  const conflict = await importConflict(read.state)
  if (conflict) {
    const n = conflict.workouts
    menuSheet({
      title: t('Import backup?'),
      subtitle: conflict.device
        ? t(n === 1 ? 'This device has 1 workout that is not in this backup. Replacing deletes it.'
          : 'This device has {0} workouts that are not in this backup. Replacing deletes them.', n)
        : t(n === 1
          ? 'The server has 1 workout that is not in this backup, logged since it was made or on another device. Replacing deletes it.'
          : 'The server has {0} workouts that are not in this backup, logged since it was made or on another device. Replacing deletes them.', n),
      items: [
        { icon: 'trash', label: t('Replace anyway'), danger: true, onClick: () => apply(null) },
        { icon: 'merge', label: t('Merge them in'), onClick: () => apply(conflict) },
        { icon: 'xmark', label: t('Cancel'), onClick: () => {} },
      ],
    })
    return
  }
  confirmSheet({
    title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true,
    onConfirm: () => apply(null)
  })
}
