// Import a routine from a YouTube follow-along video.
//
// Four steps on one screen: paste a link → the server works (progress, cancel) → if this
// creator's captions have never been marked, draw a box around the exercise name and one around
// the timer → review what was read and save it as a routine. The reading runs on the server's
// optional video-import worker; this screen only exists when GET /api/config says it does.
//
// Nothing read off a video is trusted without being shown: every row can be re-matched, renamed,
// merged into its neighbour or deleted, and a name that matched nothing becomes the profile's own
// exercise rather than disappearing.
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { DEMO } from '../lib/demo.js'
import { exOr } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n-core.js'
import { fmtDuration } from '../lib/duration.js'
import { draftRows, rowBadge, rowsMissingName, mergeRows, duplicateRow, splitRow, applyToRounds, buildVideoRoutine, mergeVideoRoutine, videoLinkAt } from '../lib/import-video.js'
import { videoImportAvailable, startVideoImport, videoImportJob, submitVideoRoi, cancelVideoImport, stageText, videoImportError } from '../lib/video-import-api.js'
import { exercisePicker } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Button, TextField, NumberField, Check, Segmented } from '../components/ui.jsx'

const POLL_MS = 1500
const JOB_KEY = 'gym_video_import_job'
const remembered = () => { try { return sessionStorage.getItem(JOB_KEY) || null } catch { return null } }
const remember = id => { try { id ? sessionStorage.setItem(JOB_KEY, id) : sessionStorage.removeItem(JOB_KEY) } catch { /* private mode */ } }

