import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, tn } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { MUSCLES, MUSCLE_NAME } from '../lib/muscles.js'
import { EXIDX } from '../lib/exercises.js'
import {
  SKILLS, BRANCHES, SKILL_FAMILIES, TIER_NAME, TIER_COLOR, TIER_ROMAN, haveOf, skillStatus, missingBefore,
  skillsAfter, withSkill, withoutSkill, earnedSkills, withEarned, newlyHad, provedNames, countOf, familyIds, openSkills, muscleIds, muscleLevels, treeItems, treeGrid,
} from '../lib/skill-tree.js'
import BodyMap from '../components/BodyMap.jsx'
import { Thumb } from '../components/Media.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { exerciseDetailSheet } from '../sheets.jsx'
import { TrainIt } from '../components/Ladders.jsx'
import { addBranchLadder } from '../lib/skill-ladder.js'
import { OWN_MAX } from '../lib/ladders.js'
import './Skills.css'

// Bodyweight skill trees, the way a game draws them (lib/skill-tree.js). Four looks at the same
// skills: the summary (the body in a ring, the six families around it), a list, the body map and
// the tree. Tapping a skill anywhere opens the same sheet, where it is ticked or taken back.

const FAM = Object.fromEntries(SKILL_FAMILIES.map(f => [f.id, f]))

export const skillSheet = id => useUI.getState().openSheet(close => <SkillSheet id={id} close={close} />)

export default function Skills() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const have = haveOf(S)
  const [mode, setMode] = useState('summary')
  const [fam, setFam] = useState('hpull')
  const all = countOf(have, Object.keys(SKILLS))
  // Catch up with the whole log: sessions from before the trees, or logged on another device.
  useEffect(() => {
    const st = useStore.getState().S
    const earned = earnedSkills(st)
    const next = withEarned(st.skills, earned)
    const gained = newlyHad(st.skills, next)
    if (!gained.length) return
    useStore.getState().update(x => { x.skills = next })
    useUI.getState().toast(t('Unlocked from your sessions: {0}', provedNames(gained, earned)))
  }, [S.workouts, S.customEx])
  return <>
    <div className="hdr"><button className="iconbtn" data-back="/library" onClick={() => nav('/library')} aria-label={t('Exercises')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Skills')}</h1>
        <div className="sub">{t('{0} of {1} skills', all.done, all.total)} · <span className="skt-open-count">{t('{0} to go for', all.open)}</span></div></div></div>
    <Segmented className="skt-modes" value={mode} onChange={setMode} options={[
      { value: 'summary', label: t('Summary') }, { value: 'list', label: t('List') },
      { value: 'body', label: t('Body') }, { value: 'tree', label: t('Tree view') },
    ]} />
    {(mode === 'list' || mode === 'tree') && <FamilyChips fam={fam} setFam={setFam} />}
    {mode === 'summary' && <Summary have={have} body={S.body} onTree={f => { setFam(f); setMode('tree') }} />}
    {mode === 'list' && <SkillList have={have} fam={fam} />}
    {mode === 'body' && <BodyView have={have} body={S.body} />}
    {mode === 'tree' && <Tree key={fam} have={have} fam={fam} />}
    <p className="small dim skt-credit">{t('From the Bodyweight Fitness progression chart (r/bodyweightfitness). The demo links open the chart’s own videos.')}</p>
  </>
}

function FamilyChips({ fam, setFam }) {
  return <div className="chips skt-fams">
    {SKILL_FAMILIES.map(f => <button key={f.id} className={'chip' + (f.id === fam ? ' on' : '')} aria-pressed={f.id === fam}
      style={f.id === fam ? { background: f.color } : undefined} onClick={() => setFam(f.id)}>{t(f.name)}</button>)}
  </div>
}

/* ---------------------------------- summary ---------------------------------- */

