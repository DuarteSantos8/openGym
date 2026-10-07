import { useEffect, useRef, useState, forwardRef, useSyncExternalStore } from 'react'
import AppleHealthSettings from '../components/AppleHealthSettings.jsx'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF, hasData } from '../store/useStore.js'
import { workoutControls } from '../lib/workout-controls.js'
import { speedUnitOf } from '../lib/speed.js'
import { copyText } from '../lib/clipboard.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, ACCENT_NAMES, todayISO, localTZ, weekStartOf, MONDAY, SUNDAY, fmtPlate } from '../lib/format.js'
import { inventoryFor, ownsPlates } from '../lib/plates.js'
import { effortOf } from '../lib/history.js'
import { unlock, playOnSilentSupported, vibrateSupported } from '../lib/sound.js'
import { api, webauthnOK, passkeyRegister, IS_ANDROID } from '../lib/api.js'
import { pushSupported, enablePush, disablePush, sendTestPush, syncPushSubscription } from '../lib/push.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, baseLang } from '../lib/i18n.js'
import { effectiveLang } from '../lib/default-lang.js'
import { DEMO, REPO } from '../lib/demo.js'
import { MOBILE, isAndroid, shareExport, shareExportBlob, syncReminder } from '../lib/mobile.js'
import { referencedFiles } from '../lib/media-refs.js'
import { mediaStore } from '../lib/media-store.js'
import { syncMedia, fetchToStore } from '../lib/media-sync.js'
import { getMediaStatus, subscribeMediaStatus, pendingRefCount } from '../lib/media-owed.js'
import { limitsFrom, fmtMB, MB } from '../lib/media-limits.js'
import { setRestAccent } from '../lib/rest-alert.js'
import { checkForUpdate, downloadAndInstall } from '../lib/update.js'
import { forgetCoach } from '../lib/coach-api.js'
import { starterPlanSheet, confirmSheet, importFromApp, importFromHevy, equipmentProfileSheet, plateInventorySheet, menuSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { ServerSyncSection, KeptChangesRows, leaveServer, connectServer, passkeySignIn } from '../components/ServerSync.jsx'
import { passwordOn, PasswordRow, openPasswordSignIn, openPasswordRegister } from '../components/PasswordAuth.jsx'
import { usePasskeys, PasskeysRow, DeviceLinkRow } from '../components/Passkeys.jsx'
import { Section, Row, SelectRow, Switch, Segmented, Button, TextField } from '../components/ui.jsx'

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const coachLocal = useStore(s => s.coachLocal)
  // Name-and-password sign-in, where the instance offers it (#118).
  const config = useStore(s => s.config)
  const pwOn = passwordOn(config)
  // What the app is showing, which for a profile that never picked a language is worked out on
  // this device rather than stored (#303).
  const lang = effectiveLang(S, config)
  // This profile's passkeys and the code for another device (#95). A change to them is read back
  // here and by the password row, whose "Remove" depends on there being a passkey.
  const passkeys = usePasskeys(!!user && !MOBILE && !DEMO)
  const [credsV, setCredsV] = useState(0)
  const credsChanged = () => { passkeys.load(); setCredsV(v => v + 1) }
  const { update, importConflict, importBackup, setUnit, resetEverything: resetAll, setUser, pullState, pushState, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const wakeOK = wakeLockSupported()

  // Two honest choices on a unit switch (issue #22): convert the numbers, or keep them and only
  // change the label — the old behaviour, still right for someone who logged in lb all along
  // under a kg label. Closing the sheet leaves the unit as it was.
  const switchUnit = v => {
    if (v === S.unit) return
    menuSheet({
      title: t('Convert to {0}?', v),
      subtitle: t('Every stored weight — logged sets, working weights, routine targets, body weight, bar weights — is in {0}. Convert the numbers, or keep them and only change the label?', S.unit),
      items: [
        { icon: 'shuffle', label: t('Convert the numbers'), onClick: () => setUnit(v) },
        { icon: 'pencil', label: t('Keep the numbers, change the label'), onClick: () => setUnit(v, { convert: false }) },
      ],
    })
  }

  // --- update check state ---
  const [updateInfo, setUpdateInfo] = useState(null) // { hasUpdate, latestVersion, apkUrl, hashUrl } | null
  const [android, setAndroid] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    // The in-app updater installs an .apk, so it only applies to the native Android build.
    // On iOS and the web this check is skipped and the update row never appears. isAndroid()
    // already answers false off the mobile build; the MOBILE check on top keeps the web bundle
    // from even asking (and from calling gitlab.com on every Settings visit).
    if (!MOBILE) return
    isAndroid().then(ok => { setAndroid(ok); if (ok) checkForUpdate().then(setUpdateInfo).catch(() => {}) })
  }, [])

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
      toast(t('Could not check for updates — are you online?'))
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
            if (!/^[0-9a-f]{64}$/i.test(expectedHash || '')) throw new Error(t('Checksum not available — not installing'))
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
    if (out.missing) toast(t(out.missing === 1 ? '{0} file could not be included' : '{0} files could not be included', out.missing))
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
    } catch (e) { toast(t('Import failed: {0}', e.message)); return }
    const apply = async mergeWith => {
      if (read.files.length) {
        const { storeBackupMedia } = await import('../lib/backup-media.js')
        await storeBackupMedia(read.files, { limits: limitsFrom(useStore.getState().config) })
      }
      importBackup(read.state, { mergeWith })
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
          { icon: 'shuffle', label: t('Merge them in'), onClick: () => apply(conflict) },
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
  const leave = (kind, after) => leaveServer(kind, { exportBackup: doExport, exportBackupZip: doExportZip, done: r => { nav('/home'); if (r.stashed) toast(kept); else if (after) toast(after) } })
  const disconnect = () => confirmSheet({
    title: t('Disconnect from your server?'),
    message: t('This phone switches back to local-only and its copy of your account is removed. First it checks that your server has every change — if not, you choose what happens to them.'),
    confirmText: t('Disconnect'), danger: true,
    onConfirm: () => leave('disconnect', t('Disconnected — back to local-only')),
  })
  const signOutHere = () => confirmSheet({
    title: t('Sign out?'),
    message: t('Your data is removed from this browser; your profile on the server keeps it. First it checks that the server has every change — if not, you choose what happens to them.'),
    confirmText: t('Sign out'), danger: true,
    onConfirm: () => leave('signout'),
  })
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Phones paired with it are disconnected and have to be paired again. Your passkeys keep working — sign in with them again anytime.'),
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

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 10 }}><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- the server: which one, which account, how that stands, "Sync now" ----------
        A paired phone's Admin and Disconnect sit in the same block; a browser's account rows
        follow in their own. */}
    {user && !DEMO && <ServerSyncSection>
      {MOBILE && <>
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <AccountIdRow id={user.id} />
        <Row icon="signOut" iconTint="var(--red)" title={t('Disconnect')} danger onClick={disconnect} />
      </>}
    </ServerSyncSection>}

    {/* ---------- account (demo and mobile builds have nothing to sign in to) ---------- */}
    {!(MOBILE && user) && <Section title={MOBILE ? t('Your data') : DEMO ? t('Demo') : t('Account')}>
      {MOBILE ? <>
        <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
        <Row icon="link" iconTint="var(--indigo)" title={t('Connect to my server')} subtitle={t('Sync this device to your own self-hosted openGym instead.')} accessory="chevron"
          onClick={connectServer} />
        <KeptChangesRows />
      </> : DEMO ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
        <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
          onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        <Row icon="rocket" iconTint="var(--indigo)" title={t('Self-host openGym')} subtitle={t('Passkey sign-in, sync across your devices, your own data.')} accessory="chevron"
          onClick={() => window.open(REPO, '_blank', 'noopener')} />
      </> : user ? <>
        {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
        <PasskeysRow state={passkeys.st} changed={credsChanged} />
        <DeviceLinkRow state={passkeys.st} />
        <Row icon="link" iconTint="var(--blue)" title={t('Pair the mobile app')} subtitle={t('Connect the openGym app on your phone to this account.')} accessory="chevron"
          onClick={() => useUI.getState().openSheet(close => <PairSheet close={close} />)} />
        {pwOn && <PasswordRow version={credsV} />}
        <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={signOutHere} />
        <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
        <AccountIdRow id={user.id} />
      </> : webauthnOK() ? <>
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
        <Row icon="person" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={passkeySignIn} />
        {pwOn && <Row icon="key" iconTint="var(--orange)" title={t('Sign in with password')} accessory="chevron" onClick={() => openPasswordSignIn()} />}
        <KeptChangesRows />
      </> : pwOn ? <>
        {/* No passkeys in this browser (plain http on a LAN address, say): a password is the way in. */}
        <Row icon="sparkles" iconTint="var(--acc)" title={t('Create new profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={openPasswordRegister} />
        <Row icon="key" iconTint="var(--orange)" title={t('Sign in with password')} accessory="chevron" onClick={() => openPasswordSignIn()} />
        <KeptChangesRows />
      </> : <>
        <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
        <KeptChangesRows />
      </>}
    </Section>}
    {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

    {/* ---------- the Coach on a phone: through the paired server, or with the user's own key ---------- */}
    {MOBILE && <Section title={t('AI Coach')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('AI Coach')} accessory="chevron"
        subtitle={coachLocal?.mode === 'server' ? t('Runs on your openGym server') : coachLocal?.mode === 'byok' ? t('Runs on this phone with your own API key') : t('Off — choose how the Coach should run.')}
        onClick={() => nav('/coach/setup')} />
    </Section>}

    {/* ---------- general ---------- */}
    <Section title={t('General')} footer={t('Switching the unit offers to convert every stored weight.')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={lang} onChange={v => update(s => { s.lang = v; s.langAuto = false })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      {EXERCISE_NAME_LANGS.includes(baseLang(lang)) && <>
        <Row icon="dumbbell" iconTint="var(--purple)" title={t('English exercise names')}
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
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => switchUnit(v)} />
      </Row>
      {/* Cardio speed (Discord "miles per hour"). Unlike the weight unit this converts nothing:
          speeds stay stored in km/h and only what is shown and typed follows it (lib/speed.js).
          Until chosen it follows the weight unit, so a profile in pounds already reads mph. */}
      <Row icon="figureRun" iconTint="var(--teal)" title={t('Speed unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]}
          value={speedUnitOf(S)} onChange={v => update(s => { s.speedUnit = v })} />
      </Row>
      {/* Display only: one decimal reads fine for plate-loadable numbers, two for anyone whose
          per-side figure lands on .25 or .75, or who loads microplates (issue #139). Nothing is
          stored or rounded differently — lib/format.js fmtNum just prints what is already there. */}
      <Row icon="plate" iconTint="var(--teal)" title={t('Weight decimals')} subtitle={t('How precisely weights are shown.')}>
        <Segmented className="seg-inline"
          options={[{ value: 1, label: t('0.5') }, { value: 2, label: t('0.25') }]}
          value={S.wdec === 2 ? 2 : 1} onChange={v => update(s => { s.wdec = v })} />
      </Row>
      {/* Monday or Sunday — the Plan list, the Home strip, the calendar grid and every
          "this week" total follow it. Stored as a getDay() index (see lib/format.js). */}
      <Row icon="calendar" iconTint="var(--orange)" title={t('Week starts on')}>
        <Segmented className="seg-inline"
          options={[{ value: MONDAY, label: t('Monday') }, { value: SUNDAY, label: t('Sunday') }]}
          value={weekStartOf(S)} onChange={v => update(s => { s.weekStart = v })} />
      </Row>
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
    </Section>

    {/* ---------- during a workout ---------- */}
    <Section title={t('During a workout')} footer={wakeOK ? t('The screen stays on while a workout is running, so you don’t have to unlock your phone between sets.') : null}>
      {/* The quick weigh-in that opens on Start (sheets.jsx startFlow, issue #137); off skips straight
          to the session. Home and Stats still log weight by hand. */}
      <Row icon="scale" iconTint="var(--green)" title={t('Weigh in before workouts')}
        subtitle={t('Asks for your body weight when a workout starts. Off starts the session straight away.')}>
        <Switch checked={S.weighIn !== false} onChange={v => update(s => { s.weighIn = v })} />
      </Row>
      {/* One exercise at a time (cards with Prev/Next), the whole session stacked as a
          scrollable list, or that list stripped to just names and set rows (compact).
          Legacy/unknown values read as cards. The running session can override this from
          the workout header's ⋮ menu without changing this default. */}
      <Row icon="list" iconTint="var(--blue)" title={t('Workout view')}>
        <Segmented className="seg-inline"
          options={[{ value: 'cards', label: t('Cards') }, { value: 'list', label: t('List') }, { value: 'compact', label: t('Compact') }]}
          value={['list', 'compact'].includes(S.workoutView) ? S.workoutView : 'cards'}
          onChange={v => update(s => { s.workoutView = v })} />
      </Row>
      {/* Whose reps a planned session opens with (lib/session-start.js). The plan's by default:
          the routine is what you said you would do, and history and progression decide the
          weight. The other choice is the old behaviour, reps carried over from last time.
          Absent (an older profile) reads as the plan. */}
      <SelectRow icon="clipboard" iconTint="var(--acc)" title={t('Planned sessions start from')}
        value={S.startFrom === 'last' ? 'last' : 'plan'} onChange={v => update(s => { s.startFrom = v })}
        options={[
          { value: 'plan', label: t('Your plan'), subtitle: t('The routine’s sets and reps. Your history decides the weight.') },
          { value: 'last', label: t('Your last session'), subtitle: t('The reps you logged last time in that routine, carried over.') },
        ]} />
      {/* The line under each exercise that the rows are held against (#173). Tapping the line in
          a workout switches it too; this is where the choice can be found without knowing that. */}
      <SelectRow icon="history" iconTint="var(--blue)" title={t('Shown under each exercise')}
        value={S.logRef === 'best' ? 'best' : 'last'} onChange={v => update(s => { s.logRef = v })}
        options={[
          { value: 'last', label: t('Last time'), subtitle: t('What you did the last time, in that routine.') },
          { value: 'best', label: t('Best set'), subtitle: t('Your heaviest set of the exercise, from any workout.') },
        ]} />
      {/* The lean workout screen keeps the sets and one "more" button per exercise; each switch
          brings one of the old always-visible button groups back for people who liked them. */}
      <Row icon="wrench" iconTint="var(--purple)" title={t('Workout controls')} accessory="chevron"
        subtitle={t('Everything hidden here stays one tap away: the ⋯ button of an exercise and the number of a set.')}
        onClick={() => workoutControlsSheet()} />
      <SelectRow icon="timer" iconTint="var(--orange)" title={t('Rest timer')}
        value={S.restSec} onChange={v => update(s => { s.restSec = v })}
        options={[{ value: 0, label: t('Off') }, ...[60, 90, 120, 150, 180].map(v => ({ value: v, label: v + 's' }))]} />
      {/* Default for a rest-pause burst added live on a plain set — a planned exercise's own
          "Rest (s)" (in its Intensifier config) overrides this, same as the main rest timer
          is the fallback whenever an exercise has no progression rule of its own. */}
      <SelectRow icon="bolt" iconTint="var(--acc)" title={t('Rest-pause rest')}
        value={S.restPauseSec} onChange={v => update(s => { s.restPauseSec = v })}
        options={[10, 15, 20, 30].map(v => ({ value: v, label: v + 's' }))} />
      {(wakeOK || !MOBILE) && (
        <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
          subtitle={wakeOK ? null : t('Not supported in this browser.')}>
          <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
            onChange={v => update(s => { s.keepAwake = v })} />
        </Row>
      )}
      {/* 'full'/'mini' is also what the tap-toggle on the workout animation writes; 'off' hides
          workout media entirely (library, detail sheet and picker thumbs are unaffected).
          Legacy/unknown values read as 'full'. */}
      <Row icon="figureRun" iconTint="var(--green)" title={t('Exercise animations')}>
        <Segmented className="seg-inline"
          options={[{ value: 'full', label: t('Full') }, { value: 'mini', label: t('Small') }, { value: 'off', label: t('Hidden') }]}
          value={S.gifSize === 'mini' || S.gifSize === 'off' ? S.gifSize : 'full'}
          onChange={v => update(s => { s.gifSize = v })} />
      </Row>
      <Row icon="bell" iconTint="var(--pink)" title={t('Sounds')}>
        {/* Turning Sounds on is a tap: unlock the audio context now so a timer that ends before
            the next set check can already sound (iOS, #152). */}
        <Switch checked={!!S.sound} onChange={v => { if (v) unlock(true); update(s => { s.sound = v }) }} />
      </Row>
      {/* iOS only (WebKit's audio-session API, iOS 17+): with it off the ring/silent switch mutes
          the timer. On, the phone treats the timer like a music player — exclusive, and the
          music app is not told it may resume — so it is a choice, off by default (lib/sound.js). */}
      {S.sound && playOnSilentSupported() && (
        <Row icon="bell" iconTint="var(--orange)" title={t('Play sounds when the phone is on silent')}
          subtitle={t('Music playing on this phone stops during a workout and does not resume by itself.')}>
          <Switch checked={!!S.soundOnSilent} onChange={v => update(s => { s.soundOnSilent = v })} />
        </Row>
      )}
      {/* The buzz at the end of a rest or a hold and on a set tick, on its own switch like the
          sound (Discord, asierlama). Not offered where there is nothing to buzz: iOS has no
          navigator.vibrate. */}
      {vibrateSupported() && (
        <Row icon="bell" iconTint="var(--indigo)" title={t('Vibrate')}>
          <Switch checked={S.vibrate !== false} onChange={v => update(s => { s.vibrate = v })} />
        </Row>
      )}
      <Row icon="sun" iconTint="var(--yellow)" title={t('Flash screen when timer ends')}>
        <Switch checked={!!S.timerFlash} onChange={v => update(s => { s.timerFlash = v })} />
      </Row>
      <Row icon="timer" title={t('Keep timing after target')}
        subtitle={t('Timed sets continue up to 15 extra minutes. Tap Done to log the actual duration.')}>
        <Switch aria-label={t('Keep timing after target')} checked={!!S.timedSetOvertime}
          onChange={v => update(s => { s.timedSetOvertime = v })} />
      </Row>
      {/* Two names for the same judgement, so the column asks in the scale you already think in.
          The (i) sits before the control — you read it on the way to the choice, not after it. */}
      <Row icon="target" iconTint="var(--purple)" title={t('Effort per set')}>
        <button className="helpbtn" aria-label={t('What are RIR and RPE?')} onClick={effortHelpSheet}><Icon name="info" /></button>
        <Segmented className="seg-inline"
          options={[{ value: 'none', label: t('Off') }, { value: 'rir', label: t('RIR') }, { value: 'rpe', label: t('RPE') }]}
          value={effortOf(S)} onChange={v => update(s => { s.effort = v; delete s.showRir })} />
      </Row>
    </Section>

    {(user || MOBILE) && <NotificationsCard S={S} update={update} toast={toast} />}

    {/* ---------- equipment ---------- */}
    <EquipmentCard S={S} update={update} />

    {/* ---------- appearance ---------- */}
    <Section title={t('Appearance')} footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
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
      {/* Purely how the muscle map is drawn — nothing else in the app reads this. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12, paddingTop: 13, paddingBottom: 14 }}>
        <span className="lrow-t">{t('Accent color')}</span>
        <div className="swatches">
          {Object.entries(ACCENTS).map(([k, c]) => (
            <button key={k} className={'swatch' + ((S.accent || 'lime') === k ? ' on' : '')}
              style={{ background: c }} onClick={() => { update(s => { s.accent = k }); setRestAccent(k) }} aria-label={t(ACCENT_NAMES[k] || k)} />
          ))}
        </div>
      </div>
    </Section>

    {/* ---------- data: fill it, bring things over, back it up, wipe it ---------- */}
    <Section title={t('Data')}>
      <AppleHealthSettings />
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Load starter plan')} accessory="chevron" onClick={starterPlanSheet} />
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy — or body weight from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      <Row icon="key" iconTint="var(--teal)" title={t('Import from Hevy')}
        subtitle={t('Pull your history with a Hevy Pro API key')}
        accessory="chevron" onClick={importFromHevy} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} subtitle={hasMedia ? t('Without photos and videos') : undefined} accessory="chevron" onClick={doExport} />
      {hasMedia && <Row icon="download" iconTint="var(--blue)" title={t('Export with photos & videos (.zip)')} accessory="chevron" onClick={doExportZip} />}
      {hasMedia && <MediaRow />}
      {/* 14 is AUTO_BACKUP_KEEP in lib/mobile.js, written out because the Settings tests mock
          that module wholesale; mobile.autobackup.test.js pins the two together. */}
      {MOBILE && <Row icon="history" iconTint="var(--blue)" title={t('Auto-backup on changes')}
        subtitle={t('Saves a dated copy to Documents/openGym after finishing a workout or editing a routine, and keeps the newest {0} — point a sync app at that folder, or copy it out by hand.', 14)}>
        <Switch checked={!!S.autoBackup} onChange={v => update(s => { s.autoBackup = v })} />
      </Row>}
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={resetEverything} />
    </Section>
    <input ref={fileRef} type="file" accept=".json,.zip,application/json,application/zip" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    {/* "Add to Home screen" makes no sense inside the native app */}
    {!MOBILE && <Section title={t('Tip')}>
      <Row icon="lightbulb" iconTint="var(--yellow)"
        title={IS_ANDROID ? t('In Chrome: ⋮ menu → Add to Home screen') : t('In Safari: Share → Add to Home Screen')}
        subtitle={t('to install openGym as a full-screen app.') + ' ' + (user ? t('Your data syncs with your profile — sign in anywhere to see it.') : t('Guest data stays on this device — export a backup now and then!'))} />
    </Section>}

    {/* ---------- updates: the last thing on the page, so keeping openGym current is one tap ----------
        On Android the row is always there — it checks on demand and installs when a release is
        newer (checksum verified, see onUpdateRowClick). On the web the app updates with its
        server, so the row points at the APK for the phone instead. iOS has no APK: nothing. */}
    {(!MOBILE || android) && <Section title={t('Updates')}
      footer={MOBILE ? t('Releases are checked on gitlab.com. The download is verified against its checksum before the installer opens.') : t('The web app updates together with your server. The Android app installs its own updates from here.')}>
      {MOBILE
        ? <Row icon="download" iconTint="var(--acc)"
            title={updateInfo?.hasUpdate ? t('Update to openGym v{0}', updateInfo.latestVersion) : t('Check for updates')}
            subtitle={checking ? t('Checking…') : t('You have v{0}', __APP_VERSION__)}
            accessory="chevron"
            onClick={() => (updateInfo?.hasUpdate ? onUpdateRowClick() : checkNow())} />
        : <Row icon="download" iconTint="var(--acc)" title={t('Get the Android app')}
            subtitle={t('Download the APK from opengym.duarte-santos.ch')} accessory="chevron"
            onClick={() => window.open('https://opengym.duarte-santos.ch/#download', '_blank', 'noopener')} />}
    </Section>}

    {/* The version, at the bottom of Settings — which is where the support template has been
        telling people to look for it, and where it was not. On the phone build there is no
        address bar and no about box, so without this there is no way to tell which build you
        are running, or whether an update actually installed. */}
    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      openGym v{__APP_VERSION__} · {t('free & open source (AGPL v3)')}<br />
      <a href="https://github.com/DuarteSantos8/openGym" target="_blank" rel="noopener">source code</a> · exercise data: hasaneyldrm/exercises-dataset (MIT)<br />
      exercise images and animations © <a href="https://gymvisual.com/" target="_blank" rel="noopener">Gym visual</a>
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

// Settings → During a workout → Workout controls. S.wc overlays DEF.wc, so a profile from
// before this setting existed reads as the lean default.
function WorkoutControlsSheet() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const wc = workoutControls(S)
  const set = (k, v) => update(s => { s.wc = { ...workoutControls(s), [k]: v } })
  return <>
    <h3>{t('Workout controls')}</h3>
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Everything hidden here stays one tap away: the ⋯ button of an exercise and the number of a set.')}</div>
    <Section>
      <Row icon="plus" iconTint="var(--acc)" title={t('Weight and reps buttons')} subtitle={t('Off: tap the number and type it')}>
        <Switch checked={wc.steppers} onChange={v => set('steppers', v)} />
      </Row>
      <Row icon="bolt" iconTint="var(--orange)" title={t('Drop and burst shortcuts on every set')}>
        <Switch checked={wc.setShortcuts} onChange={v => set('setShortcuts', v)} />
      </Row>
      <Row icon="link" iconTint="var(--blue)" title={t('Superset buttons in the exercise header')}>
        <Switch checked={wc.pairButtons} onChange={v => set('pairButtons', v)} />
      </Row>
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Move, swap and remove buttons below the exercise')}>
        <Switch checked={wc.exerciseButtons} onChange={v => set('exerciseButtons', v)} />
      </Row>
    </Section>
  </>
}
function workoutControlsSheet() {
  useUI.getState().openSheet(() => <WorkoutControlsSheet />)
}

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
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
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
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
    </Section>
  )
}

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
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
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
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
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
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}

// Equipment profiles ("Home", "Gym", ...) — each an id/name/eq-list; the active one filters
// the Library, exercise picker, and flags routine entries that need something outside it
// (see lib/equipment.js). Purely local/synced state — no server changes needed.
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
    : t('Standard set — tap to count the pairs you own.')
  return <Section title={t('Equipment')} footer={t('Filters the exercise library and picker, and flags routine exercises that need something you don’t have in the active profile.')}>
    <Row icon="plate" iconTint="var(--orange)" title={t('Plates')} subtitle={plateSummary} accessory="chevron" onClick={() => plateInventorySheet()} />
    {profiles.length > 0 && <Row icon="dumbbell" iconTint="var(--acc)" title={t('Filter by equipment')}>
      <Switch checked={!!S.equipFilterOn} onChange={v => update(s => { s.equipFilterOn = v })} />
    </Row>}
    {profiles.length > 0 && <SelectRow icon="list" iconTint="var(--blue)" title={t('Active profile')}
      value={S.activeEquipId || ''} onChange={v => update(s => { s.activeEquipId = v })}
      options={profiles.map(p => ({ value: p.id, label: p.name }))} />}
    {profiles.map(p => (
      <Row key={p.id} icon="dumbbell" iconTint="var(--teal)" title={p.name}
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
    : t('Kept on this device only — Export with photos & videos keeps a copy.')
  return <Row icon="image" iconTint="var(--teal)" title={t('Photos & videos')} subtitle={sub}
    onClick={remote ? () => syncMedia({ force: true, retryRejected: true }) : undefined} />
}

function AccountIdRow({ id }) {
  const toast = useUI(s => s.toast)
  if (!id) return null
  const copy = async () => { if (await copyText(id)) toast(t('Account ID copied')) }
  return <Row icon="person" iconTint="var(--grey)" title={t('Account ID')} subtitle={<span className="acct-id">{id}</span>} onClick={copy} />
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
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}
