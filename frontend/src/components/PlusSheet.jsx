import { useId, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { workoutRunning } from '../lib/tab-route.js'
import { closeThenNav } from '../lib/nav.js'
import { useDialogFocus } from '../lib/use-dialog-focus.js'
import { bwSheet, customExSheet, exerciseDetailSheet, logPastWorkoutSheet, startOrResume } from '../sheets.jsx'
import { addRoutine } from '../views/Plan.jsx'
import { measurementLogSheet } from '../views/Measurements.jsx'
import { Row, Section } from './ui.jsx'
import Elapsed from './Elapsed.jsx'

const under = (pathname, base) => pathname === base || pathname.startsWith(base + '/')

// The rows for what is on screen ("Here", at most two), as [icon, tint, label, action(close)].
// Each row has its own tint, as the settings tiles do, so the sheet does not read as one block —
// from the tints a white glyph clears 3:1 on in both themes (blue, indigo, purple, pink); teal,
// orange and the default lime accent do not.
function hereRows(pathname) {
  if (pathname === '/train/routines') return [['clipboard', 'var(--indigo)', t('New routine'), close => { close(); addRoutine() }]]
  if (pathname === '/train/history') return [['history', 'var(--indigo)', t('Log past workout'), close => { close(); logPastWorkoutSheet() }]]
  if (under(pathname, '/train/exercises')) return [['dumbbell', 'var(--blue)', t('New exercise'), close => { close(); customExSheet(null, ex => exerciseDetailSheet(ex)) }]]
  if (under(pathname, '/progress/body')) return [
    ['ruler', 'var(--purple)', t('Log measurements'), close => { close(); measurementLogSheet() }],
    ['camera', 'var(--pink)', t('Add photo'), close => closeThenNav(close, '/progress/body/photos')],
  ]
  return []
}

// The centre +: one sheet of things to log, the same on every tab. What fits the screen you are
// on comes first, then the rows that are always there in a fixed order. A modal dialog: named by
// its heading, focus inside it while it is open, the page behind it out of reach.
function PlusSheet({ close, pathname }) {
  const S = useStore(s => s.S)
  const ref = useRef(null)
  const titleId = useId()
  useDialogFocus(ref)
  const live = workoutRunning(S)
  const here = hereRows(pathname)
  return (
    <div className="plus-sheet" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h3 id={titleId}>{t('Add')}</h3>
      {here.length > 0 && <Section title={t('Here')}>
        {here.map(([icon, tint, label, act]) => <Row key={label} icon={icon} iconTint={tint} title={label} accessory="chevron" onClick={() => act(close)} />)}
      </Section>}
      <Section title={t('Anytime')}>
        <Row icon="scale" iconTint="var(--indigo)" title={t('Weigh in')} accessory="chevron" onClick={() => { close(); bwSheet() }} />
        <Row icon="play" iconTint="var(--purple)" title={S.active ? t('Resume workout') : t('Start workout')} accessory="chevron" onClick={() => { close(); startOrResume() }}>
          {live && <span className="lrow-v plus-sheet-live"><span className="live-dot" aria-hidden="true" /><Elapsed start={S.active.start} /></span>}
        </Row>
        {S.checkIn !== false && <Row icon="qr" iconTint="var(--blue)" title={t('Gym check-in')} accessory="chevron" onClick={() => closeThenNav(close, '/train/checkin')} />}
      </Section>
    </div>
  )
}

export function openPlusSheet(pathname) {
  useUI.getState().openSheet(close => <PlusSheet close={close} pathname={pathname} />)
}
