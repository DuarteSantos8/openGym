// Tests: a saved workout's once-in-a-while actions (date & time, duration, save as routine,
// sharing, export, Delete) sit behind the detail sheet's "Workout options" row since v1.4.4.
// Opens that menu the way a tap does and returns its row with this label, ready to click.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'

export function workoutOption(host, label) {
  const row = host.querySelector('[data-tour="wd-options"]')
  if (!row) throw new Error('no Workout options row')
  act(() => row.click())
  const sheet = useUI.getState().sheets.at(-1)
  const menu = document.createElement('div')
  document.body.appendChild(menu)
  act(() => createRoot(menu).render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return [...menu.querySelectorAll('.menu-item')].find(el => el.querySelector('.tt')?.textContent === label)
}
