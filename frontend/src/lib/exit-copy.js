// A node that leaves the page at once (state is never held back) can still fade out as an inert copy.
// The copy sits in a fixed layer at the end of <body> that wears the old parent's class, so the parent's
// styles still reach it; the layer fades and goes. Reduce Motion (html class or the phone): no copy.
import { still } from './flip.js'

export function exitCopy(node, ms = 100) {
  const home = node?.parentNode
  if (!node?.isConnected || !home?.isConnected || still() || !document.body.animate) return
  const r = node.getBoundingClientRect(), h = home.getBoundingClientRect()
  const g = node.cloneNode(true)
  g.removeAttribute('id'); g.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'))
  const layer = document.createElement('div')
  layer.className = home.className
  layer.setAttribute('aria-hidden', 'true'); layer.inert = true
  // The layer's own top margin is the copy's: top is the old border box minus it.
  Object.assign(layer.style, { position: 'fixed', margin: '0', padding: '0 ' + getComputedStyle(home).paddingInlineEnd + ' 0 ' + getComputedStyle(home).paddingInlineStart,
    left: h.left + 'px', top: r.top - (parseFloat(getComputedStyle(node).marginTop) || 0) + 'px', width: h.width + 'px', minHeight: '0', zIndex: '2', pointerEvents: 'none' })
  layer.appendChild(g)
  document.body.appendChild(layer)
  const a = layer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' })
  a.onfinish = a.oncancel = () => layer.remove()
}
