// @vitest-environment happy-dom
// G5, markup equivalence: each block renders exactly the markup the pages build by hand today.
// The legacy side is copied from the page it names, with any static inline style swapped for the
// ui-kit.css class of the same value (style={{ margin: 0 }} → m-0, fontSize: '1rem' → stat-unit)
// and nothing else changed.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tappable } from '../lib/use-sheet-keyboard.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { Card, ItemRow, Tiles, StatTile, Stat, EmptyState, InlineNote, Skeleton, SectionTitle, Tag, Chip, ChipRow } from './blocks.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const html = el => renderToStaticMarkup(el)
const same = (primitive, legacy) => expect(html(primitive)).toBe(html(legacy))
const go = () => {}

afterEach(() => vi.restoreAllMocks())

describe('Card', () => {
  it('is .card', () => {
    same(<Card><p>x</p></Card>, <div className="card"><p>x</p></div>)
  })

  it('heads itself with an h2 (Stats.jsx fatigue card)', () => {
    same(<Card title="Fatigue"><p>x</p></Card>, <div className="card"><h2>Fatigue</h2><p>x</p></div>)
  })

  it('puts the title beside its action (Admin.jsx invite codes)', () => {
    same(<Card title="Invite codes" action={<button className="btn primary sm">New code</button>}><p>x</p></Card>,
      <div className="card"><div className="row between"><h2 className="m-0">Invite codes</h2>
        <button className="btn primary sm">New code</button></div><p>x</p></div>)
  })

  it('keeps an action that has no title, at the row end', () => {
    same(<Card action={<button className="btn sm">Edit</button>}>x</Card>,
      <div className="card"><div className="row jc-end"><button className="btn sm">Edit</button></div>x</div>)
  })

  it('takes a tone, an element, a class and other props (Admin.jsx error card)', () => {
    same(<Card tone="danger" as="section" className="hub-card" role="alert">x</Card>,
      <section className="card card-danger hub-card" role="alert">x</section>)
    same(<Card tone="accent">x</Card>, <div className="card card-accent">x</div>)
    same(<Card tone="orange">x</Card>, <div className="card card-orange">x</div>)
  })

  it('throws in development on a tone it has no ring for', () => {
    expect(() => html(<Card tone="red">x</Card>)).toThrow(/Card: tone="red"/)
  })
})

describe('ItemRow', () => {
  it('is .item with the title and subtitle in .grow (Workout.jsx other routines)', () => {
    same(<ItemRow lead={<span className="lrow-i"><Icon name="dumbbell" /></span>} title="Push" subtitle="6 exercises"
      trailing={<span className="tag acc">Start</span>} />,
    <div className="item"><span className="lrow-i"><Icon name="dumbbell" /></span>
      <div className="grow"><div className="tt">Push</div><div className="ss">6 exercises</div></div>
      <span className="tag acc">Start</span></div>)
  })

  it('is a keyboard button with a chevron when it opens something', () => {
    same(<ItemRow title="Bench press" onClick={go} chevron className="in-ss" />,
      <div className="item in-ss" {...tappable(go)}><div className="grow"><div className="tt">Bench press</div></div>
        <Icon name="chevronRight" className="chev" /></div>)
  })

  it('takes class names for the title and the subtitle, and is Library.jsx\'s row', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const lead = <span className="thumb" />
    same(<ItemRow onClick={go} lead={lead} titleClassName="capitalize" subtitleClassName="capitalize"
      title={<><Icon name="starFill" className="fav-star" />Bench press</>} subtitle="Chest · barbell"
      trailing={<><span className="tag acc">80</span><Button size="sm" variant="tinted" icon="plus" onClick={go}>Plan</Button></>} />,
    <div className="item" {...tappable(go)}>
      {lead}
      <div className="grow"><div className={'tt capitalize'}><Icon name="starFill" className="fav-star" />Bench press</div><div className="ss capitalize">Chest · barbell</div></div>
      <span className="tag acc">80</span>
      <Button size="sm" variant="tinted" icon="plus" onClick={go}>Plan</Button>
    </div>)
    // Library's row nests its Plan button inside the tappable row; ItemRow says so.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^ItemRow: a tappable row/))
  })

  it('opens from its text when it holds a control (RoutineEdit.jsx\'s exercise row)', () => {
    same(<ItemRow onOpen={go} title="Bench press" subtitle="3 × 8" trailing={<Button size="sm" onClick={go}>Save</Button>} />,
      <div className="item">
        <button type="button" className="grow item-open" onClick={go}><span className="tt">Bench press</span><span className="ss">3 × 8</span></button>
        <Button size="sm" onClick={go}>Save</Button>
      </div>)
    expect(() => html(<ItemRow onOpen={go} onClick={go} title="a" />)).toThrow(/not both/)
  })

  it('does not warn for a row whose children are not controls, or a row that is not tappable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    html(<ItemRow onClick={go} title="a" trailing={<span className="tag">b</span>} chevron />)
    html(<ItemRow title="a" trailing={<Button onClick={go}>b</Button>} />)
    expect(warn).not.toHaveBeenCalled()
  })
})

