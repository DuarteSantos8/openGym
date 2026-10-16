// Where a search result goes (fitness-eval ux-search.md §4): search finds things, and every result
// opens the place where you act on it. A sheet opens over the overlay (back closes it, back on the
// overlay); a route opens on top of it as a search visit (lib/search/session.js), and back
// returns to the overlay. Pure in what it decides (`targetOf`), so the table is testable.
import { t } from '../../lib/i18n.js'
import { useUI } from '../../store/useUI.js'
import { useNutrition } from '../../lib/nutrition/store.js'
import { visit } from '../../lib/search/session.js'
import { addRecent, noteOpened } from '../../lib/search/recents.js'
import { exerciseDetailSheet, workoutDetailSheet } from '../../sheets.jsx'
import { foodDetailSheet } from '../FoodDetailSheet.jsx'
import { foodEditSheet } from '../FoodEditSheet.jsx'
import { mealDetailSheet } from '../MealDetailSheet.jsx'
import { manageMeasurementsSheet } from '../../views/Measurements.jsx'

/** What a result opens: { kind: 'route', path, state?, date? } | { kind: 'sheet', open() }. */
export function targetOf(r) {
  const settings = () => useNutrition.getState().settings.data
  switch (r.type) {
    case 'page':
      return r.off ? { kind: 'route', path: '/me/' + r.off.page, state: { find: r.off.find } } : { kind: 'route', path: r.path }
    case 'setting': {
      const e = r.entry
      if (e.isPage && e.sheet) return { kind: 'sheet', open: manageMeasurementsSheet }
      if (e.isPage) return { kind: 'route', path: e.to || '/me/' + e.page }
      return { kind: 'route', path: e.page ? '/me/' + e.page : '/me', state: e.via ? { find: e.title, via: e.via } : { find: e.title } }
    }
    case 'exercise': return { kind: 'sheet', open: () => exerciseDetailSheet(r.ex) }
    case 'routine': return { kind: 'route', path: '/train/routines/' + encodeURIComponent(r.id) }
    case 'workout': return { kind: 'sheet', open: () => workoutDetailSheet(r.workout) }
    case 'food': return { kind: 'sheet', open: () => foodDetailSheet({ food: r.food, settings: settings(), onEdit: f => foodEditSheet({ food: f, settings: settings() }) }) }
    case 'meal':
    case 'recipe': return { kind: 'sheet', open: () => mealDetailSheet({ id: r.id, recipe: r.type === 'recipe' }) }
    case 'online': return {
      kind: 'sheet',
      open: () => foodDetailSheet({
        food: r.food, settings: settings(),
        onSave: async f => { await useNutrition.getState().saveFood(f); useUI.getState().toast(t('Saved to your foods')) },
      }),
    }
    case 'day': return { kind: 'route', path: '/food?date=' + r.date + (r.uuid ? '&find=' + encodeURIComponent(r.uuid) : ''), date: r.date }
    default: return { kind: 'none' }
  }
}

/** Opens a result, and remembers it (Recent, how often it is opened). `query` is what was typed. */
export function openResult(r, { query = '' } = {}) {
  const target = targetOf(r)
  if (target.kind === 'none') return
  if (r.type !== 'online') addRecent({ kind: 'result', type: r.type, id: r.id, label: r.title, query })
  noteOpened(r.key)
  if (target.kind === 'sheet') { target.open(); return }
  visit(target.path, { date: target.date, state: target.state })
}
