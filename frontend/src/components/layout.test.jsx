// @vitest-environment happy-dom
// G5, markup equivalence: each layout primitive renders exactly the markup a page writes by hand
// today. The legacy side is today's markup with its static inline style swapped for the
// ui-kit.css class of the same px (height: 8 → sp-4, gap: 6 → g-3), and nothing else changed.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import RootHeader from './RootHeader.jsx'
import SubHeader from './SubHeader.jsx'
import { Page, Stack, Spacer, Inline } from './layout.jsx'

const html = el => renderToStaticMarkup(el)
const same = (primitive, legacy) => expect(html(primitive)).toBe(html(legacy))
const back = () => {}

describe('Page', () => {
  it('is SubHeader then the content, with no wrapper', () => {
    same(<Page title="Weigh-ins"><div className="card">x</div></Page>,
      <><SubHeader title="Weigh-ins" /><div className="card">x</div></>)
  })

  it('passes sub, action and onBack to SubHeader', () => {
    same(<Page title="Coach" sub="Intake" action={<button className="iconbtn">+</button>} onBack={back}>x</Page>,
      <><SubHeader title="Coach" sub="Intake" action={<button className="iconbtn">+</button>} onBack={back} />x</>)
  })

  it('is RootHeader on a tab root', () => {
    // The avatar navigates, so both sides render inside a router.
    same(<MemoryRouter><Page root title="Nutrition" sub="Today"><div className="card">x</div></Page></MemoryRouter>,
      <MemoryRouter><RootHeader title="Nutrition" sub="Today" /><div className="card">x</div></MemoryRouter>)
  })

  it('throws in development when a root page is given an action or onBack it cannot show', () => {
    expect(() => html(<MemoryRouter><Page root title="Food" action={<button>+</button>} /></MemoryRouter>)).toThrow(/root page/)
    expect(() => html(<MemoryRouter><Page root title="Food" onBack={back} /></MemoryRouter>)).toThrow(/root page/)
  })
})

describe('Stack', () => {
  it('is div.stack', () => {
    same(<Stack><p>a</p></Stack>, <div className="stack"><p>a</p></div>)
  })

  it('takes a gap step, an element and a class', () => {
    same(<Stack gap={6} as="section" className="meals"><p>a</p><p>b</p></Stack>,
      <section className="stack g-6 meals"><p>a</p><p>b</p></section>)
  })

  it('takes a gap of 0 and the 5px half step', () => {
    same(<Stack gap={0}>a</Stack>, <div className="stack g-0">a</div>)
    same(<Stack gap={2.5}>a</Stack>, <div className="stack g-2.5">a</div>)
  })

  it('throws in development on a gap off the scale', () => {
    expect(() => html(<Stack gap={11}>a</Stack>)).toThrow(/Stack: gap=11/)
  })
})

describe('Spacer', () => {
  it('is the 8px spacer div by default', () => {
    same(<Spacer />, <div className="sp-4" />)
  })

  it('takes a size step', () => {
    same(<Spacer size={7} />, <div className="sp-7" />)
    same(<Spacer size={2.5} />, <div className="sp-2.5" />)
  })

  it('throws in development on a size off the scale', () => {
    expect(() => html(<Spacer size={0} />)).toThrow(/Spacer: size=0/)
    expect(() => html(<Spacer size={12} />)).toThrow(/Spacer: size=12/)
  })
})

describe('Inline', () => {
  it('is .row', () => {
    same(<Inline><span>a</span></Inline>, <div className="row"><span>a</span></div>)
  })

  it('is .row.between', () => {
    same(<Inline justify="between"><h2>a</h2><button>b</button></Inline>,
      <div className="row between"><h2>a</h2><button>b</button></div>)
  })

  it('ends flush right', () => {
    same(<Inline justify="end">a</Inline>, <div className="row jc-end">a</div>)
  })

  it('takes a gap, wrap, an alignment, an element and a class', () => {
    same(<Inline gap={4} wrap align="baseline" as="span" className="small">a</Inline>,
      <span className="row g-4 wrap ai-baseline small">a</span>)
  })

  it('takes a gap of 0', () => {
    same(<Inline gap={0}>a</Inline>, <div className="row g-0">a</div>)
  })

  it('throws in development on a gap, justify or align it has no class for', () => {
    expect(() => html(<Inline gap={13}>a</Inline>)).toThrow(/Inline: gap=13/)
    expect(() => html(<Inline justify="around">a</Inline>)).toThrow(/Inline: justify="around"/)
    expect(() => html(<Inline align="center">a</Inline>)).toThrow(/Inline: align="center"/)
  })

  it('passes other props through', () => {
    same(<Inline role="group" aria-label="Range">a</Inline>,
      <div className="row" role="group" aria-label="Range">a</div>)
  })
})