// The body in a ring and the six families around it. A tapped family drops to the bottom like a
// seed (from where its bubble was, `seed`), and its tree grows up out of it; Back brings the ring back.
function Summary({ have, body, onTree }) {
  const [grown, setGrown] = useState(null)       // { fam, from: the bubble's screen rect }
  const total = countOf(have, Object.keys(SKILLS))
  if (grown) return <Tree have={have} fam={grown.fam} up seed={grown.from} onBack={() => setGrown(null)} onFull={() => onTree(grown.fam)} />
  return <>
    <div className="skt-orbit">
      <div className="skt-ring" aria-hidden="true" />
      <div className="skt-core">
        <BodyMap body={body} levels={muscleLevels(have)} />
        <div className="skt-core-cap">{t('{0} of {1} skills', total.done, total.total)}</div>
      </div>
      {SKILL_FAMILIES.map((fm, k) => {
        const c = countOf(have, familyIds(fm.id)), pct = Math.round(100 * c.done / c.total)
        const a = (-90 + k * 60) * Math.PI / 180
        return <button key={fm.id} className="skt-bubble"
          style={{ left: `${50 + 40 * Math.cos(a)}%`, top: `${50 + 40 * Math.sin(a)}%`, '--c': fm.color, '--p': pct + '%', animationDelay: k * 55 + 'ms' }}
          aria-label={`${t(fm.name)}, ${pct} %`} onClick={e => setGrown({ fam: fm.id, from: e.currentTarget.getBoundingClientRect() })}>
          <span className="skt-bubble-in"><b>{pct}%</b><span>{t(fm.name)}</span></span>
        </button>
      })}
    </div>
    <p className="small muted skt-hint">{t('Tap a family to grow its tree.')}</p>
  </>
}

/* ----------------------------------- list ------------------------------------ */

function SkillList({ have, fam }) {
  return BRANCHES.filter(b => b.fam === fam).map(b => {
    const c = countOf(have, b.ids)
    return <section key={b.name} className="skt-list-sec">
      <div className="row between"><h4 className="sec" style={{ margin: 0 }}>{b.name}</h4>
        <span className="small dim">{b.from ? t('after {0}', SKILLS[b.from].name) + ' · ' : ''}{c.done} / {c.total}</span></div>
      <div className="card skt-rows">{b.ids.map(id => <SkillRow key={id} have={have} id={id} />)}</div>
    </section>
  })
}

function SkillRow({ have, id, where }) {
  const s = SKILLS[id], st = skillStatus(have, id)
  return <button className={'skt-row ' + st} style={{ '--c': TIER_COLOR[s.tier] }} onClick={() => skillSheet(id)}
    aria-label={`${s.name}, ${stateWord(st)}, ${t(TIER_NAME[s.tier])}`}>
    <StateIcon st={st} />
    <span className="skt-row-name"><span>{s.name}</span>{where && <span className="small muted">{t(FAM[s.fam].name)} · {s.branch}</span>}</span>
    <span className="skt-tier">{t(TIER_NAME[s.tier])}</span>
  </button>
}

// What a screen reader says for a skill's state: the icon beside it is only drawn.
const stateWord = st => (st === 'done' ? t('Already yours') : st === 'open' ? t('You can go for') : t('Locked'))

const StateIcon = ({ st }) => <span className={'skt-state ' + st}><Icon name={st === 'done' ? 'check' : st === 'open' ? 'star' : 'lock'} /></span>

/* ----------------------------------- body ------------------------------------ */