describe('Tiles and StatTile', () => {
  it('is .tiles>.tile>.l+.v (Admin.jsx user tiles)', () => {
    same(<Tiles><StatTile label="Workouts" value={12} /><StatTile label="Routines" value={3} /></Tiles>,
      <div className="tiles"><div className="tile"><div className="l">Workouts</div><div className="v">{12}</div></div>
        <div className="tile"><div className="l">Routines</div><div className="v">{3}</div></div></div>)
  })

  it('takes a class on the grid and a smaller value size', () => {
    same(<Tiles className="mb-5"><StatTile label="Jobs today" value={4} size="sm" /><StatTile label="Last sync" value="now" size="xs" /></Tiles>,
      <div className="tiles mb-5"><div className="tile"><div className="l">Jobs today</div><div className="v v-sm">{4}</div></div>
        <div className="tile"><div className="l">Last sync</div><div className="v v-xs">now</div></div></div>)
  })

  it('colours the value and takes a class (Admin.jsx training now)', () => {
    same(<StatTile label="Training now" value={2} tone="acc" className="hub-tile" />,
      <div className="tile hub-tile"><div className="l">Training now</div><div className="v ink-acc">{2}</div></div>)
  })

  it('puts an icon in the label, a unit after the value, and taps', () => {
    same(<StatTile label="Volume" icon="dumbbell" value="1,200" unit="kg" onClick={go} />,
      <div className="tile tappable" {...tappable(go)}><div className="l"><Icon name="dumbbell" />Volume</div>
        <div className="v">1,200 <span className="muted stat-unit">kg</span></div></div>)
  })

  it('throws in development on a size or tone it has no class for', () => {
    expect(() => html(<StatTile label="a" value={1} size="lg" />)).toThrow(/StatTile: size="lg"/)
    expect(() => html(<StatTile label="a" value={1} tone="red" />)).toThrow(/StatTile: tone="red"/)
  })
})

describe('Stat', () => {
  const value = '81.4', unit = 'kg'
  it('is .big and its muted unit (Home.jsx body weight)', () => {
    same(<Stat value={value} unit={unit} />, <div className="big">{value} <span className="muted stat-unit">{unit}</span></div>)
  })

  it('has no unit span without a unit', () => {
    same(<Stat value="–" />, <div className="big">–</div>)
  })

  it('takes the smaller size (Home.jsx welcome)', () => {
    same(<Stat value="Welcome!" size="sm" />, <div className="big big-sm">Welcome!</div>)
  })

  it('throws in development on a size it has no class for', () => {
    expect(() => html(<Stat value="1" size="xs" />)).toThrow(/Stat: size="xs"/)
  })
})

