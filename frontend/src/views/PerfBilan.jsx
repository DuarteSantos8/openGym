// Plan → "Analyser mes dernières perfs": the performance review.
//
// Two halves, in this order. The analysis (lib/perf-analysis.js) is computed on the phone from the
// log, offline and instantly: each exercise on each machine, its estimated 1RM and how it moved,
// stalls and slips, records, sets per muscle group, balance and regularity. The AI review below it
// (lib/perf-report.js) sends Gemini only the summary of that analysis, on a tap, and keeps the last
// answer on the phone so it can be read again without asking.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { exerciseOf } from '../lib/exercises.js'
import { fmtDate, fmtNum, isoOf } from '../lib/format.js'
import { copyText } from '../lib/clipboard.js'
import { useUI } from '../store/useUI.js'
import { analyzePerf, GROUPS } from '../lib/perf-analysis.js'
import {
  AI_STUDIO_KEY_URL, askGemini, clearReport, copyableBilan, getGeminiKey, loadReport, saveReport, summaryToText,
} from '../lib/perf-report.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { openExternal } from '../components/CustomMedia.jsx'

const groupName = id => ({
  chest: t('Chest'), back: t('Back muscles'), shoulders: t('Shoulders'), biceps: t('Biceps & forearms'), triceps: t('Triceps'),
  quads: t('Quads'), hamstrings: t('Hamstrings'), glutes: t('Glutes'), calves: t('Calves'), core: t('Abs'),
}[id] || id)

const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtNum(Math.abs(n))
const TONE = { progress: 'var(--green)', stagnation: 'var(--orange)', regression: 'var(--red)' }

function Tag({ tone, children }) {
  return <span className="tag" style={{ color: tone, background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>{children}</span>
}

// One exercise on one machine: its name, the machine it was done on, and how its estimate moved.
function ExerciseRow({ e, unit }) {
  const what = e.metric === 'e1rm'
    ? t('Est. 1RM {0} → {1} {2}', fmtNum(e.first.value), fmtNum(e.last.value), unit)
    : t('Best reps {0} → {1}', fmtNum(e.first.value), fmtNum(e.last.value))
  const why = e.status === 'stagnation' ? t('{0} sessions without a new best', e.stalledFor)
    : e.status === 'regression' ? (e.dropped ? t('Lighter or fewer reps than before') : t('Below your best of the period'))
    : ''
  return <div className="item bilan-ex">
    <div className="grow">
      <div className="tt">{e.name}</div>
      <div className="ss">{[e.machine, what, why].filter(Boolean).join(' · ')}</div>
    </div>
    <Tag tone={TONE[e.status] || 'var(--label-2)'}>{signed(e.changePct)} %</Tag>
  </div>
}

function ExerciseList({ title, items, unit, empty }) {
  if (!items.length && !empty) return null
  return <>
    <h4 className="sec">{title}</h4>
    {items.length
      ? <div className="list">{items.map(e => <ExerciseRow key={e.id + '|' + (e.gym || '')} e={e} unit={unit} />)}</div>
      : <div className="card small muted">{empty}</div>}
  </>
}

// A bar per muscle group: sets a week, the widest one filling the track.
function Bars({ rows, max, suffix = '' }) {
  return <div className="bilan-bars">{rows.map(r => <div className="bilan-bar" key={r.key}>
    <span className="nm">{r.label}</span>
    <span className="track"><i style={{ width: Math.max(r.value > 0 ? 3 : 0, (r.value / (max || 1)) * 100) + '%' }} /></span>
    <span className="v">{fmtNum(r.value)}{suffix}</span>
  </div>)}</div>
}

// The AI's answer: "## Title" lines, "- " bullets and **bold**, nothing else. Built as elements, never as HTML.
function Rich({ text }) {
  const inline = (s, k) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <strong key={k + i}>{p.slice(2, -2)}</strong> : p))
  const out = []
  let bullets = []
  const flush = () => { if (bullets.length) { out.push(<ul key={'u' + out.length} className="bilan-ul">{bullets}</ul>); bullets = [] } }
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    const h = /^#{1,4}\s+(.*)$/.exec(line)
    const b = /^[-*•]\s+(.*)$/.exec(line)
    if (h) { flush(); out.push(<h4 key={'h' + i} className="bilan-h">{inline(h[1].replace(/\*\*/g, ''), 'h' + i)}</h4>) }
    else if (b) bullets.push(<li key={'b' + i}>{inline(b[1], 'b' + i)}</li>)
    else { flush(); out.push(<p key={'p' + i}>{inline(line, 'p' + i)}</p>) }
  })
  flush()
  return <div className="bilan-text">{out}</div>
}

