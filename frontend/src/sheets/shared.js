import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'

export const S = () => useStore.getState().S
export const update = (...a) => useStore.getState().update(...a)
export const ui = () => useUI.getState()
export const toast = m => ui().toast(m)
export const snd = () => S().sound
