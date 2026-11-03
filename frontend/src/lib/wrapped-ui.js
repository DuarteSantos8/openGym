// Which year the full-screen Your year stories (components/Wrapped.jsx) show, if any. Opened from
// the Home card, Stats, the December notification or #/stats?wrapped=2026; not persisted.
import { create } from 'zustand'

export const useWrappedUI = create(set => ({
  year: null,
  open: year => set({ year: Number.isInteger(year) ? year : null }),
  close: () => set({ year: null }),
}))
export const openWrapped = year => useWrappedUI.getState().open(year)
export const closeWrapped = () => useWrappedUI.getState().close()