const ERRORS = {
  nokey: () => t('Add a Gemini key first. It is free: create one in Google AI Studio, then paste it in Settings.'),
  badkey: () => t('Gemini refused this key. Check it in Settings, or create a new one in Google AI Studio.'),
  offline: () => t('No connection. The analysis above works offline; the AI review needs the internet.'),
  rate: () => t('Gemini’s free limit is reached for now. Try again in a few minutes, or tomorrow.'),
  busy: () => t('Gemini is busy. Try again in a moment.'),
  timeout: () => t('Gemini took too long to answer. Try again.'),
  empty: () => t('Gemini sent back no text. Try again.'),
  error: () => t('Something went wrong with Gemini. Try again.'),
}

export default function PerfBilan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const a = useMemo(() => analyzePerf(S, { nameOf: id => { const ex = exerciseOf(id) || (S.customEx || []).find(c => c.id === id); return ex ? exerciseNameFor(ex) : id } }), [S])
  const [report, setReport] = useState(loadReport)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const toast = m => useUI.getState().toast(m)

  const ask = async () => {
    setBusy(true); setError(null)
    try {
      const key = await getGeminiKey()
      const { text, model } = await askGemini(key, summaryToText(a))
      const next = { at: Date.now(), text, model, period: a.period }
      saveReport(next); setReport(next)
    } catch (e) {
      setError(ERRORS[e?.kind] ? e.kind : 'error')
    } finally { setBusy(false) }
  }
  const copy = async () => toast((await copyText(copyableBilan(a))) ? t('Copied. Paste it into Claude.') : t('Could not copy'))
  const forget = () => { clearReport(); setReport(null) }

  const unit = a.unit
  const by = status => a.exercises.filter(e => e.status === status)
  const watch = [...by('regression'), ...by('stagnation')]
  const good = by('progress')
  const maxSets = Math.max(1, ...a.volume.byGroup.map(g => g.perWeek))
  const maxWeek = Math.max(1, ...a.sessions.weeks.map(w => w.sessions))
  const flagText = {
    'push-heavy': t('Much more pushing than pulling'), 'pull-heavy': t('Much more pulling than pushing'),
    'upper-heavy': t('Upper body far ahead of lower body'), 'lower-heavy': t('Lower body far ahead of upper body'),
  }

  return <div className="narrow bilan">
    <div className="hdr">
      <button className="iconbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}>
        <h1>{t('Performance review')}</h1>
        <div className="sub">{t('Last {0} weeks', a.period.weeks)}</div>
      </div>
    </div>

    {!a.hasData ? <div className="empty">
      <div className="ico"><Icon name="chart" /></div>{t('Nothing to analyze yet. Log a few workouts first.')}
    </div> : <>
      <div className="bilan-kpis">
        <div className="tile"><div className="l">{t('Sessions a week')}</div><div className="v">{fmtNum(a.sessions.perWeek)}</div></div>
        <div className="tile"><div className="l">{t('Improving')}</div><div className="v" style={{ color: good.length ? 'var(--green)' : undefined }}>{a.counts.progress}</div></div>
        <div className="tile"><div className="l">{t('To watch')}</div><div className="v" style={{ color: watch.length ? 'var(--orange)' : undefined }}>{watch.length}</div></div>
      </div>

      <h4 className="sec">{t('AI review')}</h4>
      <div className="card bilan-ai">
        {report && <>
          <div className="small muted bilan-when">{t('Review of {0}', fmtDate(isoOf(new Date(report.at)), true))}</div>
          <Rich text={report.text} />
        </>}
        {error && <div className="bilan-err" role="alert">
          <p>{ERRORS[error]()}</p>
          {(error === 'nokey' || error === 'badkey') && <div className="bilan-err-acts">
            <Button size="sm" variant="tinted" onClick={() => nav('/settings/plan')}>{t('Open Settings')}</Button>
            <Button size="sm" variant="tinted" icon="link" onClick={() => openExternal(AI_STUDIO_KEY_URL)}>{t('Get a key')}</Button>
          </div>}
        </div>}
        <div className="bilan-acts">
          <Button variant="primary" icon="sparkles" disabled={busy} onClick={ask}>
            {busy ? t('Asking Gemini…') : report ? t('Redo the review') : t('Ask Gemini for a review')}
          </Button>
          <Button icon="clipboard" onClick={copy}>{t('Copy my review')}</Button>
          {report && !busy && <Button variant="ghost" icon="trash" onClick={forget}>{t('Forget this review')}</Button>}
        </div>
        <p className="small muted bilan-note">{t('Only the figures on this page are sent to Gemini, never your workouts.')}</p>
      </div>

      <ExerciseList title={t('To watch')} items={watch} unit={unit} empty={null} />
      <ExerciseList title={t('Going well')} items={good} unit={unit} empty={null} />
      {a.records.length > 0 && <>
        <h4 className="sec">{t('Recent records')}</h4>
        <div className="list">{a.records.map(r => <div className="item bilan-ex" key={r.id + (r.machine || '')}>
          <span className="lrow-i" style={{ background: 'var(--green)' }}><Icon name="trophy" /></span>
          <div className="grow">
            <div className="tt">{r.name}</div>
            <div className="ss">{[r.machine, r.metric === 'e1rm' ? t('Est. 1RM {0} {1}', fmtNum(r.value), unit) : t('{0} reps', fmtNum(r.value)), fmtDate(r.d, true)].filter(Boolean).join(' · ')}</div>
          </div>
        </div>)}</div>
      </>}

      <h4 className="sec">{t('Sets per week')}</h4>
      <div className="card">
        <Bars max={maxSets} rows={GROUPS.map(g => ({ key: g.id, label: groupName(g.id), value: a.volume.byGroup.find(x => x.id === g.id).perWeek }))} />
        <div className="bilan-balance">
          <div><span className="l">{t('Push')}</span><b>{fmtNum(a.volume.push)}</b></div>
          <div><span className="l">{t('Pull')}</span><b>{fmtNum(a.volume.pull)}</b></div>
          <div><span className="l">{t('Upper body')}</span><b>{fmtNum(a.volume.upper)}</b></div>
          <div><span className="l">{t('Lower body')}</span><b>{fmtNum(a.volume.lower)}</b></div>
        </div>
        {a.flags.map(f => <p key={f} className="bilan-flag"><Icon name="warning" />{flagText[f]}</p>)}
      </div>

      <h4 className="sec">{t('Regularity')}</h4>
      <div className="card">
        <Bars max={maxWeek} rows={a.sessions.weeks.map(w => ({ key: w.week, label: fmtDate(w.week, true), value: w.sessions }))} />
        <p className="small muted bilan-note">
          {a.sessions.skipped.length
            ? t('{0} planned sessions skipped, last: {1}', a.sessions.skipped.length, a.sessions.skipped.slice(-3).map(s => fmtDate(s.d, true)).join(', '))
            : t('No planned session skipped.')}
        </p>
      </div>
    </>}
  </div>
}