const sectionTitle = kind => (kind === 'warmup' ? t('Warm-up') : kind === 'interval' ? t('Intervals') : kind === 'stretch' ? t('Stretching') : t('Exercises'))
const clock = s => { const n = Math.max(0, Math.floor(s || 0)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0') }

export default function VideoImport() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const refreshConfig = useStore(s => s.refreshConfig)
  const toast = useUI(s => s.toast)

  const [url, setUrl] = useState('')
  const [forceVideo, setForceVideo] = useState(false)
  const [job, setJob] = useState(null)
  const [jobId, setJobId] = useState(remembered)
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState(null)
  const [name, setName] = useState('')
  const lastUrl = useRef('')

  useEffect(() => { if (user && !config) refreshConfig() }, [user])

  // Poll while there is a job that is not finished; stop when it is, or when the screen goes.
  useEffect(() => {
    if (!jobId) return undefined
    let stop = false, timer = null
    const tick = async () => {
      try {
        const j = await videoImportJob(jobId)
        if (stop) return
        setJob(j)
        if (j.status === 'done' && j.result) {
          remember(null)
          setRows(draftRows(j.result, useStore.getState().S))
          setName(j.result.source?.title || '')
          return
        }
        if (j.status === 'error' || j.status === 'cancelled') { remember(null); return }
      } catch (e) {
        if (stop) return
        if (e.status === 404) { remember(null); setJobId(null); setJob(null); return }
        // A dropped poll is not a failed job: try again on the next tick.
      }
      timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [jobId])

  if (!videoImportAvailable(config, user, { demo: DEMO })) {
    return <div className="narrow">
      <Header nav={nav} />
      <div className="card"><div className="muted small">{config == null && user ? t('Loading…') : t('This server does not offer importing from videos. Its owner can switch it on; see the self-hosting guide.')}</div></div>
    </div>
  }

  const start = async ({ mode, redraw } = {}) => {
    // After a reload the field is empty: the job itself knows which video it was.
    const link = (url || lastUrl.current || job?.source?.url || '').trim()
    if (!link) return
    setBusy(true)
    try {
      const j = await startVideoImport(link, { mode: mode || (forceVideo ? 'video' : 'auto'), redraw })
      lastUrl.current = link
      setRows(null); setJob(j); setJobId(j.id); remember(j.id)
    } catch (e) {
      toast(videoImportError(e.data?.code, e.message))
    } finally { setBusy(false) }
  }
  const cancel = async () => {
    if (!jobId) return
    try { await cancelVideoImport(jobId) } catch { /* it may have finished meanwhile */ }
    remember(null); setJobId(null); setJob(null)
  }
  const reset = () => { remember(null); setJobId(null); setJob(null); setRows(null); setName('') }

  const save = () => {
    if (!rows?.length) return
    // A row with nothing to save it as is never dropped quietly: it is named, picked or deleted.
    const missing = rowsMissingName(rows).length
    if (missing) return toast(tn('{0} row has no exercise yet. Pick one or delete the row.', '{0} rows have no exercise yet. Pick one or delete the rows.', missing))
    const source = job?.result?.source || {}
    const labels = { warmup: t('Warm-up'), stretch: t('Stretching'), other: t('Exercises') }
    let out
    update(s => {
      const built = buildVideoRoutine(rows, { name, source, labels, customEx: s.customEx || [] })
      out = mergeVideoRoutine(s, built)
    })
    toast(out?.updated ? t('Routine updated from the video') : t('Routine added from the video'))
    reset()
    if (out?.id) nav('/plan/r/' + out.id)
  }

  const status = job?.status
  return <div className="narrow video-import">
    <Header nav={nav} />

    {!jobId && !rows && <>
      <Section title={t('Video link')} footer={t('The server downloads a small copy (480p at most, no sound), reads the exercise names and the timer off the screen, then deletes the video. Only the list of exercises is kept.')}>
        <div style={{ padding: '8px 12px' }}>
          <TextField value={url} placeholder="https://www.youtube.com/watch?v=…" inputMode="url" autoCapitalize="none" autoCorrect="off"
            onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') start() }} />
        </div>
        <label className="row" style={{ gap: 10, padding: '6px 12px 10px' }}>
          <Check checked={forceVideo} onChange={setForceVideo} label={t('Read the video even if it has chapters')} />
          <span className="small">{t('Read the video even if it has chapters')}</span>
        </label>
      </Section>
      <Button variant="primary" icon="play" disabled={busy || !url.trim()} onClick={() => start()}>{t('Analyse video')}</Button>
    </>}

    {jobId && !rows && status !== 'needs_roi' && <div className="card">
      {job?.source?.title && <div style={{ fontWeight: 600, marginBottom: 6 }}>{job.source.title}</div>}
      {status === 'error' || status === 'cancelled'
        ? <>
            <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{status === 'cancelled' ? t('Import cancelled.') : videoImportError(job?.code, job?.error)}</div>
            <Button onClick={reset}>{t('Start over')}</Button>
          </>
        : <>
            <div className="small muted" style={{ marginBottom: 8 }}>{stageText(job?.stage || 'queued')}</div>
            <div className="vi-bar" role="progressbar" aria-valuenow={job?.pct || 0} aria-valuemin={0} aria-valuemax={100}><span style={{ width: (job?.pct || 0) + '%' }} /></div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
              <span className="small muted">{(job?.pct || 0) + '%'}</span>
              <Button size="sm" onClick={cancel}>{t('Cancel')}</Button>
            </div>
          </>}
    </div>}

    {status === 'needs_roi' && job?.roiSetup && !rows &&
      <RoiStep job={job} onDone={async (roi, keep) => {
        setBusy(true)
        try { setJob(await submitVideoRoi(jobId, { ...roi, remember: keep })) } catch (e) { toast(videoImportError(e.data?.code, e.message)) } finally { setBusy(false) }
      }} onCancel={cancel} busy={busy} />}

    {rows && <Review rows={rows} setRows={setRows} result={job?.result} name={name} setName={setName} S={S}
      onSave={save} onReset={reset}
      onReadVideo={() => start({ mode: 'video' })}
      onRedraw={() => start({ mode: 'video', redraw: true })} />}
  </div>
}

function Header({ nav }) {
  return <div className="hdr">
    <button className="iconbtn" data-back="/plan" onClick={() => nav('/plan')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginInlineStart: 10 }}>
      <h1>{t('Import from a video')}</h1>
      <div className="sub">{t('A follow-along workout becomes a routine')}</div>
    </div>
  </div>
}

/* ------------------------------------------------------------------ boxes */

// Drawing a box: press, drag, release, on top of the still. Coordinates are fractions of the
// image, which is what the server stores — the same box fits every resolution of the video.
// Names can sit in more than one place (a big preview in the workout, a small one in the
// warm-up): each drag in "Exercise name" adds a box, up to three, and × removes one. The timer
// has one box, and a new drag replaces it.
const MAX_NAME_BOXES = 3
const MAX_TIMER_BOXES = 3
function RoiStep({ job, onDone, onCancel, busy }) {
  const setup = job.roiSetup
  const suggested = setup.suggest?.names?.length ? setup.suggest.names : setup.suggest?.name ? [setup.suggest.name] : []
  const [sample, setSample] = useState(0)
  const [which, setWhich] = useState('name')
  const [names, setNames] = useState(suggested.slice(0, MAX_NAME_BOXES))
  // Up to three timers: a video can count the work in one place and the rest in another, or move
  // the work timer part-way through.
  const [timers, setTimers] = useState(setup.suggest?.timers?.length ? setup.suggest.timers.slice(0, 3) : setup.suggest?.timer ? [setup.suggest.timer] : [])
  const [drawing, setDrawing] = useState(null)
  const [keep, setKeep] = useState(true)
  const drag = useRef(null)
  const frame = useRef(null)

  const at = e => {
    const r = frame.current.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const down = e => { e.preventDefault(); frame.current.setPointerCapture?.(e.pointerId); drag.current = at(e) }
  const move = e => {
    if (!drag.current) return
    const p = at(e), a = drag.current
    setDrawing({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) })
  }
  const up = () => {
    drag.current = null
    // A tap, not a drag, leaves no box behind.
    if (drawing && drawing.w >= 0.02 && drawing.h >= 0.02) {
      if (which === 'timer') setTimers(list => [...list, drawing].slice(-MAX_TIMER_BOXES))
      else setNames(list => [...list, drawing].slice(-MAX_NAME_BOXES))
    }
    setDrawing(null)
  }
  const style = b => ({ left: b.x * 100 + '%', top: b.y * 100 + '%', width: b.w * 100 + '%', height: b.h * 100 + '%' })
  // The × sits inside the frame, which draws on pointer-down: it must not start a box.
  const remove = (e, i) => { e.stopPropagation(); setNames(list => list.filter((_, k) => k !== i)) }

  return <>
    <Section title={t('Mark the name and the timer')} footer={t('Drag a box around where the exercise name appears, then switch to Timer and do the same for the countdown. Saved for this channel, so its next video skips this step.')}>
      <div style={{ padding: '8px 12px' }}>
        <Segmented value={which} onChange={setWhich} options={[{ value: 'name', label: t('Exercise name') }, { value: 'timer', label: t('Timer') }]} />
        <div ref={frame} className="vi-frame" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ aspectRatio: setup.width && setup.height ? `${setup.width} / ${setup.height}` : '16 / 9' }}>
          <img src={setup.samples[sample]?.src} alt="" draggable={false} />
          {names.map((b, i) => <div key={i} className={'vi-box name' + (which === 'name' ? ' on' : '')} style={style(b)}>
            <span>{t('Exercise name')}</span>
            <button className="vi-box-x" onPointerDown={e => e.stopPropagation()} onClick={e => remove(e, i)} aria-label={t('Remove this box')}>×</button>
          </div>)}
          {timers.map((b, i) => <div key={'t' + i} className={'vi-box timer' + (which === 'timer' ? ' on' : '')} style={style(b)}>
            <span>{t('Timer')}</span>
            <button className="vi-box-x" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setTimers(list => list.filter((_, k) => k !== i)) }} aria-label={t('Remove this box')}>×</button>
          </div>)}
          {drawing && <div className={'vi-box on ' + which} style={style(drawing)} />}
        </div>
        <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {setup.samples.map((s, i) => <button key={i} className={'chip' + (i === sample ? ' on' : '')} onClick={() => setSample(i)}>{clock(s.t)}</button>)}
          {timers.length > 0 && <button className="chip" onClick={() => setTimers([])}>{t('No timer on screen')}</button>}
        </div>
        {which === 'timer' && <div className="small muted" style={{ marginTop: 6 }}>{t('Timer in more than one place (the rest elsewhere, or moved part-way)? Drag a box around each, up to three.')}</div>}
        {which === 'name' && <div className="small muted" style={{ marginTop: 6 }}>{t('Names shown in more than one place (a big preview, a small one in the warm-up)? Drag a box around each, up to three.')}</div>}
      </div>
      <label className="row" style={{ gap: 10, padding: '6px 12px 10px' }}>
        <Check checked={keep} onChange={setKeep} label={t('Remember for this channel')} />
        <span className="small">{t('Remember for this channel')}{job.source?.channel ? ' · ' + job.source.channel : ''}</span>
      </label>
    </Section>
    <div className="row" style={{ gap: 8 }}>
      <Button variant="primary" icon="check" disabled={busy || !names.length} onClick={() => onDone({ name: names.length === 1 ? names[0] : names, timer: timers.length > 1 ? timers : timers[0] || null }, keep)}>{t('Continue')}</Button>
      <Button onClick={onCancel}>{t('Cancel')}</Button>
    </div>
  </>
}

