// The app's own text in the language's digits while it has them (Bengali: ০১২৩). Formatted numbers
// and dates already come out that way through Intl (i18n-core.js nativeDigits), but most numbers
// reach the screen without a formatter: timers, set rows, chart labels, counters. Rather than
// chasing every call site, this rewrites the text nodes as they render. React writes a text node
// from its props and never reads it back, so a rewritten node stays until the next render, which
// the observer sees and rewrites again. MutationObserver callbacks run before paint: no flicker.
//
// Display only. Inputs, code and anything marked translate="no" keep what they show, and stopping
// puts back the ASCII text of every node still showing what this wrote.

import { localDigits } from './i18n-core.js'

const SKIP = new Set(['INPUT', 'TEXTAREA', 'SCRIPT', 'STYLE', 'CODE', 'PRE', 'KBD', 'SAMP'])

function skipped(el) {
  for (let e = el; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.isContentEditable || e.getAttribute('translate') === 'no') return true
  }
  return false
}

export function watchDigits(root, digits) {
  const original = new WeakMap()
  const textNodes = node => {
    const out = []
    const walker = node.ownerDocument.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n)
    return out
  }
  const fixText = node => {
    const v = node.nodeValue
    if (!/[0-9]/.test(v) || skipped(node.parentElement)) return
    const out = localDigits(v, digits)
    if (out === v) return
    original.set(node, v)
    node.nodeValue = out
  }
  const fix = node => {
    if (node.nodeType === 3) fixText(node)
    else if (node.nodeType === 1) textNodes(node).forEach(fixText)
  }
  fix(root)
  const observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') fix(r.target)
      else r.addedNodes.forEach(fix)
    }
  })
  observer.observe(root, { subtree: true, childList: true, characterData: true })
  return () => {
    observer.disconnect()
    for (const n of textNodes(root)) {
      const v = original.get(n)
      if (v !== undefined && n.nodeValue === localDigits(v, digits)) n.nodeValue = v
    }
  }
}