function BodyView({ have, body }) {
  const [m, setM] = useState('chest')
  const ids = muscleIds(m)
  const open = openSkills(have, ids)
  const done = ids.filter(id => have[id])
  const locked = ids.length - open.length - done.length
  return <>
    <div className="card">
      <BodyMap className="tappable" body={body} levels={muscleLevels(have)} selected={m} onMuscle={x => muscleIds(x).length && setM(x)} />
      <div className="chips" style={{ marginTop: 10 }}>
        {MUSCLES.filter(x => muscleIds(x).length).map(x => <button key={x} className={'chip' + (x === m ? ' on' : '')} aria-pressed={x === m} onClick={() => setM(x)}>{t(MUSCLE_NAME[x])}</button>)}
      </div>
    </div>
    <p className="small muted skt-hint">{t('The greener a muscle, the more of its skills you have.')}</p>
    <section className="card skt-panel">
      <div className="row between"><h3 style={{ margin: 0 }}>{t(MUSCLE_NAME[m])}</h3><span className="small muted">{t('{0} of {1} skills', done.length, ids.length)}</span></div>
      <h4 className="sec skt-sub">{t('You can go for')}</h4>
      {open.length ? <div className="skt-rows">{open.map(id => <SkillRow key={id} have={have} id={id} where />)}</div>
        : <div className="small muted">{t('Nothing open for this muscle yet.')}</div>}
      {done.length > 0 && <><h4 className="sec skt-sub">{t('Already yours')}</h4>
        <div className="skt-had">{done.map(id => <button key={id} className="chip skt-had-chip" onClick={() => skillSheet(id)}>{SKILLS[id].name}</button>)}</div></>}
      {locked > 0 && <div className="small dim" style={{ marginTop: 10 }}>{t('{0} more still locked', locked)}</div>}
    </section>
  </>
}

/* ----------------------------------- tree ------------------------------------ */

const COL = 78, ROW = 84, R = 19, PAD = 46, HUB_R = 26