/* ----------------------------------------------------------------- review */

function Review({ rows, setRows, result, name, setName, S, onSave, onReset, onReadVideo, onRedraw }) {
  const source = result?.source || {}
  const sections = result?.draft?.sections || []
  const patch = (rid, p) => setRows(rs => rs.map(r => (r.rid === rid ? { ...r, ...p } : r)))
  const remove = rid => setRows(rs => rs.filter(r => r.rid !== rid))
  // A pick or a new name goes to every round of the same caption at once.
  const pick = row => exercisePicker(ex => setRows(rs => applyToRounds(rs, row.rid, { exId: ex.id, matchConf: 1, how: 'picked', create: null })), { title: t('Pick the exercise'), like: row.exId || undefined })
  const rename = (row, n) => setRows(rs => applyToRounds(rs, row.rid, { create: { ...(row.create || {}), n } }))
  const unmatched = new Set(rows.filter(r => !r.exId && String(r.create?.n || '').trim()).map(r => r.create.n.trim().toLowerCase())).size

  const groups = []
  for (const r of rows) {
    const g = groups.find(x => x.idx === r.sectionIdx)
    if (g) g.rows.push(r); else groups.push({ idx: r.sectionIdx, kind: r.section, label: r.label, rows: [r] })
  }
  const methodText = result?.method === 'video' ? t('Read off the video') : t('Read from the video’s chapters')

  return <>
    <Section title={t('Routine')} footer={[source.channel, methodText].filter(Boolean).join(' · ')}>
      <div style={{ padding: '8px 12px' }}>
        <TextField value={name} maxLength={80} placeholder={t('Routine name')} onChange={e => setName(e.target.value)} />
      </div>
    </Section>


    {!rows.length && <div className="card"><div className="small muted">{t('No exercise names were found. Try marking the boxes again, or check that the video shows the names on screen.')}</div></div>}

    {groups.map(g => {
      const s = sections[g.idx] || {}
      const summary = g.kind === 'interval'
        ? [s.rounds > 1 ? tn('{0} round', '{0} rounds', s.rounds) : null, s.work ? t('{0} work', fmtDuration(s.work)) : null, s.rest ? t('{0} rest', fmtDuration(s.rest)) : null].filter(Boolean).join(' · ')
        : null
      const roundRest = g.kind === 'interval' && s.roundRest > 0 ? t('The video also rests {0} between rounds; a routine has no place for that, so take it after the last exercise of each round.', fmtDuration(s.roundRest)) : null
      return <Section key={g.idx} title={[g.label, sectionTitle(g.kind)].filter(Boolean).join(' · ') + (summary ? ' · ' + summary : '')} footer={roundRest}>
        {g.rows.map((r, i) => <ReviewRow key={r.rid} row={r} S={S} kind={g.kind} sourceUrl={source.url}
          onPatch={p => patch(r.rid, p)} onRename={n => rename(r, n)} onPick={() => pick(r)} onDelete={() => remove(r.rid)}
          onDuplicate={() => setRows(rs => duplicateRow(rs, r.rid))}
          onSplit={r.sec >= 60 && r.rounds === 1 ? hold => setRows(rs => splitRow(rs, r.rid, hold)) : null}
          onMergeUp={i > 0 ? () => setRows(rs => mergeRows(rs, g.rows[i - 1].rid, r.rid)) : null} />)}
      </Section>
    })}

    {unmatched > 0 && <p className="sect-f" style={{ marginTop: -10 }}>{tn('{0} name matched nothing in the library. It will be added as your own exercise unless you pick one.', '{0} names matched nothing in the library. They will be added as your own exercises unless you pick one.', unmatched)}</p>}

    <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
      <Button variant="primary" icon="check" disabled={!rows.length} onClick={onSave}>{t('Save routine')}</Button>
      {result?.method && result.method !== 'video' && <Button onClick={onReadVideo}>{t('Read the video instead')}</Button>}
      {result?.method === 'video' && <Button onClick={onRedraw}>{t('Mark the boxes again')}</Button>}
      <Button variant="ghost" onClick={onReset}>{t('Start over')}</Button>
    </div>
  </>
}

