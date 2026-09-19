import { useEffect, useRef, useState, forwardRef, useSyncExternalStore } from 'react'
import { useNavigate, useParams, useLocation, Navigate } from 'react-router-dom'
import { useStore, DEF, hasData } from '../store/useStore.js'
import { healthStatus, loadHealth, enableHealth, disableHealth, openHealthConnect, onHealthChange } from '../lib/health-sync.js'
import { workoutControls } from '../lib/workout-controls.js'
import { speedUnitOf } from '../lib/speed.js'
import { formulaOf, FORMULA_NAMES } from '../lib/onerm.js'
import { copyText } from '../lib/clipboard.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, ACCENT_NAMES, todayISO, localTZ, weekStartOf, MONDAY, SUNDAY, fmtPlate } from '../lib/format.js'
import { inventoryFor, ownsPlates } from '../lib/plates.js'
import { dumbbellsOf } from '../lib/dumbbells.js'
import { effortOf } from '../lib/history.js'
import { figureOf } from '../lib/exercises.js'
import { unlock, chime, playOnSilentSupported, vibrateSupported, appleTouchDevice } from '../lib/sound.js'
import { REST_SOUND_IDS, restSoundOf } from '../lib/rest-sounds.js'
import { scheduleModeOf, chooseFixedWeek, chooseRotation } from '../lib/rotation.js'
import { queueOf } from '../lib/queue.js'
import { api, webauthnOK, passkeyRegister, passkeyError, IS_ANDROID } from '../lib/api.js'
import { pushSupported, enablePush, disablePush, sendTestPush, syncPushSubscription } from '../lib/push.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t, tn, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, baseLang, dateLocale } from '../lib/i18n.js'
import { effectiveLang } from '../lib/default-lang.js'
import { DEMO, REPO } from '../lib/demo.js'
import { MOBILE, isAndroid, shareExport, shareExportBlob, syncReminder } from '../lib/mobile.js'
import { NUDGE_COPY, NUDGE_TONES, toneOf } from '../lib/nudge.js'
import { referencedFiles } from '../lib/media-refs.js'
import { mediaStore } from '../lib/media-store.js'
import { syncMedia, fetchToStore } from '../lib/media-sync.js'
import { getMediaStatus, subscribeMediaStatus, pendingRefCount } from '../lib/media-owed.js'
import { limitsFrom, fmtMB, MB } from '../lib/media-limits.js'
import { setRestAccent } from '../lib/rest-alert.js'
import { CUSTOM, accentKey, adjustedIn, applyAccent, cleanHex, inkOn, isGrey } from '../lib/accent.js'
import { checkForUpdate, downloadAndInstall } from '../lib/update.js'
import { forgetCoach } from '../lib/coach-api.js'
import { REST_MAX, REST_PAUSE_MIN, REST_PAUSE_MAX, fmtRest, fmtDuration } from '../lib/duration.js'
import { starterPlanSheet, confirmSheet, importFromApp, importFromHevy, equipmentProfileSheet, plateInventorySheet, dumbbellInventorySheet, menuSheet } from '../sheets.jsx'
import { EXDB } from '../lib/exercises.js'
import Icon from '../components/Icon.jsx'
import { durationSheet } from '../components/DurationWheel.jsx'
import { showsConnection, showsLocalLine } from '../components/SyncBanner.jsx'
import BackupFolderRow, { useBackupFolder, autoBackupSubtitle } from '../components/BackupFolderRow.jsx'
import { ServerSyncSection, KeptChangesRows, leaveServer, connectServer, passkeySignIn } from '../components/ServerSync.jsx'
import { passwordOn, PasswordRow, openPasswordSignIn, openPasswordRegister } from '../components/PasswordAuth.jsx'
import { usePasskeys, PasskeysRow, DeviceLinkRow, openDeviceLinkRedeem } from '../components/Passkeys.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField, SearchField } from '../components/ui.jsx'
import { PAGES, ROOT_GROUPS, pageVisible, searchSettings, pageTrail } from './settings-pages.js'

/* Settings (v1.3.11). The root is one screen: an account card, eleven rows that each open a page
   (/settings/<page>), and a search over every row. Rare things live one level further down
   (Workout → Fine-tuning). The rows and their rules are the ones the single long page had; only
   where they sit changed. settings-pages.js says which page holds what, and is what the search
   reads. `page` is the open page (null for the root), `find` a row a search hit asked for, which
   is scrolled to and flashed. */

// What was typed into the search, kept while you step into a hit and back out again: tied to
// the history entry it was typed on, so Back (in the app, the browser's or Android's) brings the
// results back, while Settings opened afresh from anywhere (the gear, a tab) starts at the root.
let lastQuery = { q: '', key: null }

// The route: /settings and /settings/<page>. An unknown page, or one this device does not have
// (the Coach page off the phone app), goes back to the root.
export function SettingsRoute() {
  const { page } = useParams()
  const loc = useLocation()
  const ctx = { user: useStore(s => s.user), mobile: MOBILE }
  if (page && (!PAGES[page] || !pageVisible(PAGES[page].parent || page, ctx))) return <Navigate to="/settings" replace />
  if (page === 'coach') return <Navigate to="/coach/setup" replace />
  return <Settings key={page || 'root'} page={page || null} find={loc.state?.find || null} via={loc.state?.via || null} />
}

