// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

const sheets = vi.hoisted(() => ({
  confirmSheet: vi.fn(), exerciseDetailSheet: vi.fn(), customExSheet: vi.fn(), startBuiltSession: vi.fn(), startFlow: vi.fn(), planImportSheet: vi.fn()
}))
vi.mock('../sheets.jsx', () => sheets)
const { useStore } = await import('../store/useStore.js')
const { useUI } = await import('../store/useUI.js')
const { ActionCards, Sources, runAction } = await import('./CoachActions.jsx')
const { CoachSeesSection } = await import('./CoachSees.jsx')

let host, root
beforeEach(() => {
  Object.values(sheets).forEach(f => f.mockReset())
  useStore.setState(s => ({ S: { ...s.S, active: null, routines: [{ id: 'r1', name: 'Legs', ex: [] }], coach: { profile: { notes: 'likes squats' }, share: {} } } }))
  useUI.setState({ toast: vi.fn() })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('what the Coach offers to do', () => {
  it('a one-off workout is previewed and only started on yes', async () => {
    runAction({ type: 'workout', name: 'Quick one', items: [{ id: '0662', sets: 2, reps: 15 }, { id: '0463', sets: 3, sec: 40 }] })
    expect(sheets.startBuiltSession).not.toHaveBeenCalled()
    const opts = sheets.confirmSheet.mock.calls[0][0]
    expect(opts.title).toContain('Quick one')
    expect(opts.message.split('\n')).toHaveLength(2)
    opts.onConfirm()
    expect(sheets.startBuiltSession.mock.calls[0][0]).toEqual([
      { id: '0662', sets: 2, mode: 'reps', reps: 15, weight: 0 }, { id: '0463', sets: 3, mode: 'time', sec: 40, weight: 0 }
    ])
    expect(sheets.startBuiltSession.mock.calls[0][1]).toBe('Quick one')
  })

  it('a note is added to the profile notes after the confirm, never before', () => {
    runAction({ type: 'note', text: 'Left knee is sensitive.' })
    expect(useStore.getState().S.coach.profile.notes).toBe('likes squats')
    sheets.confirmSheet.mock.calls[0][0].onConfirm()
    expect(useStore.getState().S.coach.profile.notes).toBe('likes squats\nLeft knee is sensitive.')
  })

  it('start, own exercise and exercise card open the app’s own screens', () => {
    runAction({ type: 'start', routineId: 'r1' })
    sheets.confirmSheet.mock.calls[0][0].onConfirm()
    expect(sheets.startFlow).toHaveBeenCalledWith(['r1'])
    runAction({ type: 'exercise', name: 'Towel row', bp: 'back', mode: 'reps' })
    expect(sheets.customExSheet.mock.calls[0][2]).toBe('Towel row')
    runAction({ type: 'show', exId: '0043' })
    expect(sheets.exerciseDetailSheet).toHaveBeenCalled()
  })

  it('cards render with titles, and sources as links, http(s) only', async () => {
    await act(async () => { root.render(<><ActionCards actions={[{ type: 'start', routineId: 'r1' }, { type: 'bogus' }]} /><Sources list={[{ url: 'https://e.org/a', title: 'A study' }, { url: 'javascript:alert(1)' }]} /></>) })
    expect(host.querySelectorAll('.coach-act')).toHaveLength(1)
    expect(host.textContent).toContain('Legs')
    const links = [...host.querySelectorAll('.coach-src a')]
    expect(links.map(a => a.getAttribute('href'))).toEqual(['https://e.org/a'])
    expect(links[0].getAttribute('rel')).toContain('noopener')
  })
})

describe('what the Coach sees', () => {
  it('health starts off, a switch writes S.coach.share, web needs the admin', async () => {
    useStore.setState({ config: { coach: { web: false } } })
    await act(async () => { root.render(<CoachSeesSection />) })
    const sw = [...host.querySelectorAll('[role="switch"]')]
    expect(sw.map(s => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'false', 'false'])
    expect(sw[3].disabled).toBe(true)
    await act(async () => { sw[2].click() })
    expect(useStore.getState().S.coach.share.health).toBe(true)
  })
})