function ReviewRow({ row, S, kind, sourceUrl, onPatch, onRename, onPick, onDelete, onDuplicate, onSplit, onMergeUp }) {
  const badge = rowBadge(row)
  const tone = badge.kind === 'match' ? (badge.pct >= 75 ? 'good' : badge.pct >= 50 ? 'mid' : 'low') : badge.kind === 'new' ? 'new' : 'low'
  const [hold, setHold] = useState(30)
  const ex = row.exId ? exOr(row.exId) : null
  const exName = ex ? exerciseNameFor(ex) : null
  const link = videoLinkAt(sourceUrl, row.start)
  const interval = kind === 'interval'
  return <div className="vi-row">
    <a className="vi-thumb" href={link || undefined} target="_blank" rel="noopener noreferrer" title={t('Open the video here')}>
      {row.thumb ? <img src={row.thumb} alt="" /> : <Icon name="play" />}
      <span>{clock(row.start)}</span>
    </a>
    <div className="vi-main">
      <div className="vi-read small muted" title={row.variants.join(' · ')}>{row.text ? '“' + row.text + '”' : <i>{t('No name on screen')}</i>}{row.round ? ' · ' + t('Round {0}', row.round) : ''}{row.dur ? ' · ' + fmtDuration(row.dur) : ''}</div>
      {ex
        ? <button className="vi-match" onClick={onPick}><span>{exName}</span><Icon name="chevronDown" /></button>
        : <div className="vi-new">
            <span className="small">{t('New exercise:')}</span>
            <TextField value={row.create?.n || ''} maxLength={80} placeholder={t('Name it, or pick one')} onChange={e => onRename(e.target.value)} />
            <button className="chip" onClick={onPick}>{t('Pick existing')}</button>
          </div>}
      <div className="vi-nums">
        <label><span className="small muted">{interval ? t('Work (s)') : t('Time (s)')}</span><NumberField decimal={false} value={row.sec} onChange={v => onPatch({ sec: v || 1 })} /></label>
        {interval && <label><span className="small muted">{t('Rest (s)')}</span><NumberField decimal={false} value={row.rest} onChange={v => onPatch({ rest: v || 0 })} /></label>}
        {interval && row.rounds > 1 && <label><span className="small muted">{t('Rounds')}</span><NumberField decimal={false} value={row.rounds} onChange={v => onPatch({ rounds: v || 1 })} /></label>}
        {!interval && <label className="vi-side"><Check checked={row.side} onChange={v => onPatch({ side: v })} label={t('Per side')} /><span className="small">{t('Per side')}</span></label>}
        <span className={'vi-conf ' + tone} title={badge.kind === 'match' ? t('How sure the reading and the match are') : badge.kind === 'new' ? t('Not in the library: it will be added as your own exercise') : t('Nothing on screen named this one: pick the exercise')}>
          {badge.kind === 'match' ? badge.pct + '%' : badge.kind === 'new' ? t('new') : '?'}
        </span>
      </div>
      {onSplit && <div className="vi-split">
        <span className="small muted">{t('One long stretch read as one exercise?')}</span>
        <button className="chip" onClick={() => onSplit(hold)}>{t('Split into holds of {0}', fmtDuration(hold))}</button>
        <NumberField decimal={false} value={hold} onChange={v => setHold(Math.max(5, v || 30))} aria-label={t('Seconds per hold')} />
      </div>}
    </div>
    <div className="vi-acts">
      {onMergeUp && <button className="iconbtn" onClick={onMergeUp} aria-label={t('Merge with the row above')} title={t('Merge with the row above')}><Icon name="arrowUp" /></button>}
      <button className="iconbtn" onClick={onDuplicate} aria-label={t('Add this exercise again')} title={t('Add this exercise again')}><Icon name="plus" /></button>
      <button className="iconbtn" onClick={onDelete} aria-label={t('Delete')} title={t('Delete')}><Icon name="trash" /></button>
    </div>
  </div>
}