// One family's tree. Top down in the Tree tab; `up` grows it from the bottom, the family's seed
// first, for the summary, where `seed` is the screen rect the seed flies in from.
function Tree({ have, fam, up = false, seed = null, onBack, onFull }) {
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState({})
  const items = treeItems(fam, have, { all, open })
  const g = treeGrid(items)
  const inner = PAD * 2 + (g.cols - 1) * COL
  const scroller = useRef(null)
  const hubRef = useRef(null)
  const w = Math.max(scroller.current?.clientWidth || 0, inner), off = (w - inner) / 2
  const h = PAD * 2 + 16 + (g.rows - 1) * ROW + 30
  const dir = up ? -1 : 1
  const at = p => ({ x: off + PAD + p.col * COL, y: up ? h - PAD - 30 - p.row * ROW : PAD + 8 + p.row * ROW })
  const hub = at(g.hub)
  const f = FAM[fam]
  const c = countOf(have, familyIds(fam))
  const [, reflow] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    reflow(n => n + 1)                                       // the width is known now
    el.scrollLeft = Math.max(0, hub.x - el.clientWidth / 2)
    el.scrollTop = up ? el.scrollHeight : 0
    const hb = hubRef.current
    if (!seed || !hb || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    // The seed flies from where its bubble was down to the foot of the tree.
    const to = hb.getBoundingClientRect()
    const dx = seed.left + seed.width / 2 - (to.left + to.width / 2), dy = seed.top + seed.height / 2 - (to.top + to.height / 2)
    hb.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${seed.width / to.width})` }, { transform: 'none' }],
      { duration: 520, easing: 'cubic-bezier(.32,.72,0,1)' })
  }, [])
  useEffect(() => {
    const el = scroller.current
    if (!el || typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(() => reflow(n => n + 1))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const stateOf = it => it.kind === 'done' ? 'done' : it.kind === 'more' ? 'locked' : skillStatus(have, it.ids[0])
  // Growing: each row shows a beat after the one before it, once the seed has landed.
  const grow = row => (up && seed ? { '--d': 420 + row * 70 + 'ms' } : null)
  const segs = []
  for (const it of items) {
    const s = stateOf(it), tc = TIER_COLOR[SKILLS[it.ids[0]].tier], row = g.pos[it.key].row
    const a = it.parent === 'hub' ? hub : at(g.pos[it.parent]), b = at(g.pos[it.key])
    const y0 = a.y + dir * (it.parent === 'hub' ? HUB_R : R), y1 = b.y - dir * R, cls = 'skt-seg ' + s
    const v = (x, ya, yb) => segs.push({ cls: cls + ' v', tc, row, x: x - 1.5, y: Math.min(ya, yb), w: 3, h: Math.abs(yb - ya) })
    if (a.x === b.x) v(a.x, y0, y1)
    else {
      const mid = a.y + dir * ROW / 2
      v(a.x, y0, mid - dir * 1.5)
      segs.push({ cls: cls + ' hz', tc, row, x: Math.min(a.x, b.x) - 1.5, y: mid - 1.5, w: Math.abs(b.x - a.x) + 3, h: 3 })
      v(b.x, mid - dir * 1.5, y1)
    }
  }
  segs.sort((p, q) => (p.cls.includes('locked') ? 0 : 1) - (q.cls.includes('locked') ? 0 : 1))
  return <>
    {up ? <div className="row skt-tree-bar">
      <Button size="sm" variant="plain" icon="chevronLeft" onClick={onBack}>{t('Back')}</Button>
      <span className="skt-grow-title" style={{ color: f.color }}>{t(f.name)}</span>
      <Button size="sm" variant="tinted" onClick={onFull}>{t('Tree view')}</Button>
    </div> : <div className="row skt-tree-bar">
      <span className="small muted" style={{ flex: 1 }}>{t('{0} of {1} skills', c.done, c.total)}</span>
      {!all && Object.keys(open).length > 0 && <Button size="sm" variant="plain" onClick={() => setOpen({})}>{t('Collapse')}</Button>}
      <Button size="sm" variant="tinted" onClick={() => { setAll(v => !v); setOpen({}) }}>{all ? t('Compact view') : t('Show all')}</Button>
    </div>}
    <div className={'skt-tree' + (up ? ' up' : '') + (up && seed ? ' growing' : '')} ref={scroller}>
      <div style={{ position: 'relative', width: w, height: h }}>
        {segs.map((s, i) => <div key={i} className={s.cls} style={{ left: s.x, top: s.y, width: s.w, height: s.h, '--c': s.tc, ...grow(s.row) }} />)}
        <div ref={hubRef} className="skt-hub" style={{ left: hub.x - 50, top: up ? hub.y - 32 : hub.y - HUB_R - 18, '--c': f.color, '--p': Math.round(100 * c.done / c.total) + '%' }}>
          <span className="skt-hub-c"><span>{Math.round(100 * c.done / c.total)}%</span></span><span>{up ? t('{0} of {1} skills', c.done, c.total) : t(f.name)}</span>
        </div>
        {items.map(it => {
          const p = at(g.pos[it.key]), s = stateOf(it), sk = SKILLS[it.ids[0]]
          const ex = it.kind === 'skill' && sk.ex ? EXIDX[sk.ex] : null
          const unfold = () => setOpen(o => ({ ...o, [it.branch]: true }))
          const name = it.kind === 'skill' ? sk.name : it.kind === 'done' ? t('{0} had', it.ids.length) : t('{0} more', it.ids.length)
          return <button key={it.key} className={'skt-node ' + it.kind + ' ' + s} style={{ left: p.x - 37, top: p.y - R, '--c': TIER_COLOR[sk.tier], ...grow(g.pos[it.key].row) }}
            aria-label={it.kind === 'skill' ? `${sk.name}, ${stateWord(s)}, ${t(TIER_NAME[sk.tier])}` : `${name}, ${it.branch}`}
            onClick={it.kind === 'skill' ? () => skillSheet(sk.id) : unfold}>
            <span className="skt-node-c">
              {it.kind === 'skill' ? (ex ? <span className="skt-node-img"><Thumb ex={ex} /></span> : <Icon name={s === 'done' ? 'check' : s === 'open' ? 'star' : 'lock'} />)
                : (it.kind === 'done' ? '✓' : '+') + it.ids.length}
              {it.kind === 'skill' && <span className="skt-badge">{TIER_ROMAN[sk.tier]}</span>}
            </span>
            <span className="skt-node-name">{name}</span>
          </button>
        })}
      </div>
    </div>
    <p className="small dim skt-hint">{t('Tap ✓ or + to unfold a branch.')}</p>
  </>
}

/* ---------------------------------- the sheet ---------------------------------- */

function SkillSheet({ id: first, close }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [id, setId] = useState(first)
  const have = haveOf(S)
  const s = SKILLS[id], st = skillStatus(have, id)
  const branch = BRANCHES[s.bi], at = branch.ids.indexOf(id)
  const prev = at > 0 ? branch.ids[at - 1] : s.req, next = branch.ids[at + 1] || null
  const before = missingBefore(have, id)
  const after = skillsAfter(id).filter(x => have[x])
  const ex = s.ex ? EXIDX[s.ex] : null
  return <div className="skt-sheet" style={{ '--c': TIER_COLOR[s.tier] }}>
    <div className="row skt-sheet-nav">
      <button className="iconbtn" disabled={!prev} onClick={() => prev && setId(prev)} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
      <span className="small muted">{s.branch} · {at + 1} / {branch.ids.length}</span>
      <button className="iconbtn" disabled={!next} onClick={() => next && setId(next)} aria-label={t('Next')}><Icon name="chevronRight" /></button>
    </div>
    {ex && <button className="skt-sheet-ex" onClick={() => exerciseDetailSheet(ex)}><Thumb ex={ex} /><span className="small muted">{t('Open the exercise')}</span><Icon name="chevronRight" /></button>}
    <div className="row" style={{ gap: 8 }}><span className="skt-tier">{t(TIER_NAME[s.tier])}</span><span className="small muted">{t(FAM[s.fam].name)}</span></div>
    <h3 className="skt-sheet-name">{s.name}</h3>
    <div className={'small skt-sheet-state ' + st}>{st === 'done' ? t('Yours since {0}', fmtDate(have[id], true, true)) : st === 'open' ? t('Open: you have what comes before') : t('Locked')}</div>
    <div className="card skt-facts">
      <div className="row between"><span className="muted">{t('Before it')}</span><span>{s.req ? SKILLS[s.req].name : t('Nothing')}</span></div>
      <div className="row between"><span className="muted">{t('Opens')}</span><span>{s.kids.length ? s.kids.map(k => SKILLS[k].name).join(', ') : t('End of the branch')}</span></div>
    </div>
    {s.url && <a className="btn tinted skt-demo" href={s.url} target="_blank" rel="noopener noreferrer"><Icon name="play" />{t('Watch the demo')}</a>}
    {/* The branch as one of your ladders (lib/skill-ladder.js), trained on the Skill ladder rule. */}
    <Button variant="tinted" icon="stairs" onClick={() => {
      let made = null
      update(x => { made = addBranchLadder(x, s.bi) })
      if (made) useUI.getState().openSheet(c => <TrainIt ladder={made.ladder} rung={made.rung} close={c} />)
      else toast(t('You have {0} ladders of your own, the most there can be. Remove one to add this branch.', OWN_MAX))
    }}>{t('Train this branch')}</Button>
    {st !== 'done' ? <>
      <Button variant="primary" onClick={() => {
        update(x => { x.skills = withSkill(x.skills, id) })
        toast(t('Skill unlocked: {0}', s.name))
      }}>{t('I have this skill')}</Button>
      {before.length > 0 && <div className="small muted skt-center">{tn('Also ticks the skill before it', 'Also ticks the {0} skills before it', before.length)}</div>}
    </> : <>
      <Button variant="danger" onClick={() => update(x => { x.skills = withoutSkill(x.skills, id) })}>{t('Not yet')}</Button>
      {after.length > 0 && <div className="small muted skt-center">{tn('Also takes back the skill after it', 'Also takes back the {0} after it', after.length)}</div>}
    </>}
    <Button variant="plain" onClick={close}>{t('Close')}</Button>
  </div>
}
