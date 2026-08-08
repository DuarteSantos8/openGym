import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount, todayISO, fmtDate, isoOf } from '../lib/format.js'
import { effectiveRoutines, effectiveRoutineIds } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, dayOverrideSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  // The next real date for a weekday - tapping a day opens the multi-plan picker for it.
  const nextDateOf = d => {
    const t = new Date(todayISO() + 'T12:00:00')
    const diff = (d - t.getDay() + 7) % 7
    t.setDate(t.getDate() + diff)
    return isoOf(t)
  }
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [date, setDate] = useState(todayISO())
  const overrides = Object.keys(S.dayPlan || {}).sort()

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          const iso = nextDateOf(d)
          const dayPlans = effectiveRoutineIds(S, iso)
          const overridden = Object.prototype.hasOwnProperty.call(S.dayPlan || {}, iso)
          const shown = overridden && dayPlans.length ? dayPlans : (r ? [r.id] : [])
          return <div key={d} className="item" onClick={() => dayOverrideSheet(iso)}>
            <div className="grow">
              <div className="row" style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div className="tt">{t(DAYN[d])}</div>
                {shown.length ? <div className="row" style={{ gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end', flex: '1 1 auto', minWidth: 0, maxHeight: 64, overflow: 'hidden' }}>
                  {shown.map((pid, i) => {
                    const pr = S.routines.find(x => x.id === pid)
                    return pr ? <span key={pid} className="tag acc" style={{ marginRight: 0 }}><Icon name={glyphOf(pr.emoji)} />{overridden && <b style={{ marginRight: 3 }}>{i + 1}.</b>}{pr.name}</span> : null
                  })}
                </div> : <span className="tag">{t('Rest')}</span>}
              </div>
            </div>
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
      <h4 className="sec" style={{ marginTop: 22 }}>{t('Date-specific plans')}</h4>
      <div className="small dim" style={{ margin: '-4px 2px 10px', lineHeight: 1.4 }}>{t('Add or remove multiple routines for one date without changing the weekly schedule.')}</div>
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} aria-label={t('Date')} style={{ minWidth: 0, flex: 1 }} />
        <Button size="sm" variant="tinted" icon="calendar" onClick={() => date && dayOverrideSheet(date)}>{t('Edit day')}</Button>
      </div>
      {overrides.length > 0 && <div className="list">{overrides.map(iso => {
        const plans = effectiveRoutines(S, iso)
        return <div key={iso} className="item" onClick={() => dayOverrideSheet(iso)}>
          <div className="grow"><div className="tt">{fmtDate(iso, true)}</div><div className="ss">{plans.length ? plans.map(r => r.name).join(' + ') : t('Rest')}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}</div>}
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
    </div></div>
  </>
}
