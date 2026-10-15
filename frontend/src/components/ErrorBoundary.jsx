import { Component } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { BRAND } from '../brand.js'
import { Button } from './ui.jsx'
import { Spacer } from './layout.jsx'
import { EmptyState } from './blocks.jsx'

/**
 * Last line of defence: one bad render used to blank the whole app, with no way back —
 * a workout referencing an exercise the build doesn't know would white-screen and, since
 * the running workout is persisted, do it again on every reload.
 *
 * Sits inside #app so the tab bar stays usable; the shell keys this subtree on the route,
 * so switching tabs re-mounts it and clears the error by itself.
 */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err) { console.error(`${BRAND.name} render error:`, err) }

  render() {
    if (!this.state.failed) return this.props.children
    const active = useStore.getState().S.active
    return (
      <div>
        <EmptyState icon="info" className="gate-empty">
          <div className="fw-semibold mb-3">{t('Something went wrong')}</div>
          {t('This screen could not be drawn. Your data is safe on this device.')}
        </EmptyState>
        <Button variant="primary" icon="reset" onClick={() => location.reload()}>{t('Reload openGym')}</Button>
        {active && <>
          <Spacer size={4} />
          <Button variant="danger" icon="trash" onClick={() => {
            useStore.getState().update(s => { s.active = null })
            location.reload()
          }}>{t('Discard the running workout')}</Button>
        </>}
      </div>
    )
  }
}
