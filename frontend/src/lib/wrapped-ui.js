// Which full-screen story (components/Wrapped.jsx) is open, if any: Your year (`year`), opened from
// the Home card, Stats, the December notification or #/stats?wrapped=2026, or Your month (`month`,
// 'YYYY-MM', v1.4.5: Stats, the month's recap sheet or #/stats?month=2026-10). Not persisted.
import { create } from 'zustand'

const YM = /^\d{4}-\d{2}$/
export const useWrappedUI = create(set => ({
  year: null,
  month: null,
  open: year => set({ year: Number.isInteger(year) ? year : null, month: null }),
  openMonth: ym => set({ month: YM.test(String(ym)) ? ym : null, year: null }),
  close: () => set({ year: null, month: null }),
}))
export const openWrapped = year => useWrappedUI.getState().open(year)
export const openMonthStory = ym => useWrappedUI.getState().openMonth(ym)
export const closeWrapped = () => useWrappedUI.getState().close()