describe('EmptyState', () => {
  it('is .empty>.ico + the text (History.jsx)', () => {
    same(<EmptyState icon="history">No workouts yet.</EmptyState>,
      <div className="empty"><div className="ico"><Icon name="history" /></div>No workouts yet.</div>)
  })

  it('sets a title over the text (FoodHub.jsx)', () => {
    same(<EmptyState icon="utensils" title="Food logging is on its way">Meals will live here.</EmptyState>,
      <div className="empty"><div className="ico"><Icon name="utensils" /></div>
        <strong>Food logging is on its way</strong><div>Meals will live here.</div></div>)
  })

  it('takes a title alone, no icon, and a class (Stats.jsx)', () => {
    same(<EmptyState title="Nothing yet" className="small" />, <div className="empty small"><strong>Nothing yet</strong></div>)
    same(<EmptyState className="small">Fewer than two workouts.</EmptyState>, <div className="empty small">Fewer than two workouts.</div>)
  })

  // The redesign's additions; none of them touches the markup above.
  it('leads with line art in place of the icon', () => {
    same(<EmptyState art={<svg className="lineart" />} title="No weigh-ins yet">Log one to start the trend.</EmptyState>,
      <div className="empty empty-x"><div className="ico empty-art"><svg className="lineart" /></div>
        <strong>No weigh-ins yet</strong><div>Log one to start the trend.</div></div>)
  })

  it('ends with a filled pill and a plain one, side by side', () => {
    const log = vi.fn(), goal = vi.fn()
    same(<EmptyState title="No weigh-ins yet" action={{ label: 'Log weight', icon: 'plus', onClick: log }} secondary={{ label: 'Set a goal', onClick: goal }} />,
      <div className="empty empty-x"><strong>No weigh-ins yet</strong><div className="empty-acts">
        <Button variant="primary" shape="pill" icon="plus" onClick={log}>Log weight</Button>
        <Button shape="pill" onClick={goal}>Set a goal</Button>
      </div></div>)
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(<EmptyState title="x" action={{ label: 'Log weight', onClick: log }} secondary={{ label: 'Set a goal', onClick: goal }} />))
    act(() => host.querySelectorAll('button')[0].click())
    act(() => host.querySelectorAll('button')[1].click())
    expect([log.mock.calls.length, goal.mock.calls.length]).toEqual([1, 1])
    act(() => root.unmount())
  })
})

describe('InlineNote and Skeleton', () => {
  it('InlineNote is one centred line with its icon', () => {
    same(<InlineNote icon="cloudSlash" role="status">Online results come back when you reconnect</InlineNote>,
      <p className="inote" role="status"><Icon name="cloudSlash" /><span>Online results come back when you reconnect</span></p>)
  })

  it('Skeleton is a hidden block at the size it stands in for, numbers in px', () => {
    expect(html(<Skeleton w={48} h={48} r={8} />)).toBe('<span class="skel" aria-hidden="true" style="--skel-w:48px;--skel-h:48px;--skel-r:8px"></span>')
    expect(html(<Skeleton w="58%" />)).toBe('<span class="skel" aria-hidden="true" style="--skel-w:58%;--skel-h:12px;--skel-r:4px"></span>')
  })
})

describe('SectionTitle', () => {
  it('is h4.sec (sheets.jsx recent weigh-ins)', () => {
    same(<SectionTitle>Recent weigh-ins</SectionTitle>, <h4 className="sec">Recent weigh-ins</h4>)
  })

  it('takes another element and a class', () => {
    same(<SectionTitle as="h3" className="mb-0">Today</SectionTitle>, <h3 className="sec mb-0">Today</h3>)
  })
})

describe('Tag', () => {
  it('is .tag', () => {
    same(<Tag>already in</Tag>, <span className="tag">already in</span>)
  })

  it('takes a tone and an icon (sheets.jsx cardio tag)', () => {
    same(<Tag tone="acc" icon="figureRun">Cardio</Tag>, <span className="tag acc"><Icon name="figureRun" />Cardio</span>)
    same(<Tag tone="dim">chest</Tag>, <span className="tag dim">chest</span>)
  })

  it('keeps its case with nocap (sheets.jsx first time)', () => {
    same(<Tag nocap className="sidepill">First time</Tag>, <span className="tag nocap sidepill">First time</span>)
  })

  it('throws in development on a tone it has no class for', () => {
    expect(() => html(<Tag tone="danger">x</Tag>)).toThrow(/Tag: tone="danger"/)
  })
})

describe('Chip and ChipRow', () => {
  it('is .chips>.chip (Library.jsx body parts), a button that never submits', () => {
    same(<ChipRow><Chip nocap on onClick={go}>All</Chip><Chip onClick={go}>chest</Chip></ChipRow>,
      <div className="chips"><button type="button" className={'chip nocap' + ' on'} onClick={go}>All</button>
        <button type="button" className="chip" onClick={go}>chest</button></div>)
  })

  it('passes a class and other props through', () => {
    same(<ChipRow className="wchips" role="tablist"><Chip className="cur" aria-expanded="true">1</Chip></ChipRow>,
      <div className="chips wchips" role="tablist"><button type="button" className="chip cur" aria-expanded="true">1</button></div>)
  })

  it('hands its ref to the strip', () => {
    const ref = { current: null }
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(<ChipRow ref={ref}><Chip>a</Chip></ChipRow>))
    expect(ref.current).toBe(host.firstChild)
    expect(ref.current.className).toBe('chips')
    act(() => root.unmount())
  })
})
