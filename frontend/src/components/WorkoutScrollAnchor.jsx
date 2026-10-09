import { Component, createRef } from 'react'

// A layout-effect cleanup is too late to measure the old DOM. React's snapshot lifecycle
// brackets the collapse itself, including changes made while the Layout sheet locks the body.
export default class WorkoutScrollAnchor extends Component {
  root = createRef()
  leadingSpace = null

  getSnapshotBeforeUpdate(prev) {
    if (prev.collapsed === this.props.collapsed) return null
    const root = this.root.current
    const top = Math.max(0, root.querySelector('.whdr')?.getBoundingClientRect().bottom || 0)
    const collapsing = new Set(this.props.collapsed.split(',').filter(k => !prev.collapsed.split(',').includes(k)))
    const visible = [...root.querySelectorAll('.wl-unit')].filter(el => {
      const rect = el.getBoundingClientRect()
      return rect.bottom > top && rect.top < window.innerHeight
    })
    // If the content at the top is itself disappearing, hold the next surviving tile in
    // place instead. A summary already collapsed is a perfectly good anchor too.
    const anchor = visible.find(el => !collapsing.has(el.dataset.unitKey)) || visible[0]
    return anchor ? { anchor, top: anchor.getBoundingClientRect().top } : null
  }

  componentDidUpdate(prev, state, snapshot) {
    if (!snapshot) return
    const root = this.root.current
    if (this.leadingSpace) this.leadingSpace.style.marginTop = ''
    this.leadingSpace = null
    if (!snapshot.anchor.isConnected) { root.style.paddingBottom = ''; return }
    const body = document.body
    const locked = body.style.position === 'fixed'
    const delta = snapshot.anchor.getBoundingClientRect().top - snapshot.top
    const y = locked ? -(parseFloat(body.style.top) || 0) : window.scrollY
    const target = Math.max(0, y + delta)
    // At the page start we cannot scroll to a negative offset. Keep the minimum gap
    // before the surviving tile instead; a later expansion reclaims it.
    if (y + delta < 0) {
      snapshot.anchor.style.marginTop = `${-(y + delta)}px`
      this.leadingSpace = snapshot.anchor
    }
    // Collapsing near the page end can clamp scrollY before we restore it. Keep only the
    // trailing space needed to hold this viewport; a later expansion can reclaim it.
    const oldSpace = parseFloat(root.style.paddingBottom) || 0
    const height = Math.max(body.scrollHeight, document.documentElement.scrollHeight) - oldSpace
    const space = Math.max(0, target + window.innerHeight - height)
    root.style.paddingBottom = space ? `${space}px` : ''
    if (locked) body.style.top = `${-target}px`
    else if (delta || oldSpace !== space) {
      // Cancel a sheet's delayed keyboard correction before it can undo this newer anchor.
      window.dispatchEvent(new Event('workout-scroll-anchor'))
      window.scrollTo({ top: target, left: window.scrollX, behavior: 'instant' })
    }
  }

  render() {
    return <div ref={this.root} className="narrow" style={{ overflowAnchor: this.props.enabled ? 'none' : undefined }}>{this.props.children}</div>
  }
}
