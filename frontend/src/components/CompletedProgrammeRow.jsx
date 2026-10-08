import { useState, useEffect, useRef } from 'react'
import { completedProgrammeSummary } from '../lib/programme-summary.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

export default function CompletedProgrammeRow({ cycle, state, onRepeat, selected = false }) {
  const [open, setOpen] = useState(selected)
  const rowRef = useRef(null)
  useEffect(() => { if (selected) { setOpen(true); rowRef.current?.scrollIntoView?.({ block: 'start' }) } }, [selected])
  const summary = completedProgrammeSummary(state, cycle)
  const format = value => value == null ? '—' : fmtNum(value)
  return <div ref={rowRef} className="item" data-testid="completed-programme-row" style={{ display:'block' }}>
    <button type="button" className="programme-ready-open" style={{ width:'100%' }} aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span className="grow" style={{ minWidth:0 }}><span className="tt">{cycle.name} <span className="tag">{t('Completed')}</span></span>
        <span className="ss">{t('{0} weeks',cycle.lengthWeeks)} · {summary.planned ? t('{0} of {1} sessions completed', summary.sessions, summary.planned) : t('{0} sessions',summary.sessions)}{cycle.completedAt ? ' · '+fmtDate(String(cycle.completedAt).slice(0,10),true) : ''}</span></span>
      <Icon name={open ? 'chevronDown' : 'chevronRight'} />
    </button>
    {Array.isArray(cycle.prSummary) && cycle.prSummary.length > 0 && <div className="small dim" style={{marginTop:6}}>{t('PRs')}: {cycle.prSummary.slice(0,3).map(pr=>`${pr.name} ${fmtNum(pr.value)} ${pr.unit}`).join(' · ')}</div>}
    <div className="row between" style={{ marginTop:8 }}><span className="small dim">{t('Repeat from here')}</span><Button size="sm" variant="tinted" icon="reset" aria-label={t('Repeat {0}',cycle.name)} onClick={()=>onRepeat(cycle)}>{t('Repeat')}</Button></div>
    {open && <div data-testid="programme-progress-summary" style={{ marginTop:12 }}>
      {summary.progress.length ? <div role="region" aria-label={t('Programme progress')} tabIndex="0" style={{ overflowX:'auto' }}><table style={{ width:'100%',fontSize:12,textAlign:'left' }}>
        <thead><tr>{['Exercise','Weight','1RM','Volume'].map(label=><th key={label} style={{padding:6}}>{t(label)}</th>)}</tr></thead>
        <tbody>{summary.progress.map(row=><tr key={row.key}><td style={{padding:6}}>{row.name}</td>{['weight','rm1','volume'].map(metric=><td key={metric} style={{padding:6,whiteSpace:'nowrap'}}>{format(row[metric].first)} → {format(row[metric].last)} {row.unit}</td>)}</tr>)}</tbody>
      </table></div> : <div className="small dim">{t(summary.sessions ? 'No compatible weight data in completed sessions' : 'No completed sessions in this programme')}</div>}
      <div className="small dim" style={{marginTop:6}}>{t('First → last recorded week: working weight, estimated 1RM and volume. Only compatible completed work sets are included.')}</div>
    </div>}
  </div>
}
