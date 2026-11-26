import { fold, pageTrail, searchSettings } from '../views/settings-pages.js'
import { GUIDES } from '../content/learn.js'
import { NAVIGATION_COPY, STEPS } from './tour.js'
import { t } from './i18n.js'

// These stops have an unconditional, reachable destination and need no practice session.
const navigation = STEPS.filter(step => step.go && !step.when && NAVIGATION_COPY[step.id])
const filler = new Set('a an the to is are i my can how where do does change long lasts find me on in of for'.split(' '))
export function helpMatches(question, ctx, tr = t) {
  const words = [...new Set((fold(question).match(/[\p{L}\p{N}]+/gu) || []).filter(w => !filler.has(w)))].slice(0, 12)
  if (!words.length) return []
  const tokens = words.join(' ')
  const hits = []
  function add(title, steps, route, keywords, state) {
    const name = fold(title)
    const text = fold([title, ...steps, keywords].join(' '))
    const count = words.filter(w => text.includes(w)).length
    if (count) hits.push({ title, steps, route, state, score: count * 10 + (name === tokens ? 8 : 0) + words.filter(w => name.includes(w)).length })
  }
  const seen = new Set()
  for (const word of words) {
    for (const item of searchSettings(word, ctx, tr)) {
      const key = item.page + ':' + item.title
      if (seen.has(key)) continue
      seen.add(key)
      const route = item.route || (item.page === 'coach' ? '/coach/setup' : '/settings/' + item.page)
      add(item.label, [item.isPage ? tr('Settings') : pageTrail(item.page, tr), item.label], route, item.kw,
        item.isPage ? undefined : { find: item.title, via: item.via })
    }
  }
  for (const g of GUIDES) add(tr(g.title), [tr('Learn'), tr(g.summary)], '/learn?g=' + g.id, g.title)
  for (const step of navigation) {
    const [title, instruction] = NAVIGATION_COPY[step.id]()
    add(title, [instruction], step.go, step.go.slice(1))
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 3)
}