// "Mon" / "Sun" in the app's language, for the Plan & schedule row's preview.
const shortWeekday = day => {
  try { return new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' }).format(new Date(2024, 0, day === 0 ? 7 : 1)) } catch { return day === 0 ? 'Sun' : 'Mon' }
}

// Running as an installed app (home-screen web app or the phone app): no install tip then.
const standalone = () => {
  try { return !!(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true) } catch { return false }
}

export default function Settings({ page = null, find = null, via = null }) {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  const coachLocal = useStore(s => s.coachLocal)
  // Name-and-password sign-in, where the instance offers it (#118).
  const config = useStore(s => s.config)
  const pwOn = passwordOn(config)
  // What the app is showing, which for a profile that never picked a language is worked out on
  // this device rather than stored (#303).
  const lang = effectiveLang(S, config)
  // This profile's passkeys and the code for another device (#95). A change to them is read back
  // here and by the password row, whose "Remove" depends on there being a passkey.
  const passkeys = usePasskeys(!!user && !MOBILE && !DEMO && (page === 'account'))
  const [credsV, setCredsV] = useState(0)
  const credsChanged = () => { passkeys.load(); setCredsV(v => v + 1) }
  const { update, importConflict, importBackup, setUnit, resetEverything: resetAll, setUser, pullState, pushState, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const body = useRef(null)
  const wakeOK = wakeLockSupported()

  // A planner's own queue (no rotationId, or one that doesn't match the saved rotation here) is
  // not this app's to switch off or overwrite. The Scheduling row goes read-only for it.
  const liveQ = queueOf(S)
  const externalQ = !!liveQ && (!S.rotation || liveQ.rotationId !== S.rotation.id)

  // Two honest choices on a unit switch (issue #22): convert the numbers, or keep them and only
  // change the label — the old behaviour, still right for someone who logged in lb all along
  // under a kg label. Closing the sheet leaves the unit as it was.
  const switchUnit = v => {
    if (v === S.unit) return
    menuSheet({
      title: t('Convert to {0}?', v),
      subtitle: t('Every stored weight (logged sets, working weights, routine targets, body weight, bar weights) is in {0}. Convert the numbers, or keep them and only change the label?', S.unit),
      items: [
        { icon: 'calculator', label: t('Convert the numbers'), onClick: () => setUnit(v) },
        { icon: 'pencil', label: t('Keep the numbers, change the label'), onClick: () => setUnit(v, { convert: false }) },
      ],
    })
  }

  // Fixed Week or Rotation. A live queue always wins (scheduleModeOf, lib/rotation.js) — a queue
  // written by a planner switches the app to Rotation on its own — but choosing Rotation with
  // nothing built yet has no queue to derive from, so S.scheduleMode is what keeps it selected
  // (and the weekday grid hidden, on both Home and Plan) until the first routine is added.
  // Fixed Week behaves as on Plan (views/Plan.jsx setMode), with the same words: with no loop
  // running there is nothing to lose and it switches at once; a running loop asks first.
  const setScheduleMode = v => {
    if (v === scheduleModeOf(S)) return
    if (v === 'week') {
      // A planner's own queue is never this app's to drop — this control is text-only while one
      // is live (below), but the guard stays here too rather than trust the render alone.
      if (!liveQ) { update(s => { chooseFixedWeek(s) }); return }
      confirmSheet({
        title: t('Back to a fixed week?'),
        message: t('The loop stops. Your weekdays stay as they are, and the loop is saved for later.'),
        confirmText: t('Use Fixed Week'),
        onConfirm: () => update(s => { chooseFixedWeek(s) }),
      })
      return
    }
    // The same switch as Plan's "How you train" (lib/rotation.js). With nothing to start (no
    // saved sequence, or a malformed queue Plan has to sort out) the choice holds and you stay
    // here: the page then offers the way to Plan (below), so picking a value never leaves it.
    update(s => { chooseRotation(s) })
  }

  // --- update check state ---
  const [updateInfo, setUpdateInfo] = useState(null) // { hasUpdate, latestVersion, apkUrl, hashUrl } | null
  const [android, setAndroid] = useState(false)
  const [checking, setChecking] = useState(false)
  // Where auto-backup writes on this Android phone, for the Auto-backup row's own subtitle.
  const [backupDir] = useBackupFolder(MOBILE && android && !!S.autoBackup)

  useEffect(() => {
    // The in-app updater installs an .apk, so it only applies to the native Android build.
    // On iOS and the web this check is skipped and the update row never appears. isAndroid()
    // already answers false off the mobile build; the MOBILE check on top keeps the web bundle
    // from even asking (and from calling gitlab.com on every Settings visit). Only the pages
    // that show it ask: the root (for nothing but `android`) skips the release check.
    if (!MOBILE) return
    isAndroid().then(ok => { setAndroid(ok); if (ok && page === 'about') checkForUpdate().then(setUpdateInfo).catch(() => {}) })
  }, [page])

  // A search hit: scroll its row (or button) into view and flash it once. A row that shows only
  // once the page has heard back from the server (web push, the passkey list) is waited for a
  // moment; still missing, the hit's `via` row, if it names one, is flashed instead, with a word
  // on why.
  useEffect(() => {
    if (!find || !body.current) return
    const el = body.current
    const named = label => [...el.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === label)
      || [...el.querySelectorAll('.btn')].find(b => b.textContent.trim() === label)
    let tm = null
    const flash = row => {
      row.classList.add('sp-flash')
      if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
      tm = setTimeout(() => row.classList.remove('sp-flash'), 1900)
    }
    const row = named(t(find))
    if (row) { flash(row); return () => clearTimeout(tm) }
    let done = false
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => {
      const r = named(t(find))
      if (r && !done) { done = true; mo.disconnect(); clearTimeout(wait); flash(r) }
    }) : null
    mo?.observe(el, { childList: true, subtree: true })
    const wait = setTimeout(() => {
      if (done) return
      done = true; mo?.disconnect()
      const r = via && named(t(via))
      if (r) { flash(r); toast(t('Turn on push notifications first.')) }
    }, 1500)
    return () => { done = true; mo?.disconnect(); clearTimeout(wait); clearTimeout(tm) }
  }, [find])

  // The same check, on demand: the automatic one is silent when it finds nothing or cannot
  // reach gitlab.com, and a person who taps "Check for updates" deserves an answer either way.
  const checkNow = async () => {
    if (checking) return
    setChecking(true)
    try {
      const info = await checkForUpdate()
      setUpdateInfo(info)
      if (!info.hasUpdate) toast(t('You have the latest version.'))
    } catch {
      toast(t('Couldn’t check for updates. Are you online?'))
    }
    setChecking(false)
  }

  const onUpdateRowClick = () => {
    if (!updateInfo?.hasUpdate) return
    if (updateInfo.apkUrl) {
      // Start download & install
      const version = updateInfo.latestVersion
      confirmSheet({
        title: t('Update to {0}?', version),
        message: t('The latest version will be downloaded and the installer will open.'),
        confirmText: t('Download & Install'),
        onConfirm: async () => {
          // Open a progress sheet
          let closeProgress = null
          let setProgress = null
          useUI.getState().openSheet(close => {
            closeProgress = close
            return <DownloadProgress ref={fn => { setProgress = fn }} />
          }, { locked: true })
          try {
            // The release always publishes the checksum next to the APK. Without it the file is
            // not installed — a sideloaded binary is exactly the thing that should be verified.
            let expectedHash = null
            if (updateInfo.hashUrl) {
              try {
                const hashRes = await fetch(updateInfo.hashUrl)
                if (hashRes.ok) expectedHash = (await hashRes.text()).split(/\s/)[0]
              } catch (e) { /* reported below */ }
            }
            if (!/^[0-9a-f]{64}$/i.test(expectedHash || '')) throw new Error(t('Checksum not available, so not installing'))
            await downloadAndInstall(updateInfo.apkUrl, expectedHash, (received, total) => {
              if (setProgress) setProgress(received, total)
            })
            if (closeProgress) closeProgress()
          } catch (e) {
            if (closeProgress) closeProgress()
            toast(t('Update failed: {0}', e.message))
          }
        },
      })
    } else {
      // Update available but no APK asset — open the releases page
      window.open('https://gitlab.com/DuarteSantos8/opengym/-/releases', '_blank', 'noopener')
    }
  }

  // Reads the store at the moment of the tap: the sheet that asks before a sign-out offers it too,
  // and the copy it exports is the one that has not reached the server.
  const doExport = async () => {
    const json = JSON.stringify(useStore.getState().S, null, 2)
    const name = 'opengym-backup-' + todayISO() + '.json'
    // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  // "Export with photos & videos": the same JSON plus every file the state refers to, in a zip
  // (lib/backup-media.js). Signed in, a file this device never downloaded is fetched for it; one
  // nobody has is left out and counted. The sign-out sheet offers it while media are waiting.
  const doExportZip = async () => {
    const { exportBackupZip } = await import('../lib/backup-media.js')
    const st = useStore.getState()
    const signedIn = !!(st.user && st.config?.media)
    let out
    try { out = await exportBackupZip(st.S, { fetchOne: signedIn ? fetchToStore : null }) }
    catch { toast(t('Something went wrong')); return }
    const name = 'opengym-backup-' + todayISO() + '.zip'
    if (out.missing) toast(tn('{0} file could not be included', '{0} files could not be included', out.missing))
    if (MOBILE) {
      try { await shareExportBlob(out.blob, name); if (!out.missing) toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(out.blob); a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60000)
    if (!out.missing) toast(t('Backup exported'))
  }
  // Import takes the JSON backup and the zip alike, told apart by their first bytes. A zip's
  // files go into the local store only once the import is confirmed, each checked against its
  // name first; the state's media refs and links pass the usual gates (lib/backup-media.js).
  const doImport = async ev => {
    const f = ev.target.files[0]; if (!f) return
    ev.target.value = ''
    let read
    try {
      const { readBackupFile } = await import('../lib/backup-media.js')
      read = await readBackupFile(f)
    } catch (e) {
      const { backupImportError } = await import('../lib/backup-media.js')
      toast(backupImportError(e)); return
    }
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
    }
    // Signed in, the server is asked first: a workout logged since the backup was made, or on
    // another device meanwhile, would be deleted from the profile by the replace — said, with the
    // choice to merge those in instead (useStore importConflict / importBackup).
    const conflict = await importConflict(read.state)
    if (conflict) {
      const n = conflict.workouts
      menuSheet({
        title: t('Import backup?'),
        subtitle: t(n === 1
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
  // Whether any custom exercise has a photo or video: the rows about them only show then.
  const hasMedia = referencedFiles(S).length > 0
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)
  /* Disconnect (phone), Sign out, Sign out everywhere. None of them wipes this device while the
     server is missing a change: the confirm no longer promises a sync it never checked, and when
     something is owed, a second sheet says how much and offers to try again, to export a backup,
     or to go ahead anyway with the changes kept on this device (components/ServerSync.jsx).
     "Sign out everywhere" also ends every paired phone's token — the phones have no passkey to
     sign in with, so they have to be paired again, and the confirm says so. Failing, it touches
     nothing local: still signed in here, and the toast says so. */
  const kept = t('The changes your server has not seen are kept on this device, and added back when it connects as this account again.')
  // A workout running here is kept aside by the sign-out (useStore stashActive): the confirm says so.
  const running = () => S.active ? ' ' + t('You have a workout running. It waits on this device until you’re back on this account.') : ''
  const leave = (kind, after) => leaveServer(kind, { exportBackup: doExport, exportBackupZip: doExportZip, done: r => { nav('/home'); if (r.stashed) toast(kept); else if (after) toast(after) } })
  const disconnect = () => confirmSheet({
    title: t('Disconnect from your server?'),
    message: t('This phone switches back to local-only and its copy of your account is removed. First it checks that your server has every change. If not, you choose what happens to them.') + running(),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => leave('disconnect', t('Disconnected. Back to local-only')),
  })
  const signOutHere = () => confirmSheet({
    title: t('Sign out?'),
    message: t('Your data is removed from this browser; your profile on the server keeps it. First it checks that the server has every change. If not, you choose what happens to them.') + running(),
    confirmText: t('Sign out'), danger: true,
    onConfirm: () => leave('signout'),
  })
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Phones paired with it are disconnected and have to be paired again. Your passkeys keep working, so you can sign in with them again anytime.') + running(),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: () => leave('everywhere', t('Signed out on all devices')),
  })
  // Signed in, the empty state is pushed to the profile like any other change, so the wipe
  // reaches the server and every device that syncs with it — the dialog has to say so. The Coach
  // keeps its data outside S in two homes that can both be in use on one phone: a file per
  // profile on the server, and — when it runs with the phone's own key — a file on the device.
  // Each is cleared on its own; forgetCoach() alone would pick one by mode. A failed call must
  // not stop the reset.
  const resetEverything = () => confirmSheet({
    title: t('Reset everything?'),
    message: user
      ? t('Deletes your plan, workouts, body weight, photos and videos from your profile on this server and on every signed-in device. This cannot be undone.')
      : t('Deletes your plan, workouts, body weight, photos and videos on this device. This cannot be undone.'),
    confirmText: t('Delete everything'), danger: true,
    onConfirm: () => {
      if (user) api('/api/coach/forget', { method: 'POST', body: '{}' }).catch(() => {})
      if (coachLocal?.mode === 'byok') forgetCoach().catch(() => {})
      resetAll()
      nav('/home'); toast(t('All data reset'))
      clearMediaAfterReset(!!user).catch(() => {})
    },
  })

  /* ---------------- what the pages and the search need to know about this device ---------------- */
  const canVibrate = vibrateSupported()
  const ctx = {
    user, mobile: MOBILE, android, demo: DEMO, wakeOK, hasMedia, pwOn, webauthn: webauthnOK(),
    sound: !!S.sound, playOnSilent: playOnSilentSupported(), canVibrate, vibrate: S.vibrate !== false,
    profiles: (S.equipProfiles || []).length > 0, nameLang: EXERCISE_NAME_LANGS.includes(baseLang(lang)),
    pushOK: !MOBILE && pushSupported(), reminderOn: !!S.reminder?.on, nudge: !!S.reminder?.nudge,
    autoBackup: !!S.autoBackup, synced: !!sync, installTip: !MOBILE && !standalone(), androidWeb: IS_ANDROID,
  }
  const mode = scheduleModeOf(S)
  const layout = ['list', 'compact', 'focus'].includes(S.workoutView) ? S.workoutView : 'cards'
  const layoutLabel = { cards: t('Cards'), list: t('List'), compact: t('Compact') }[layout]
  const activeProfile = (S.equipProfiles || []).find(p => p.id === S.activeEquipId)
  const themeLabel = { dark: t('Dark'), light: t('Light'), system: t('System') }[S.theme || 'dark'] || t('Dark')
  // The value a root row shows, so most questions are answered without opening the page.
  const preview = {
    workout: () => (S.restSec > 0 ? t('{0} rest', fmtRest(S.restSec)) : t('No rest timer')) + ' · ' + layoutLabel,
    alerts: () => [S.sound ? t('Sound') : null, canVibrate && S.vibrate !== false ? t('Vibrate') : null, S.timerFlash ? t('Flash') : null].filter(Boolean).join(' · ') || t('Silent'),
    reminders: () => (S.reminder?.on ? (S.reminder.time || DEF.reminder?.time || '') : t('Off')),
    plan: () => (mode === 'rotation' ? t('Rotation') : t('Fixed Week')) + ' · ' + shortWeekday(weekStartOf(S) === SUNDAY ? 0 : 1),
    units: () => (S.unit || 'kg') + ' · ' + (LANGS[lang] || lang),
    equipment: () => (S.equipFilterOn && activeProfile ? activeProfile.name : t('Everything')),
    look: () => themeLabel + ' · ' + accentLabel(S),
    coach: () => (coachLocal?.mode === 'server' ? t('Your server') : coachLocal?.mode === 'byok' ? t('Your API key') : t('Off')),
    data: () => '',
    about: () => 'v' + __APP_VERSION__,
  }

  const open = id => {
    if (id === 'coach') { nav('/coach/setup'); return }
    nav('/settings/' + id)
  }
  // Back the way you came when there is a way (the browser's back, Android's back, this button
  // all do the same); a page opened from a link with nothing behind it goes up to its parent.
  const back = () => {
    const up = PAGES[page]?.parent ? '/settings/' + PAGES[page].parent : '/settings'
    if ((window.history.state?.idx || 0) > 0) nav(-1)
    else nav(up, { replace: true })
  }

  /* ---------------- the pages ---------------- */
  const restRow = <Row icon="timer" iconTint="var(--orange)" title={t('Rest timer')} value={fmtRest(S.restSec)} accessory="chevron"
    onClick={() => durationSheet({
      title: t('Rest timer'), value: S.restSec, max: REST_MAX, off: t('Off'),
      footer: t('Scroll to 0:00 to turn the rest timer off.'),
      onDone: v => update(s => { s.restSec = v }),
    })} />
  // Default for a rest-pause burst added live on a plain set. A planned exercise's own "Rest (s)"
  // (in its drop set / burst config) overrides it, the same way the main rest timer is the
  // fallback for an exercise without a rest of its own. On the wheel too, 5 s to 5 min: the
  // burst's rest is never 0 (lib/history.js keeps it at 5 s at least), so the wheel stops there.
  const restPauseRow = <Row icon="bolt" iconTint="var(--orange)" title={t('Rest-pause rest')} value={fmtDuration(S.restPauseSec || 15)} accessory="chevron"
    onClick={() => durationSheet({
      title: t('Rest-pause rest'), value: S.restPauseSec || 15, min: REST_PAUSE_MIN, max: REST_PAUSE_MAX,
      footer: t('The short break between the bursts of a rest-pause set.'),
      onDone: v => update(s => { s.restPauseSec = v }),
    })} />

  const pages = {
    workout: () => <>
      <Section title={t('Rest')} footer={t('Each exercise can have its own rest too. Set it in the exercise settings of a routine.')}>
        {restRow}
        {restPauseRow}
      </Section>
      <Section title={t('Logging')}>
        {/* Two names for the same judgement, so the column asks in the scale you already think in.
            The (i) sits before the control: you read it on the way to the choice, not after it. */}
        <Row icon="gauge" iconTint="var(--purple)" title={t('Effort per set')}>
          <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
          <Segmented className="seg-inline"
            options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
            value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
        </Row>
        {/* The line under each exercise that the rows are held against (#173). Tapping the line in
            a workout switches it too; this is where the choice can be found without knowing that. */}
        <SelectRow icon="history" iconTint="var(--blue)" title={t('Shown under each exercise')}
          value={S.logRef === 'best' ? 'best' : 'last'} onChange={v => update(s => { s.logRef = v })}
          options={[
            { value: 'last', label: t('Last time'), subtitle: t('What you did the last time, in that routine.') },
            { value: 'best', label: t('Best set'), subtitle: t('Your heaviest set of the exercise, from any workout.') },
          ]} />
        {/* One exercise at a time (cards with Prev/Next), the whole session stacked as a
            scrollable list, or that list stripped to just names and set rows (compact). Legacy or
            unknown values read as cards. The workout's ⋯ menu can override it for one session. */}
        <Row icon="layout" iconTint="var(--blue)" title={t('Layout')}>
          <Segmented className="seg-inline"
            options={[{ value: 'cards', label: t('Cards') }, { value: 'list', label: t('List') }, { value: 'compact', label: t('Compact') }, { value: 'focus', label: t('Focus') }]}
            value={layout} onChange={v => update(s => { s.workoutView = v })} />
        </Row>
        {/* The saved side of the Layout menu's "Collapse completed exercises" (#241): on here, every
            session starts with it, and the menu still flips it for one session. Setting it here
            also drops a running session's own choice, so the switch does what it says right away. */}
        <Row icon="minimize" iconTint="var(--teal)" title={t('Collapse completed exercises')}
          subtitle={t('In List and Compact, a finished exercise folds into one line.')}>
          <Switch aria-label={t('Collapse completed exercises')} checked={!!S.collapseCompleted}
            onChange={v => update(s => { s.collapseCompleted = v; if (s.active) delete s.active.collapseCompleted })} />
        </Row>
      </Section>
      <Section title={t('Before and during')}>
        {/* The quick weigh-in that opens on Start (sheets.jsx startFlow, issue #137); off skips
            straight to the session. Home and Stats still log weight by hand. */}
        <Row icon="scale" iconTint="var(--green)" title={t('Weigh in before workouts')}
          subtitle={t('Asks for your body weight when a workout starts. Off starts the session straight away.')}>
          <Switch checked={S.weighIn !== false} onChange={v => update(s => { s.weighIn = v })} />
        </Row>
        {(wakeOK || !MOBILE) && (
          <Row icon="phoneScreen" iconTint="var(--yellow)" title={t('Keep screen awake')}
            subtitle={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : t('Not supported in this browser.')}>
            <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
              onChange={v => update(s => { s.keepAwake = v })} />
          </Row>
        )}
        {/* 'full'/'mini' is also what the tap-toggle on the workout animation writes; 'off' hides
            workout media entirely (library, detail sheet and picker thumbs are unaffected).
            Legacy/unknown values read as 'full'. */}
        <Row icon="image" iconTint="var(--teal)" title={t('Exercise animations')}>
          <Segmented className="seg-inline"
            options={[{ value: 'full', label: t('Full') }, { value: 'mini', label: t('Small') }, { value: 'off', label: t('Hidden') }]}
            value={S.gifSize === 'mini' || S.gifSize === 'off' ? S.gifSize : 'full'}
            onChange={v => update(s => { s.gifSize = v })} />
        </Row>
      </Section>
      <Section>
        <Row icon="wrench" iconTint="var(--grey)" title={t('Fine-tuning')} subtitle={t('Buttons, timed sets')} accessory="chevron" onClick={() => open('advanced')} />
      </Section>
    </>,

    advanced: () => {
      // S.wc overlays DEF.wc, so a profile from before these switches existed reads as the lean default.
      const wc = workoutControls(S)
      const setWc = (k, v) => update(s => { s.wc = { ...workoutControls(s), [k]: v } })
      return <>
        <Section title={t('Sessions and timed sets')}>
          {/* Whose reps a planned session opens with (lib/session-start.js). The plan's by default:
              the routine is what you said you would do, and history and progression decide the
              weight. The other choice is the old behaviour, reps carried over from last time.
              Absent (an older profile) reads as the plan. */}
          <SelectRow icon="clipboard" iconTint="var(--green)" title={t('Planned sessions start from')}
            value={S.startFrom === 'last' ? 'last' : 'plan'} onChange={v => update(s => { s.startFrom = v })}
            options={[
              { value: 'plan', label: t('Your plan'), subtitle: t('The routine’s sets and reps. Your history decides the weight.') },
              { value: 'last', label: t('Your last session'), subtitle: t('The reps you logged last time in that routine, carried over.') },
            ]} />
          <Row icon="stopwatch" iconTint="var(--orange)" title={t('Keep timing after target')}
            subtitle={t('Timed sets continue up to 15 extra minutes. Tap Done to log the actual duration.')}>
            <Switch aria-label={t('Keep timing after target')} checked={!!S.timedSetOvertime}
              onChange={v => update(s => { s.timedSetOvertime = v })} />
          </Row>
        </Section>
        {/* The lean workout screen keeps the sets and one "more" button per exercise; each switch
            brings one of the old always-visible button groups back for people who liked them. */}
        <Section title={t('Buttons on the workout screen')} footer={t('Everything hidden here stays one tap away: the ⋯ button of an exercise and the number of a set.')}>
          <Row icon="plusCircle" iconTint="var(--green)" title={t('Weight and reps buttons')} subtitle={t('Off: tap the number and type it')}>
            <Switch checked={wc.steppers} onChange={v => setWc('steppers', v)} />
          </Row>
          <Row icon="bolt" iconTint="var(--orange)" title={t('Drop and burst shortcuts on every set')}>
            <Switch checked={wc.setShortcuts} onChange={v => setWc('setShortcuts', v)} />
          </Row>
          {/* Swipe actions (v1.3.11): not a button, but the same question of what a set row does. The
              one switch covers Plan's lists too; the stored key keeps its old name, swipeSets. */}
          <Row icon="swap" iconTint="var(--indigo)" title={t('Swipe actions')} subtitle={t('Sets, routines and the loop: left removes, right copies')}>
            <Switch aria-label={t('Swipe actions')} checked={wc.swipeSets} onChange={v => setWc('swipeSets', v)} />
          </Row>
          {/* The chip row at the top of a workout (#323): not a button row, but the same question of
              what the workout screen shows. On by default, it is about one line tall. */}
          <Row icon="more" iconTint="var(--mint)" title={t('Exercise chips at the top')} subtitle={t('A numbered dot per exercise, filled as you go. Tap one to jump there.')}>
            <Switch aria-label={t('Exercise chips at the top')} checked={wc.exerciseChips} onChange={v => setWc('exerciseChips', v)} />
          </Row>
          <Row icon="link" iconTint="var(--blue)" title={t('Superset buttons in the exercise header')}>
            <Switch checked={wc.pairButtons} onChange={v => setWc('pairButtons', v)} />
          </Row>
          <Row icon="swap" iconTint="var(--teal)" title={t('Move, swap and remove buttons below the exercise')}>
            <Switch checked={wc.exerciseButtons} onChange={v => setWc('exerciseButtons', v)} />
          </Row>
        </Section>
      </>
    },

    alerts: () => {
      const iPhone = appleTouchDevice()
      return <>
        <Section title={t('When a rest ends')}>
          <Row icon="speaker" iconTint="var(--pink)" title={t('Play a sound')}>
            {/* Turning the sound on is a tap: unlock the audio context now so a timer that ends
                before the next set check can already sound (iOS, #152). */}
            <Switch checked={!!S.sound} onChange={v => { if (v) unlock(true); update(s => { s.sound = v }) }} />
          </Row>
          {/* The chime that replaced the original three beeps (Discord: "too quiet under music")
              is not an improvement for everyone: louder is a cost with headphones or in a quiet
              room, and some want a sound that feels like theirs (#306). The chime by default; the
              sheet plays each one as you tap it (restSoundSheet). */}
          {S.sound && <Row icon="speaker" iconTint="var(--pink)" title={t('Sound')} value={t(REST_SOUND_LABEL[restSoundOf(S)])}
            accessory="chevron" onClick={restSoundSheet} />}
          {/* iOS only (WebKit's audio-session API, iOS 17+): with it off the ring/silent switch
              mutes the timer. On, the phone treats the timer like a music player (exclusive, and
              the music app is not told it may resume), so it is a choice, off by default. */}
          {S.sound && playOnSilentSupported() && (
            <Row icon="speaker" iconTint="var(--orange)" title={t('Play even on silent')}
              subtitle={<>{t('Music playing on this phone stops during a workout and does not resume by itself.')}<br />{t('iPhone only')}</>}>
              <Switch checked={!!S.soundOnSilent} onChange={v => update(s => { s.soundOnSilent = v })} />
            </Row>
          )}
        </Section>
        {/* The buzz at the end of a rest or a hold and on a set tick, on its own switch like the
            sound (Discord, asierlama). iOS has no navigator.vibrate: the row stays, greyed out,
            and says so, instead of an iPhone user looking for a setting that is not there. */}
        <Section footer={!canVibrate && iPhone ? t('iPhone doesn’t let openGym vibrate. A sound or a flash does the job.') : null}>
          <Row icon="vibrate" iconTint="var(--indigo)" title={t('Vibrate')} className={canVibrate ? '' : 'dis'}
            subtitle={canVibrate ? null : iPhone ? t('Not on iPhone') : t('Not supported in this browser.')}>
            <Switch checked={canVibrate && S.vibrate !== false} disabled={!canVibrate} onChange={v => update(s => { s.vibrate = v })} />
          </Row>
          {/* Android app only (#375), and only shown there, so it needs no "Android app only" hint: silent mode mutes the ordinary buzz and the notification's,
              so the end of a rest or a hold can buzz as an alarm instead. Opt-in, like the iOS row
              above: an alarm-class buzz is the most insistent thing an app can do on some phones. */}
          {MOBILE && android && canVibrate && S.vibrate !== false && (
            <Row icon="vibrate" iconTint="var(--indigo)" title={t('Vibrate on silent too')}
              subtitle={t('The end of a rest or a hold buzzes like an alarm, even in silent mode.')}>
              <Switch checked={!!S.vibrateOnSilent} onChange={v => update(s => { s.vibrateOnSilent = v })} />
            </Row>
          )}
          <Row icon="sun" iconTint="var(--yellow)" title={t('Flash the screen')}>
            <Switch checked={!!S.timerFlash} onChange={v => update(s => { s.timerFlash = v })} />
          </Row>
        </Section>
      </>
    },

    reminders: () => <NotificationsCard S={S} update={update} toast={toast} />,

    plan: () => <>
      <Section>
        {/* Fixed Week (S.week) or Rotation (the live queue, lib/queue.js + lib/rotation.js).
            Derived from the queue, never stored. */}
        <Row icon="repeat" iconTint="var(--orange)" title={t('How you train')}>
          {externalQ
            ? <span className="small dim">{t('Rotation')} · {t('Externally managed')}</span>
            : <Segmented className="seg-inline"
                options={[{ value: 'week', label: t('Fixed Week') }, { value: 'rotation', label: t('Rotation') }]}
                value={mode} onChange={setScheduleMode} />}
        </Row>
        {/* Rotation chosen with no loop running yet: the loop is built on Plan. */}
        {mode === 'rotation' && !liveQ && <Row icon="calendar" iconTint="var(--orange)" title={t('Build your loop in Plan')}
          accessory="chevron" onClick={() => nav('/plan')} />}
        {/* Monday or Sunday: the Plan list, the Home strip, the calendar grid and every "this
            week" total follow it. Stored as a getDay() index (see lib/format.js). */}
        <Row icon="calendar" iconTint="var(--orange)" title={t('Week starts on')}>
          <Segmented className="seg-inline"
            options={[{ value: MONDAY, label: t('Monday') }, { value: SUNDAY, label: t('Sunday') }]}
            value={weekStartOf(S)} onChange={v => update(s => { s.weekStart = v })} />
        </Row>
      </Section>
      <Section>
        <Row icon="clipboard" iconTint="var(--green)" title={t('Load starter plan')} accessory="chevron" onClick={starterPlanSheet} />
      </Section>
    </>,

    units: () => <>
      <Section>
        <SelectRow
          icon="globe" iconTint="var(--blue)" title={t('Language')}
          value={lang} onChange={v => update(s => { s.lang = v; s.langAuto = false })}
          options={Object.entries(LANGS).map(([k, name]) => ({
            value: k, label: name,
            subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't translated into this language yet, so they stay in English."),
          }))}
        />
        {ctx.nameLang && <>
          <Row icon="globe" iconTint="var(--purple)" title={t('English exercise names')}
            subtitle={t('Show the English name in parentheses next to the translated one.')}>
            <Switch checked={S.enParens?.[baseLang(lang)] ?? true}
              disabled={S.enOnly?.[baseLang(lang)] === true}
              onChange={v => update(s => { s.enParens = { ...(s.enParens || {}), [baseLang(lang)]: v } })} />
          </Row>
          <Row icon="globe" iconTint="var(--purple)" title={t('English names only')}
            subtitle={t('Replace the translated names with the original English ones.')}>
            <Switch checked={S.enOnly?.[baseLang(lang)] === true}
              onChange={v => update(s => { s.enOnly = { ...(s.enOnly || {}), [baseLang(lang)]: v } })} />
          </Row>
        </>}
      </Section>
      <Section footer={t('Switching the unit offers to convert every stored weight.')}>
        <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
          <Segmented className="seg-inline"
            options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
            value={S.unit} onChange={v => switchUnit(v)} />
        </Row>
        {/* Display only: one decimal reads fine for plate-loadable numbers, two for anyone whose
            per-side figure lands on .25 or .75, or who loads microplates (issue #139). Nothing is
            stored or rounded differently; lib/format.js fmtNum just prints what is already there. */}
        <Row icon="ruler" iconTint="var(--teal)" title={t('Weight decimals')} subtitle={t('How precisely weights are shown.')}>
          <Segmented className="seg-inline"
            options={[{ value: 1, label: t('0.5') }, { value: 2, label: t('0.25') }]}
            value={S.wdec === 2 ? 2 : 1} onChange={v => update(s => { s.wdec = v })} />
        </Row>
        {/* Cardio speed (Discord "miles per hour"). Unlike the weight unit this converts nothing:
            speeds stay stored in km/h and only what is shown and typed follows it (lib/speed.js).
            Until chosen it follows the weight unit, so a profile in pounds already reads mph. */}
        <Row icon="figureRun" iconTint="var(--teal)" title={t('Speed unit')}>
          <Segmented className="seg-inline"
            options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]}
            value={speedUnitOf(S)} onChange={v => update(s => { s.speedUnit = v })} />
        </Row>
        {/* Which formula turns a set into an estimated 1RM (Discord, #155): the exercise page,
            the 1RM chart and records all follow it. Formula names are people, not words. */}
        <SelectRow icon="chart" iconTint="var(--teal)" title={t('1RM formula')}
          value={formulaOf(S)} onChange={v => update(s => { s.oneRmFormula = v })}
          options={[
            { value: 'epley', label: 'Epley', subtitle: t('The common one. A bit generous at higher reps.') },
            { value: 'brzycki', label: 'Brzycki', subtitle: t('More conservative above five reps.') },
            { value: 'lombardi', label: 'Lombardi', subtitle: t('Generous, especially at high reps.') },
            { value: 'oconner', label: FORMULA_NAMES.oconner, subtitle: t('The most conservative of the classics.') },
            { value: 'mayhew', label: 'Mayhew' },
            { value: 'wathan', label: 'Wathan' },
            { value: 'lander', label: 'Lander' },
            { value: 'weighted', label: t('Blend of all'), subtitle: t('Averages seven formulas and reads your RIR when you log it.') },
          ]} />
      </Section>
    </>,

    equipment: () => <EquipmentCard S={S} update={update} />,

    look: () => <>
      <Section footer={DEMO || MOBILE || !user ? undefined : t('synced with your profile')}>
        <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
          <Segmented
            className="seg-inline"
            options={[
              { value: 'dark', icon: 'moon', label: t('Dark') },
              { value: 'light', icon: 'sun', label: t('Light') },
              { value: 'system', icon: 'gear', label: t('System') },
            ]}
            value={S.theme || 'dark'}
            onChange={v => update(s => { s.theme = v })}
          />
        </Row>
        <div className="lrow" style={{ flexWrap: 'wrap', rowGap: 12, paddingBottom: 14 }}>
          <span className="lrow-i" style={{ '--tint': 'var(--purple)' }}><Icon name="palette" /></span>
          <span className="lrow-m"><span className="lrow-t">{t('Accent color')}</span></span>
          <span className="lrow-v">{accentLabel(S)}</span>
          <AccentSwatches S={S} update={update} />
        </div>
        {/* How the muscle map is drawn. The exercise drawings follow it until they are set below. */}
        <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
          <Segmented
            className="seg-inline"
            options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
            value={S.body === 'female' ? 'female' : 'male'}
            onChange={v => update(s => { s.body = v })}
          />
        </Row>
        {/* Which figure the exercise animations show where both exist (about 940 exercises; the
            rest are drawn once). Only the picture changes: the exercise and its id stay the same,
            so nothing logged is touched, on this device or any other. */}
        <Row icon="figureStrength" iconTint="var(--teal)" title={t('Exercise drawings')}
          subtitle={t('Where an exercise is drawn on both figures. Your workouts stay exactly as they are.')}>
          <Segmented
            className="seg-inline"
            options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
            value={figureOf(S)}
            onChange={v => update(s => { s.exFigure = v })}
          />
        </Row>
      </Section>
      <Section title={t('On Home')}>
        {/* Membership QR codes on Home (views/CheckIn.jsx); off = no Home card, no route. */}
        <Row icon="qr" iconTint="var(--blue)" title={t('Gym check-in')}
          subtitle={t('Show a card on Home with your membership QR codes.')}>
          <Switch checked={S.checkIn !== false} onChange={v => update(s => { s.checkIn = v })} />
        </Row>
        {/* The Home summary is optional; hiding it leaves weight logging, history and Stats intact. */}
        <Row icon="scale" iconTint="var(--green)" title={t('Body weight')}
          subtitle={t('Show the body weight card on Home.')}>
          <Switch checked={S.showWeightCard !== false} onChange={v => update(s => { s.showWeightCard = v })} />
        </Row>
        {/* The bar at the top that says the app is offline, kept local, or not synced (#369, #330).
            Here and not under Server & sync, which a phone kept local never shows. Switching it on
            also brings back the no-server line its × hid (#454). */}
        {!DEMO && <Row icon="cloud" iconTint="var(--blue)" title={t('Show connection status')}
          subtitle={t('Off: the bar at the top is hidden. A dot on Home still warns when syncing is stuck.')}>
          <Switch checked={S.connStatus !== false} onChange={v => update(s => { s.connStatus = v; if (v) s.connLocal = true })} />
        </Row>}
      </Section>
    </>,

    data: () => <>
      <Section title={t('Back up')}>
        <Row icon="share" iconTint="var(--blue)" title={t('Export backup (JSON)')} subtitle={hasMedia ? t('Without photos and videos') : undefined} accessory="chevron" onClick={doExport} />
        {hasMedia && <Row icon="share" iconTint="var(--blue)" title={t('Export with photos & videos (.zip)')} accessory="chevron" onClick={doExportZip} />}
        {/* 14 is AUTO_BACKUP_KEEP in lib/mobile.js, written out because the Settings tests mock
            that module wholesale; mobile.autobackup.test.js pins the two together. */}
        {MOBILE && <Row icon="folder" iconTint="var(--blue)" title={t('Auto-backup on changes')}
          subtitle={autoBackupSubtitle(android && S.autoBackup ? backupDir : null, 14)}>
          <Switch checked={!!S.autoBackup} onChange={v => update(s => { s.autoBackup = v })} />
        </Row>}
        {/* Android only: the system folder picker (#161). iOS shows Documents in Files already. */}
        {MOBILE && android && S.autoBackup && <BackupFolderRow />}
      </Section>
      {MOBILE && android && <HealthConnectCard S={S} toast={toast} />}
      <Section title={t('Bring data in')}>
        <Row icon="download" iconTint="var(--teal)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
        <Row icon="download" iconTint="var(--teal)" title={t('Import from another app')}
          subtitle={t('FitNotes, Strong, Hevy, or body weight from Apple Health')}
          accessory="chevron" onClick={() => importRef.current.click()} />
        <Row icon="key" iconTint="var(--teal)" title={t('Import from Hevy')}
          subtitle={t('Pull your history with a Hevy Pro API key')}
          accessory="chevron" onClick={importFromHevy} />
      </Section>
      {hasMedia && <Section><MediaRow /></Section>}
      <Section>
        {(S.deletedEx?.length > 0) && <Row icon="reset" iconTint="var(--grey)" title={t('Manage hidden exercises')}
          subtitle={t(S.deletedEx.length === 1 ? '{0} built-in exercise hidden — restore it any time.' : '{0} built-in exercises hidden — restore them any time.', S.deletedEx.length)}
          accessory="chevron" onClick={hiddenExercisesSheet} />}
        <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={resetEverything} />
      </Section>
      <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" style={{ display: 'none' }} onChange={doImport} />
      {/* Reset after reading so picking the same file twice still fires onChange. */}
      <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
        onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />
    </>,

    about: () => <>
      {/* Updates. On Android the row is always there: it checks on demand and installs when a
          release is newer (checksum verified, see onUpdateRowClick). On the web the app updates
          with its server, so the row points at the APK for the phone instead. iOS has no APK. */}
      <Section footer={MOBILE ? (android ? t('Releases are checked on gitlab.com. The download is verified against its checksum before the installer opens.') : null) : t('The web app updates together with your server. The Android app installs its own updates from here.')}>
        <Row icon="info" iconTint="var(--grey)" title={t('Version')} value={'v' + __APP_VERSION__} />
        {MOBILE
          ? android && <Row icon="download" iconTint="var(--green)"
              title={updateInfo?.hasUpdate ? t('Update to openGym v{0}', updateInfo.latestVersion) : t('Check for updates')}
              subtitle={checking ? t('Checking…') : t('You have v{0}', __APP_VERSION__)}
              accessory="chevron"
              onClick={() => (updateInfo?.hasUpdate ? onUpdateRowClick() : checkNow())} />
          : <Row icon="download" iconTint="var(--green)" title={t('Get the Android app')}
              subtitle={t('Download the APK from opengym.ch')} accessory="chevron"
              onClick={() => window.open('https://opengym.ch/#download', '_blank', 'noopener')} />}
      </Section>
      {/* "Add to Home screen": not inside the phone app, and not once it is installed. */}
      {!MOBILE && !standalone() && <Section title={t('Tip')}>
        <Row icon="share" iconTint="var(--blue)"
          title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
          subtitle={t('to install openGym as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile. Sign in anywhere and it’s there.') : t('Guest data stays on this device, so export a backup now and then!'))} />
      </Section>}
      {/* The version, where the support template tells people to look for it. On the phone
          build there is no address bar and no about box, so without this there is no way to tell
          which build you are running, or whether an update actually installed. */}
      <div className="dim small sp-version">
        openGym v{__APP_VERSION__} · {t('free & open source (AGPL v3)')}<br />
        <a href="https://github.com/DuarteSantos8/openGym" target="_blank" rel="noopener">{t('Source code')}</a><br />
        {/* Attribution the media licence asks for word for word (agreement §8c), so it is not translated */}
        Exercise media © Aliaksandr Makatserchyk, <a href="https://gymvisual.com/" target="_blank" rel="noopener">Gym visual</a>, gymvisual.com.
        Media licensed for use in openGym only; see <a href="https://github.com/DuarteSantos8/openGym/blob/main/NOTICE.md" target="_blank" rel="noopener">NOTICE.md</a>
      </div>
    </>,

    account: () => <>
      {/* The server: which one, which account, how that stands, "Sync now". A paired phone's
          Admin and Disconnect sit in the same block; a browser's account rows follow in their own. */}
      {user && !DEMO && <ServerSyncSection>
        {MOBILE && <>
          {user.admin && <Row icon="crown" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
          <AccountIdRow id={user.id} />
          <Row icon="signOut" iconTint="var(--red)" title={t('Disconnect')} danger onClick={disconnect} />
        </>}
      </ServerSyncSection>}

      {/* account (demo and mobile builds have nothing to sign in to) */}
      {!(MOBILE && user) && <Section title={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')}>
        {MOBILE ? <>
          <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud. Back it up anytime in Data & backup.')} />
          <Row icon="cloud" iconTint="var(--indigo)" title={t('Connect to my server')} subtitle={t('Sync this device to your own self-hosted openGym instead.')} accessory="chevron"
            onClick={connectServer} />
          <KeptChangesRows />
        </> : DEMO ? <>
          <Row icon="info" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser. Go wild and change anything you like.')} />
          <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
            onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
          <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
            onClick={() => window.open(REPO, '_blank', 'noopener')} />
        </> : user ? <>
          {user.admin && <Row icon="crown" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
          <PasskeysRow state={passkeys.st} changed={credsChanged} />
          <DeviceLinkRow state={passkeys.st} />
          <Row icon="qr" iconTint="var(--blue)" title={t('Pair the mobile app')} subtitle={t('Connect the openGym app on your phone to this account.')} accessory="chevron"
            onClick={() => useUI.getState().openSheet(close => <PairSheet close={close} />)} />
          {pwOn && <PasswordRow version={credsV} />}
          <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={signOutHere} />
          <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
          <AccountIdRow id={user.id} />
        </> : webauthnOK() ? <>
          <Row icon="plusCircle" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
          <Row icon="fingerprint" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={passkeySignIn} />
          {/* The Login screen offers both of these; a guest who skipped it had no way to either from here. */}
          {pwOn && <Row icon="plusCircle" iconTint="var(--orange)" title={t('Create profile with a password')} accessory="chevron" onClick={openPasswordRegister} />}
          {pwOn && <Row icon="key" iconTint="var(--orange)" title={t('Sign in with password')} accessory="chevron" onClick={() => openPasswordSignIn()} />}
          <Row icon="qr" iconTint="var(--blue)" title={t('Use a code from your other device')} accessory="chevron" onClick={openDeviceLinkRedeem} />
          <KeptChangesRows />
        </> : pwOn ? <>
          {/* No passkeys in this browser (plain http on a LAN address, say): a password is the way in. */}
          <Row icon="plusCircle" iconTint="var(--acc)" title={t('Create new profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={openPasswordRegister} />
          <Row icon="key" iconTint="var(--orange)" title={t('Sign in with password')} accessory="chevron" onClick={() => openPasswordSignIn()} />
          <KeptChangesRows />
        </> : <>
          <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
          <KeptChangesRows />
        </>}
      </Section>}
      {/* The connection banner already says this to a guest; the line is for when it is switched
          off, or its × hid it (#454). */}
      {!user && !DEMO && !MOBILE && !(showsConnection(S) && showsLocalLine(S)) && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode: your data lives only in this browser.')}</p>}
    </>,
  }

  /* ---------------- a page ---------------- */
  if (page && pages[page]) {
    const parent = PAGES[page].parent
    return <div className="narrow" ref={body}>
      <div className="sp-nav">
        {/* Named by what it says ("Settings", "Workout"), so a voice command for the visible
            word finds it; the chevron is hidden from assistive tech. */}
        <button className="sp-back" onClick={back}>
          <Icon name="chevronLeft" /><span>{parent ? t(PAGES[parent].title) : t('Settings')}</span>
        </button>
        <h1 className="sp-title">{t(PAGES[page].title)}</h1>
      </div>
      {pages[page]()}
    </div>
  }

  /* ---------------- the root ---------------- */
  return <SettingsRoot ctx={ctx} preview={preview} open={open} user={user} sync={sync}
    home={() => nav('/home')} go={(hit) => {
      if (hit.page === 'coach') { nav('/coach/setup'); return }
      nav('/settings/' + hit.page, hit.isPage ? undefined : { state: hit.via ? { find: hit.title, via: hit.via } : { find: hit.title } })
    }} />
}

function SettingsRoot({ ctx, preview, open, user, sync, home, go }) {
  // The router's key for this history entry (what useLocation().key reads), taken once.
  const [key] = useState(() => window.history.state?.key || null)
  const [q, setQ] = useState(() => (key && lastQuery.key === key ? lastQuery.q : ''))
  const set = v => { lastQuery = { q: v, key }; setQ(v) }
  const hits = q.trim() ? searchSettings(q, ctx) : null
  // The account card: who this is, and the one line that matters about it.
  const acct = DEMO ? { title: t('Demo'), sub: t('Example data, only in this browser.') }
    : user ? {
      title: user.name || t('Account'),
      sub: sync && sync.status && sync.status !== 'ok' ? t('Sync needs a look') : MOBILE ? t('Synced with your server') : t('Account, devices and sync'),
    }
    : MOBILE ? { title: t('This phone'), sub: t('All data stays on this phone') }
    : { title: t('Guest'), sub: t('Your data lives on this device. Sign in to sync.') }
  const initial = user && !DEMO ? String(user.name || '?').trim().charAt(0).toUpperCase() : null
  return <div className="narrow">
    <div className="sp-nav">
      <button className="sp-back" onClick={home} aria-label={t('Home')}><Icon name="chevronLeft" /><span>{t('Home')}</span></button>
    </div>
    <h1 className="sp-root-title">{t('Settings')}</h1>
    <div className="sp-search">
      <SearchField value={q} onChange={e => set(e.target.value)} onClear={() => set('')}
        placeholder={t('Search…')} aria-label={t('Search settings')} inputMode="search" enterKeyHint="search" autoComplete="off" />
    </div>
    {hits ? (hits.length ? <Section title={tn('{0} result', '{0} results', hits.length)}>
      {hits.slice(0, 40).map(h => (
        <Row key={h.page + ':' + h.title} icon={h.icon} iconTint={h.tint} title={h.label} subtitle={h.trail} accessory="chevron" onClick={() => go(h)} />
      ))}
    </Section> : <div className="sp-empty">{t('No setting matches “{0}”.', q.trim())}</div>) : <>
      <Section>
        <button className="lrow tap sp-acct" onClick={() => open('account')}>
          <span className={'sp-avatar' + (initial ? ' on' : '')} aria-hidden="true">{initial || <Icon name="personCircle" />}</span>
          <span className="lrow-m"><span className="lrow-t">{acct.title}</span><span className="lrow-s">{acct.sub}</span></span>
          <Icon name="chevronRight" className="lrow-c" />
        </button>
      </Section>
      {ROOT_GROUPS.map(g => g.filter(id => pageVisible(id, ctx))).filter(g => g.length).map(g => (
        <Section key={g[0]}>
          {g.map(id => <Row key={id} icon={PAGES[id].icon} iconTint={PAGES[id].tint} title={t(PAGES[id].title)}
            value={preview[id]?.() || null} accessory="chevron" onClick={() => open(id)} className="sp-root-row" />)}
        </Section>
      ))}
      <div className="dim small sp-version">openGym v{__APP_VERSION__}</div>
    </>}
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left, went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy, warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2


// Download progress sheet — receives a ref callback that exposes a (received, total) setter.
// Uses forwardRef so the caller can push byte counts in without re-rendering the whole Settings tree.
const DownloadProgress = forwardRef(function DownloadProgress(_, ref) {
  const [pct, setPct] = useState(0)
  const [text, setText] = useState(t('Starting download…'))
  // Expose a setter the caller can invoke directly
  if (ref) ref(function update(received, total) {
    if (total > 0) {
      const p = Math.min(100, Math.round((received / total) * 100))
      setPct(p)
      setText(t('{0} %', p))
    } else {
      setText(t('{0} MB', (received / 1_000_000).toFixed(1)))
    }
  })
  return (
    <div style={{ textAlign: 'center', padding: '8px 0' }}>
      <h3>{t('Downloading update…')}</h3>
      <div style={{ margin: '16px 0', height: 6, borderRadius: 3, background: 'var(--fill-3)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: pct + '%', background: 'var(--acc)', borderRadius: 3, transition: 'width .2s' }} />
      </div>
      <div className="muted small">{text}</div>
    </div>
  )
})

// Settings → Sound (#306): every end-of-rest sound, each played as it is picked so you hear it
// before the next rest does. The sheet stays open for the next one; Done closes it. Stored as
// S.restSound, with S.classicChime kept for an app from before (lib/rest-sounds.js restSoundOf).
const REST_SOUND_LABEL = { chime: 'Chime (louder)', classic: 'Classic beeps', bell: 'Bell', beep: 'Beep-beep', whistle: 'Whistle', soft: 'Soft' }
const REST_SOUND_HINT = {
  classic: 'The quieter three-beep sound from before 1.3.9, instead of the louder chime.',
  bell: 'Ding-dong. Rest is over, class is in.',
  beep: 'Your sports watch, calling you back.',
  whistle: 'Coach wants you back on the bar.',
  soft: 'Gentle, for headphones or a quiet room.',
}
export function pickRestSound(id) {
  unlock(true)
  useStore.getState().update(s => { s.restSound = id; s.classicChime = id === 'classic' })
  chime(true, id)
}
export function RestSoundSheet({ close }) {
  const S = useStore(s => s.S)
  const cur = restSoundOf(S)
  return <>
    <h3>{t('Sound')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Tap one to hear it.')}</div>
    <Section>
      {REST_SOUND_IDS.map(id => <Row key={id} icon={id === cur ? 'speaker' : 'play'} iconTint="var(--pink)" title={t(REST_SOUND_LABEL[id])}
        subtitle={REST_SOUND_HINT[id] ? t(REST_SOUND_HINT[id]) : null} accessory={id === cur ? 'check' : 'none'}
        onClick={() => pickRestSound(id)} />)}
    </Section>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={close}>{t('Done')}</Button>
  </>
}
const restSoundSheet = () => useUI.getState().openSheet(close => <RestSoundSheet close={close} />)

// Settings → Data → "Manage hidden exercises" (issue #199). Lists every id in S.deletedEx,
// resolved against the pristine EXDB (not effectiveCatalogue/allExercises, which filter hidden
// ids out) so a hidden name still shows correctly; a stale id absent from EXDB falls back to
// showing the raw id so the row is never blank. Reads S itself (rather than taking it as a
// prop) so it re-renders as items are restored instead of needing to be closed and reopened.
function HiddenExercisesSheet({ close }) {
  const S = useStore(s => s.S)
  const { update } = useStore()
  const ids = S.deletedEx || []
  const restore = id => update(s => { s.deletedEx = (s.deletedEx || []).filter(x => x !== id) })
  const restoreAll = () => update(s => { s.deletedEx = [] })
  return <>
    <h3>{t('Manage hidden exercises')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>
      {t('Built-in exercises hidden from the library and picker. Restoring one brings it back everywhere.')}
    </div>
    {ids.length === 0 ? <div className="dim small">{t('Nothing hidden.')}</div> : <>
      <div className="list" style={{ marginBottom: 8 }}>
        {ids.map(id => {
          const ex = EXDB.find(e => e.id === id)
          return (
            <div key={id} className="item">
              <span className="grow">{ex ? ex.n : id}</span>
              <Button size="sm" onClick={() => restore(id)}>{t('Restore')}</Button>
            </div>
          )
        })}
      </div>
      <Button onClick={restoreAll}>{t('Restore all')}</Button>
    </>}
  </>
}
function hiddenExercisesSheet() {
  useUI.getState().openSheet(close => <HiddenExercisesSheet close={close} />)
}

function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left in the tank; RPE reads the same effort off a 10-point scale, so RPE ≈ 10 − RIR. Pick whichever you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value, so progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

function NotificationsCard({ S, update, toast }) {
  if (MOBILE) return <MobileReminderCard S={S} update={update} toast={toast} />
  return <PushCard S={S} update={update} toast={toast} />
}

// Mobile build: the reminder is a native local notification scheduled on planned weekdays —
// no push server involved. The schedule itself is (re)synced by the store on every persist;
// this card only owns the OS permission prompt when the switch turns on.
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section title={t('Notifications')}
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') + nudgeNote(S) : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
      {S.reminder?.on && <NudgeRows S={S} setReminder={setReminder} />}
    </Section>
  )
}

// The missed-workout nudge (lib/nudge.js): a switch and its tone, under the reminder they ride
// on — the server sends it with the same push (or the phone schedules it beside the reminder).
function NudgeRows({ S, setReminder }) {
  const r = S.reminder || {}
  return <>
    <Row icon="bell" iconTint="var(--red)" title={t('Nudge me when I skip a planned workout')}>
      <Switch checked={!!r.nudge} onChange={() => setReminder({ nudge: !r.nudge })} />
    </Row>
    {r.nudge && (
      <SelectRow icon="chat" iconTint="var(--blue)" title={t('Nudge tone')}
        value={toneOf(r)} onChange={v => setReminder({ tone: v })}
        options={NUDGE_TONES.map(k => ({ value: k, label: toneLabel(k), subtitle: t(NUDGE_COPY[k].title) }))} />
    )}
  </>
}
const toneLabel = k => k === 'guilt' ? t('Guilt trip') : k === 'drill' ? t('Drill sergeant') : t('Friendly')
const nudgeNote = S => S.reminder?.nudge
  ? ' ' + t('One nudge in the evening of a planned day with nothing logged, between 20:00 and 21:30. After 3 missed days in a row it goes quiet until your next workout.')
  : ''

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  // "On" means the server holds this browser's subscription, not merely that the browser has
  // one: a row the instance dropped (dead send, rebuilt db.json) left the switch on with nothing
  // ever arriving. syncPushSubscription re-registers on the way; if the server cannot be asked
  // (offline), the browser's side is the best answer available.
  useEffect(() => {
    if (!supported) return
    let gone = false
    syncPushSubscription()
      .then(ok => { if (!gone) setOn(ok) })
      .catch(() => navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => { if (!gone) setOn(!!sub) }).catch(() => {}))
    return () => { gone = true }
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent! Should pop up any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  if (!supported) return (
    <Section title={t('Notifications')}>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      title={t('Notifications')}
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '') +
          nudgeNote(S)
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer alerts, even if openGym is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle} />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <NudgeRows S={S} setReminder={patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })} />
      )}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}

// Equipment profiles ("Home", "Gym", ...) — each an id/name/eq-list; the active one filters
// the Library, exercise picker, and flags routine entries that need something outside it
// (see lib/equipment.js). Purely local/synced state — no server changes needed.
// What the chosen accent is called: a preset's colour name, or the user's own.
function accentLabel(S) {
  const k = accentKey(S)
  return k === CUSTOM ? t('Your own color') : t(ACCENT_NAMES[k] || 'Green')
}

/**
 * The presets, then one swatch for a colour of the user's own (lib/accent.js). With no colour
 * of their own yet it is a rainbow ring, and a tap opens the system colour picker straight away.
 * Once there is one it is filled with it: a tap picks it again (it is kept while a preset is
 * chosen), and a tap on it while it is the accent opens the picker to change it. The picker is
 * the native <input type="color"> laid over the swatch, so the tap that opens it is the user's
 * own, which iOS Safari and the Android WebView both want.
 */
// How long the colour picker has to rest before a colour is saved, when the browser sends no
// `change` at the end (it should, once the picker closes).
const OWN_COLOR_SETTLE_MS = 400

function AccentSwatches({ S, update }) {
  const key = accentKey(S)
  const own = cleanHex(S.accentCustom)
  const onCustom = key === CUSTOM
  const pickPreset = k => { update(s => { s.accent = k }); setRestAccent(k) }
  const pickOwn = hex => {
    const c = cleanHex(hex)
    if (!c || (onCustom && c === own)) return
    update(s => { s.accent = CUSTOM; s.accentCustom = c })
    setRestAccent(c)
  }
  // The picker sends a colour for every step of a drag (React's onChange is the `input` event).
  // Those only repaint the page; the colour is saved, synced and sent to the native countdown
  // once: on the picker's `change`, after it has rested a moment, or when Settings closes.
  const inputRef = useRef(null)
  const pending = useRef(null)
  const timer = useRef(0)
  const pickOwnRef = useRef(pickOwn)
  pickOwnRef.current = pickOwn
  const commit = () => {
    clearTimeout(timer.current)
    const c = pending.current
    pending.current = null
    if (c) pickOwnRef.current(c)
  }
  const preview = hex => {
    const c = cleanHex(hex)
    if (!c) return
    const de = document.documentElement
    applyAccent(de, c, de.dataset.theme)
    pending.current = c
    clearTimeout(timer.current)
    timer.current = setTimeout(commit, OWN_COLOR_SETTLE_MS)
  }
  const hasInput = !(own && !onCustom)
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onChange = () => { pending.current = cleanHex(el.value) || pending.current; commit() }
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [hasInput]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => commit, []) // eslint-disable-line react-hooks/exhaustive-deps
  // The input is not controlled (React would put the saved colour back after every drag step);
  // a colour changed elsewhere (sync, another tab) is put in by hand.
  useEffect(() => {
    if (!pending.current && inputRef.current) inputRef.current.value = own || '#30d158'
  }, [own])
  const ownLabel = t('Your own color')
  const grey = own && isGrey(own)
  const notes = own && onCustom ? [
    adjustedIn(own, 'dark') && (grey ? t('Greys show lighter in dark mode, so buttons don’t look switched off.') : t('A touch lighter in dark mode, so you can still read it.')),
    adjustedIn(own, 'light') && (grey ? t('Greys show darker in light mode, so buttons don’t look switched off.') : t('A touch darker in light mode, so you can still read it.')),
  ].filter(Boolean) : []
  return <>
    <div className="swatches" style={{ flexBasis: '100%', paddingInlineStart: 41 }}>
      {Object.entries(ACCENTS).map(([k, c]) => (
        <button key={k} className={'swatch' + (key === k ? ' on' : '')}
          style={{ background: c }} onClick={() => pickPreset(k)} aria-label={t(ACCENT_NAMES[k] || k)} />
      ))}
      {!hasInput
        ? <button className="swatch swatch-own" style={{ background: own }} onClick={() => pickOwn(own)} aria-label={ownLabel} />
        : <span className={'swatch swatch-own' + (own ? ' on' : ' unset')} style={own ? { background: own, color: inkOn(own) } : undefined}>
          {own ? <Icon name="pencil" /> : <Icon name="plus" />}
          <input ref={inputRef} type="color" className="swatch-input" defaultValue={own || '#30d158'}
            onChange={e => preview(e.target.value)}
            aria-label={own ? t('Change your own color') : t('Pick your own color')} />
        </span>}
    </div>
    {notes.map(n => <span key={n} className="lrow-s swatch-note" style={{ flexBasis: '100%', paddingInlineStart: 41 }}>{n}</span>)}
  </>
}

function EquipmentCard({ S, update }) {
  const profiles = S.equipProfiles || []
  const remove = p => confirmSheet({
    title: t('Delete profile?'), message: t('"{0}" and its equipment list will be removed.', p.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => update(s => {
      s.equipProfiles = (s.equipProfiles || []).filter(x => x.id !== p.id)
      if (s.activeEquipId === p.id) s.activeEquipId = (s.equipProfiles[0] && s.equipProfiles[0].id) || null
    }),
  })
  // The plates you own, per unit (lib/plates.js) — what the set rows' plate lines load from.
  const plateSummary = ownsPlates(S)
    ? inventoryFor(S).map(p => fmtPlate(p.w) + '×' + p.n).join(' · ') || t('None')
    : t('Standard set. Tap to count the pairs you own.')
  // The dumbbells you own, per unit (lib/dumbbells.js): what dumbbell lifts step and progress over.
  const bells = dumbbellsOf(S)
  const dumbbellSummary = bells.length
    ? bells.map(fmtPlate).join(' · ')
    : t('Any weight. Tap to list the ones you own.')
  return <Section title={t('Equipment')} footer={t('Filters the exercise library and picker, and flags routine exercises that need something you don’t have in the active profile.')}>
    <Row icon="plate" iconTint="var(--orange)" title={t('Plates')} subtitle={plateSummary} accessory="chevron" onClick={() => plateInventorySheet()} />
    <Row icon="dumbbell" iconTint="var(--teal)" title={t('Dumbbells')} subtitle={dumbbellSummary} accessory="chevron" onClick={() => dumbbellInventorySheet()} />
    {profiles.length > 0 && <Row icon="kettlebell" iconTint="var(--acc)" title={t('Filter by equipment')}>
      <Switch checked={!!S.equipFilterOn} onChange={v => update(s => { s.equipFilterOn = v })} />
    </Row>}
    {profiles.length > 0 && <SelectRow icon="house" iconTint="var(--blue)" title={t('Active profile')}
      value={S.activeEquipId || ''} onChange={v => update(s => { s.activeEquipId = v })}
      options={profiles.map(p => ({ value: p.id, label: p.name }))} />}
    {profiles.map(p => (
      <Row key={p.id} icon="house" iconTint="var(--teal)" title={p.name}
        subtitle={t('{0} equipment types', p.equipment.length)} accessory="chevron"
        onClick={() => equipmentProfileSheet(p)}>
        <button className="iconbtn" aria-label={t('Delete')} onClick={ev => { ev.stopPropagation(); remove(p) }}><Icon name="trash" /></button>
      </Row>
    ))}
    <Row icon="plus" iconTint="var(--acc)" title={t('Add equipment profile')} accessory="chevron" onClick={() => equipmentProfileSheet(null)} />
  </Section>
}

// The account's id, small and one tap to copy (#219). It is what an admin puts in ADMIN_UIDS,
// and the one thing that names an account beyond doubt when someone asks their admin for help:
// display names are free text and need not be unique. copyText also reaches the clipboard on a
// plain-http LAN address, where the Clipboard API is missing and password sign-in (#118) is the
// usual way in; where no copy works at all the id is still on screen to read out.
/* After "Reset everything": the photos and videos go too. Signed in, the empty state is pushed
   first and, once the server holds it, the server is asked to drop every file that state no
   longer refers to (POST /api/media/sweep) — asked before the push landed, it would still see the
   old state and keep everything, which is the safe side. Then this device keeps only the files a
   stash refers to: another account's changes kept here are not this reset's to delete. */
async function clearMediaAfterReset(signedIn) {
  const st = useStore.getState()
  if (signedIn && typeof st.pushState === 'function') {
    await st.pushState()
    const now = useStore.getState()
    if (now.sync?.status === 'ok' && now.config?.media) await api('/api/media/sweep', { method: 'POST', body: '{}' }).catch(() => {})
  }
  const keep = typeof st.stashedMediaHashes === 'function' ? await st.stashedMediaHashes() : new Set()
  await mediaStore.retainOnly(keep)
}

/* Settings → Data → "Photos & videos": how much of the server's space they take and what is still
   waiting to go up; a tap sends what is waiting now, offers again what the server refused, and
   lets a device that showed a file as missing ask for it again. On a device without a server that
   stores media, it says they are kept here only. */
function MediaRow() {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const status = useSyncExternalStore(subscribeMediaStatus, getMediaStatus)
  // Signed in, the files go to the server unless it has said it stores none. A config not known
  // yet — a phone started without a network; it is not kept between starts — is not that answer:
  // what is waiting is counted as waiting (and goes up once the server answers), not called
  // local-only as a guest's files are.
  const remote = !!user && (config == null || !!config.media)
  useEffect(() => { if (remote) syncMedia() }, [remote])
  const pending = remote ? pendingRefCount(S) : 0
  const u = status.usage
  const usage = remote && u && u.quotaBytes > 0
    ? t('{0} of {1} MB used on your server', fmtMB((u.bytes || 0) / MB), fmtMB(Math.round(u.quotaBytes / MB)))
    : null
  const sub = remote
    ? [usage, pending ? t('{0} waiting to upload', pending) : null].filter(Boolean).join(' · ') || undefined
    : t('Kept on this device only. Export with photos & videos keeps a copy.')
  return <Row icon="image" iconTint="var(--teal)" title={t('Photos & videos')} subtitle={sub}
    onClick={remote ? () => syncMedia({ force: true, retryRejected: true }) : undefined} />
}

function AccountIdRow({ id }) {
  const toast = useUI(s => s.toast)
  if (!id) return null
  const copy = async () => { if (await copyText(id)) toast(t('Account ID copied')) }
  return <Row icon="personCircle" iconTint="var(--grey)" title={t('Account ID')} subtitle={<span className="acct-id">{id}</span>} onClick={copy} />
}

// Lets the mobile app's "connect to my server" mode (lib/remote.js) authenticate without a
// WebAuthn ceremony of its own — the code is minted here, from an already signed-in session,
// and redeemed by the app for a bearer token. See /api/pair/create in api/server.js.
function PairSheet({ close }) {
  const [code, setCode] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => { api('/api/pair/create', { method: 'POST', body: '{}' }).then(r => setCode(r.code)).catch(e => setErr(e.message || t('Could not generate a code'))) }, [])
  return <>
    <h3>{t('Pair the mobile app')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('On the openGym app, choose “Connect to my server”, then enter this address and the code below. It expires in 5 minutes.')}
    </div>
    {err ? <div className="dim small">{err}</div> : (
      <div className="card" style={{ textAlign: 'center', fontSize: 30, fontWeight: 700, letterSpacing: '.16em', padding: '18px 0' }}>
        {code || '········'}
      </div>
    )}
    <div style={{ height: 12 }} />
    <Button onClick={close}>{t('Done')}</Button>
  </>
}

// The same registration as the sign-in screen's, reached from Settings instead. It asks for
// the invite code on the same terms: an invite-only instance rejects a registration without
// one, so a form that cannot collect it is a form that cannot succeed.
function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const [code, setCode] = useState('')
  const [inviteOnly, setInviteOnly] = useState(false)
  useEffect(() => { api('/api/config').then(c => setInviteOnly(!!c.invite_only)).catch(() => {}) }, [])
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim()); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created, and your data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(passkeyError(e, t('Registration failed'))) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

// Android app: writing finished workouts and weigh-ins to Health Connect (#200), the phone's
// own store for health data, where other apps can read them. A fact about this phone, kept in
// its own file (lib/health-sync.js) and not in S, so it never switches on anywhere else. The card
// stays out of the way on a phone without Health Connect, and only points to installing it on
// Android 13 and lower, where it is an app of its own.
function HealthConnectCard({ S, toast }) {
  const [st, setSt] = useState(null)
  const [h, setH] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let gone = false
    Promise.all([healthStatus(), loadHealth()]).then(([s, f]) => { if (!gone) { setSt(s); setH(f) } }).catch(() => {})
    const off = onHealthChange(f => { if (!gone) setH(f) })
    return () => { gone = true; off() }
  }, [])
  if (!st || !h || st.status === 'unsupported') return null

  if (st.status !== 'available') return (
    <Section title={t('Health Connect')}>
      <Row icon="heart" iconTint="var(--red)" title={t('Health Connect')}
        subtitle={st.status === 'update'
          ? t('Update Health Connect to share workouts and weigh-ins with other apps.')
          : t('Install Health Connect to share workouts and weigh-ins with other apps.')}
        accessory="chevron" onClick={() => openHealthConnect().catch(() => {})} />
    </Section>
  )

  const turnOn = async () => {
    setBusy(true)
    try {
      const r = await enableHealth(S)
      if (r.health) setH(r.health)
      else setH(await loadHealth())
      if (r.ok) toast(t('Writing to Health Connect'))
      else toast(r.reason === 'denied' ? t('Health Connect permission not granted') : t('Could not write to Health Connect'))
    } catch { toast(t('Could not write to Health Connect')) }
    setBusy(false)
  }
  const turnOff = removeWritten => async () => {
    setBusy(true)
    try { setH(await disableHealth({ removeWritten })) }
    catch { toast(t('Could not remove it from Health Connect')) }
    setBusy(false)
  }
  // Off can mean two things for what is already there, so it asks; closing the sheet keeps it on.
  const askOff = () => menuSheet({
    title: t('Stop writing to Health Connect?'),
    subtitle: t('What openGym already wrote can stay in Health Connect as your data, or be removed from it.'),
    items: [
      { icon: 'check', label: t('Stop, keep what it wrote'), onClick: turnOff(false) },
      { icon: 'trash', label: t('Stop and remove what it wrote'), danger: true, onClick: turnOff(true) },
    ],
  })

  return (
    <Section title={t('Health Connect')}
      footer={h.on ? t('Workouts and weigh-ins go to Health Connect when you finish or change them. openGym reads nothing back.') : null}>
      <Row icon="heart" iconTint="var(--red)" title={t('Write to Health Connect')}
        subtitle={t('Finished workouts and weigh-ins, from this phone only.')}>
        <Switch checked={!!h.on} disabled={busy} onChange={v => (v ? turnOn() : askOff())} />
      </Row>
      {h.on && h.error === 'permission' && <Row icon="warning" iconTint="var(--orange)"
        title={t('Permission withdrawn. Tap to allow again')} accessory="chevron" onClick={turnOn} />}
      {h.on && <Row icon="list" iconTint="var(--blue)" title={t('Open Health Connect')}
        accessory="chevron" onClick={() => openHealthConnect().catch(() => {})} />}
    </Section>
  )
}
