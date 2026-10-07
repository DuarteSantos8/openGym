export const WATCH_TIMER_FONTS = [
  { value: 'segments', label: 'Digital (segments)' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'mono', label: 'Monospaced' },
]

export const WATCH_TIMER_COLORS = [
  { value: '#a3e635', label: 'Lime' },
  { value: '#ffffff', label: 'White' },
  { value: '#22c55e', label: 'Green' },
  { value: '#38bdf8', label: 'Blue' },
  { value: '#fb923c', label: 'Orange' },
  { value: '#facc15', label: 'Yellow' },
  { value: '#f472b6', label: 'Pink' },
  { value: '#c084fc', label: 'Purple' },
]

export function watchDisplayOf(S) {
  const display = S?.watchDisplay || {}
  return {
    timerFont: WATCH_TIMER_FONTS.some(f => f.value === display.timerFont) ? display.timerFont : 'segments',
    timerColor: WATCH_TIMER_COLORS.some(c => c.value === display.timerColor) ? display.timerColor : '#a3e635',
  }
}

// Clockwise: top, upper right, lower right, bottom, lower left, upper left, middle.
export const DIGIT_SEGMENTS = ['012345', '12', '01463', '01263', '1256', '02563', '025634', '012', '0123456', '012356']
export const SEGMENT_POINTS = [
  '12,0 88,0 78,10 22,10', '90,2 100,12 100,43 90,49 80,43 80,12',
  '90,51 100,57 100,88 90,98 80,88 80,57', '12,100 88,100 78,90 22,90',
  '10,51 20,57 20,88 10,98 0,88 0,57', '10,2 20,12 20,43 10,49 0,43 0,12',
  '12,50 22,44 78,44 88,50 78,56 22,56',
]
