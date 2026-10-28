// Picking a day in a DateField the way a person does: tap the field, tap the month title, step to
// the year, tap the month, tap the day. Tests mount sheets by hand (sheet.render(close)), so the
// picker sheet the tap opens is mounted here the same way and torn down afterwards.
//
//   pickDate(host.querySelector('[data-datefield]'), '2026-08-18') // true when the day could be picked
//   dateValue(host)                                                 // the ISO value shown
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'

export const dateFields = host => [...host.querySelectorAll('[data-datefield]')]
export const dateValue = (host, i = 0) => dateFields(host)[i]?.value ?? null

export function pickDate(field, iso) {
  if (!field) throw new Error('pickDate: no date field')
  act(() => { field.click() })
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const close = () => useUI.getState().closeSheet(sheet.id)
  act(() => root.render(sheet.render(close)))
  const q = sel => host.querySelector(sel)
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7) - 1
  act(() => { q('[data-datep-title]').click() })
  for (let guard = 0; guard < 200; guard++) {
    const at = +q('[data-year]').dataset.year
    if (at === y) break
    const btn = host.querySelectorAll('.datep-head .iconbtn')[at > y ? 0 : 1]
    if (btn.disabled) break
    act(() => { btn.click() })
  }
  const month = q('[data-year="' + y + '"] [data-month="' + m + '"]')
  let ok = false
  if (month && !month.disabled) {
    act(() => { month.click() })
    const day = q('[data-iso="' + iso + '"]')
    if (day && !day.disabled) { act(() => { day.click() }); ok = true }
  }
  if (useUI.getState().sheets.some(s => s.id === sheet.id)) act(() => { close() })
  act(() => root.unmount())
  host.remove()
  return ok
}
