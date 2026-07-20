import { create } from 'zustand'
import { uid } from '../lib/format.js'
import { beep, vibrate } from '../lib/sound.js'
import { useStore } from './useStore.js'

let toastTm = null
let timerInt = null

export const useUI = create((set, get) => ({
  sheets: [],          // { id, render:(close)=>JSX, kind:'sheet'|'center', locked }
  toastMsg: '',
  timer: null,         // { left, total }

  openSheet(render, { kind = 'sheet', locked = false } = {}) {
    const id = uid()
    set(s => ({ sheets: [...s.sheets, { id, render, kind, locked }] }))
    const close = () => get().closeSheet(id)
    return { id, close, lock: v => set(s => ({ sheets: s.sheets.map(x => x.id === id ? { ...x, locked: v } : x) })) }
  },
  closeSheet(id) { set(s => ({ sheets: s.sheets.filter(x => x.id !== id) })) },
  closeAll() { set({ sheets: [] }) },

  toast(msg) {
    set({ toastMsg: msg })
    clearTimeout(toastTm)
    toastTm = setTimeout(() => set({ toastMsg: '' }), 2200)
  },

  startRest(sec) {
    get().stopRest()
    set({ timer: { left: sec, total: sec } })
    timerInt = setInterval(() => {
      const t = get().timer
      if (!t) return
      const left = t.left - 1
      const snd = useStore.getState().S.sound
      if (left <= 0) {
        beep(snd, 880, 0.15); beep(snd, 880, 0.15, 0.25); beep(snd, 1320, 0.4, 0.5)
        vibrate([200, 100, 200]); get().toast('Rest over — next set! 💪'); get().stopRest(); return
      }
      if (left <= 3) beep(snd, 660, 0.1)
      set({ timer: { ...t, left } })
    }, 1000)
  },
  addRest(sec) { const t = get().timer; if (t) set({ timer: { left: t.left + sec, total: t.total + sec } }) },
  stopRest() { if (timerInt) clearInterval(timerInt); timerInt = null; set({ timer: null }) }
}))
