// @vitest-environment happy-dom
// A routine tile inside a menu sheet must show its colour: the menu's grey tile rule is more
// specific than the tile rules, so a tinted tile needs its own override (index.css, .menu-list).
import { it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/index.css', 'utf8') // vitest runs from frontend/
const tile = '<span class="lrow-i" style="--tint:#40c8e0;--on-tint:#123456"></span>'
const look = (html) => {
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st)
  const host = document.createElement('div'); host.innerHTML = html; document.body.appendChild(host)
  const cs = getComputedStyle(host.querySelector('.lrow-i'))
  const out = [cs.background || cs.backgroundColor, cs.color]
  host.remove(); st.remove()
  return out
}

it('a tinted tile gets the same colours in a menu list as in a plain list', () => {
  const menu = look(`<div class="menu-list"><div class="menu-item">${tile}</div></div>`)
  expect(menu).toEqual(['#40c8e0', '#123456'])
  expect(menu).toEqual(look(`<div class="list"><div class="item">${tile}</div></div>`))
})

it('an untinted tile in a menu list stays grey', () => {
  expect(look('<div class="menu-list"><div class="menu-item"><span class="lrow-i"></span></div></div>')).toEqual(['#2c2c2e', '#ffffff'])
})
