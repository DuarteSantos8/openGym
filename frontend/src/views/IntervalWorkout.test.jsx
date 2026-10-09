// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  state: null,
  update: vi.fn(),
  finishWorkout: vi.fn(),
  beep: vi.fn(),
  chime: vi.fn(),
}))

vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector({
    S: mocks.state,
    update: mocks.update,
  })

  useStore.getState = () => ({
    S: mocks.state,
    update: mocks.update,
  })

  return { useStore }
})

vi.mock('../sheets.jsx', () => ({
  finishWorkout: mocks.finishWorkout,
}))

vi.mock('../lib/sound.js', () => ({
  beep: mocks.beep,
  chime: mocks.chime,
}))

vi.mock('../lib/i18n.js', () => ({
  t: (key, ...args) => {
    if (!args.length) return key
    return key.replace(/\{(\d+)\}/g, (_, i) => args[Number(i)])
  },

  exerciseNameFor: id => ({
    burpees: 'Burpees',
    squats: 'Squats',
    pushups: 'Push-ups',
  }[id] || id),
}))

vi.mock('../components/Icon.jsx', () => ({
  default: () => null,
}))

vi.mock('../components/ui.jsx', () => ({
  Button: ({ children, onClick, ...props }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

import IntervalWorkout from './IntervalWorkout.jsx'

function routineState(overrides = {}) {
  return {
    sound: true,
    active: {
      id: 'active',
      name: 'HIIT',

      entries: [
        { id: 'burpees', sets: [] },
        { id: 'squats', sets: [] },
        { id: 'pushups', sets: [] },
      ],

      interval: {
        round: 0,
        exercise: 0,
        phase: 'work',
        rounds: 2,
        exerciseCount: 3,
        workSec: 30,
        restSec: 15,
        ...overrides,
      },
    },
  }
}

function render() {
  const container = document.createElement('div')
  document.body.appendChild(container)

  const root = createRoot(container)

  act(() => {
    root.render(<IntervalWorkout />)
  })

  return {
    container,
    root,
  }
}

function applyLastUpdate() {
  const updater = mocks.update.mock.calls.at(-1)?.[0]

  if (typeof updater !== 'function') {
    throw new Error('No s.update() updater found')
  }

  const next = structuredClone(mocks.state)
  updater(next)

  return next
}

describe('IntervalWorkout', () => {
  beforeEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    document.body.innerHTML = ''
    mocks.state = routineState()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('shows the first exercise in the work phase', () => {
    const { container, root } = render()

    expect(container.textContent).toContain('HIIT')
    expect(container.textContent).toContain('Round 1 of 2')
    expect(container.textContent).toContain('Work')
    expect(container.textContent).toContain('Burpees')
    expect(container.textContent).toContain('0:30')

    act(() => {
      root.unmount()
    })
  })

  it('pauses and resumes the interval timer', () => {
    const { container, root } = render()

    const pause = [...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Pause')

    expect(pause).toBeTruthy()

    act(() => {
      pause.click()
    })

    expect(container.textContent).toContain('Resume')

    const resume = [...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Resume')

    expect(resume).toBeTruthy()

    act(() => {
      resume.click()
    })

    expect(container.textContent).toContain('Pause')

    act(() => {
      root.unmount()
    })
  })

  it('skips from work to rest', () => {
    const { container, root } = render()

    const skip = [...container.querySelectorAll('button')]
      .find(button => button.textContent === 'Skip')

    expect(skip).toBeTruthy()

    act(() => {
      skip.click()
    })

    expect(mocks.update).toHaveBeenCalled()

    const next = applyLastUpdate()

    expect(next.active.interval.phase).toBe('rest')
    expect(next.active.interval.exercise).toBe(0)

    act(() => {
      root.unmount()
    })
  })

  it('automatically moves from work to rest when the timer expires', () => {
    vi.useFakeTimers()

    const { container, root } = render()

    expect(container.textContent).toContain('Work')
    expect(container.textContent).toContain('Burpees')

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(mocks.update).toHaveBeenCalled()

    const next = applyLastUpdate()

    expect(next.active.interval.phase).toBe('rest')
    expect(next.active.interval.exercise).toBe(0)

    act(() => {
      root.unmount()
    })
  })

  it('automatically moves from rest to the next exercise', () => {
    vi.useFakeTimers()

    mocks.state = routineState({
      phase: 'rest',
      exercise: 0,
    })

    const { container, root } = render()

    expect(container.textContent).toContain('Rest')

    act(() => {
      vi.advanceTimersByTime(15_000)
    })

    expect(mocks.update).toHaveBeenCalled()

    const next = applyLastUpdate()

    expect(next.active.interval.phase).toBe('work')
    expect(next.active.interval.exercise).toBe(1)

    act(() => {
      root.unmount()
    })
  })

  it('finishes after the final rest', () => {
    vi.useFakeTimers()

    mocks.state = routineState({
      round: 1,
      exercise: 2,
      phase: 'rest',
    })

    const { root } = render()

    act(() => {
      vi.advanceTimersByTime(15_000)
    })

    expect(mocks.update).toHaveBeenCalled()

    const next = applyLastUpdate()

    expect(next.active.interval.phase).toBe('done')

    act(() => {
      root.unmount()
    })
  })

  it('beeps once at each of the last 3 seconds', () => {
    vi.useFakeTimers()

    const { root } = render()

    act(() => {
      vi.advanceTimersByTime(27_000)
    })

    expect(mocks.beep).toHaveBeenCalledTimes(1)
    expect(mocks.beep).toHaveBeenLastCalledWith(true, 660, 0.1)

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(mocks.beep).toHaveBeenCalledTimes(2)

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(mocks.beep).toHaveBeenCalledTimes(3)

    act(() => {
      root.unmount()
    })
  })

  it('plays a chime when the phase changes', () => {
    const { root } = render()

    expect(mocks.chime).not.toHaveBeenCalled()

    // El mock de useStore no subscriu als canvis d'estat.
    // Simulem el canvi de fase i tornem a renderitzar.
    mocks.state = routineState({ phase: 'rest' })

    act(() => {
      root.render(<IntervalWorkout />)
    })

    expect(mocks.chime).toHaveBeenCalledTimes(1)
    expect(mocks.chime).toHaveBeenCalledWith(true)

    act(() => {
      root.unmount()
    })
  })

  it('handles zero rest without getting stuck', () => {
    vi.useFakeTimers()

    mocks.state = routineState({
      workSec: 1,
      restSec: 0,
    })

    const { root } = render()

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(mocks.update).toHaveBeenCalled()

    act(() => {
      root.unmount()
    })
  })
})
