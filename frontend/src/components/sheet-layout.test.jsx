// @vitest-environment happy-dom
// G5, markup equivalence: the sheet header and footer render exactly what the sheets build by
// hand today (sheets.jsx BwSheet), with each static inline style swapped for the ui-kit.css class
// of the same px (marginBottom: 14 → mb-7, height: 8 → sp-4) and nothing else changed.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { SheetHeader, SheetActions } from './sheet-layout.jsx'

const html = el => renderToStaticMarkup(el)
const same = (primitive, legacy) => expect(html(primitive)).toBe(html(legacy))
const close = () => {}

describe('SheetHeader', () => {
  it('is the bare h3', () => {
    same(<SheetHeader title="Log body weight" />, <h3>Log body weight</h3>)
  })

  it('puts the muted line under it (the weigh-in history)', () => {
    same(<SheetHeader title="Weigh-ins" sub="12 weigh-ins" />,
      <><h3 className="mb-1">Weigh-ins</h3><div className="muted small mb-5">12 weigh-ins</div></>)
  })

  it('shares a row with the close button (the check-in weigh-in)', () => {
    same(<SheetHeader title="Quick check-in" onClose={close} />,
      <div className="row between mb-7">
        <h3 className="m-0">Quick check-in</h3>
        <button className="iconbtn" aria-label={t('Cancel')} onClick={close}><Icon name="xmark" /></button>
      </div>)
  })

  it('shares a row with an action', () => {
    same(<SheetHeader title="Meals" action={<button className="btn tinted sm">Edit</button>} />,
      <div className="row between mb-7"><h3 className="m-0">Meals</h3><button className="btn tinted sm">Edit</button></div>)
  })

  it('groups the action and the close button, with the muted line under the row', () => {
    same(<SheetHeader title="Meals" sub="Today" onClose={close} action={<button className="btn tinted sm">Edit</button>} />,
      <><div className="row between mb-1"><h3 className="m-0">Meals</h3>
        <div className="row g-4"><button className="btn tinted sm">Edit</button>
          <button className="iconbtn" aria-label={t('Cancel')} onClick={close}><Icon name="xmark" /></button></div></div>
        <div className="muted small mb-5">Today</div></>)
  })
})

describe('SheetActions', () => {
  it('is the 14px spacer and the button', () => {
    same(<SheetActions><Button variant="primary">Save</Button></SheetActions>,
      <><div className="sp-7" /><Button variant="primary">Save</Button></>)
  })

  it('puts the gap between buttons and skips the ones not shown', () => {
    const required = false
    same(<SheetActions>
      <Button variant="primary">Save</Button>
      {required && <Button>Hidden</Button>}
      <Button variant="ghost" className="dim">Start without weighing in</Button>
    </SheetActions>,
    <><div className="sp-7" /><Button variant="primary">Save</Button>
      <div className="sp-4" /><Button variant="ghost" className="dim">Start without weighing in</Button></>)
  })

  it('takes another gap step', () => {
    same(<SheetActions gap={1}><Button>A</Button><Button>B</Button></SheetActions>,
      <><div className="sp-7" /><Button>A</Button><div className="sp-1" /><Button>B</Button></>)
  })

  it('throws in development on a gap off the scale', () => {
    expect(() => html(<SheetActions gap={20}><Button>A</Button></SheetActions>)).toThrow(/SheetActions: gap=20/)
  })
})
