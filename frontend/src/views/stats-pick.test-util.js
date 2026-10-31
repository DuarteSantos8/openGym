// Test helper for Stats' picker rows and menu buttons (the chart of an exercise, the muscles'
// period): they open the shared picker sheet, which these tests render on their own and pick from.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { bindUI } from '../components/ui.jsx'
import { useUI } from '../store/useUI.js'

bindUI(useUI)

const opener = (scope, title) => [...scope.querySelectorAll('button')].find(b =>
  b.querySelector('.lrow-t')?.textContent === title || (b.getAttribute('aria-label') || '').startsWith(title + ':'))

function withSheet(scope, title, fn) {
  const btn = opener(scope, title)
  if (!btn) return fn(null)
  act(() => btn.click())
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(sheet.render(() => {})))
  try { return fn(host) } finally {
    act(() => root.unmount()); host.remove()
    useUI.setState({ sheets: [] })
  }
}

/** The option labels of the picker named `title` in `scope`, [] when there is no such picker. */
export const pickerOptions = (scope, title) => withSheet(scope, title, host =>
  host ? [...host.querySelectorAll('.sect-b button')].map(b => b.textContent.trim()) : [])

/** Opens the picker named `title` and picks the first option that starts with `label`. */
export const pickFrom = (scope, title, label) => withSheet(scope, title, host => {
  if (!host) throw new Error('no picker named ' + title)
  const opt = [...host.querySelectorAll('.sect-b button')].find(b => b.textContent.trim().startsWith(label))
  if (!opt) throw new Error('no option ' + label + ' in ' + title)
  act(() => opt.click())
})
