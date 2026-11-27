import { afterEach, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createMannequinScene } from './scene.js'
import { POSES, loopFor, poseFor } from './poses.js'

const { render } = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('three', async importOriginal => ({
  ...await importOriginal(),
  WebGLRenderer: class {
    domElement = { addEventListener() {}, removeEventListener() {}, remove() {} }
    setPixelRatio() {}
    setSize() {}
    render = render
    dispose() {}
  },
}))

afterEach(() => {
  render.mockReset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function setup(pattern, onFrame) {
  let width = 240
  const host = { get clientWidth() { return width }, clientHeight: 340, append() {} }
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({}) }) })
  let resize
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback) { resize = callback }
    observe() {}
    disconnect() {}
  })
  const rig = await createMannequinScene(host, { pattern, onFrame })
  return { rig, resizeTo(value) { width = value; resize() } }
}

it.each(Object.keys(POSES))('%s fits the actual camera at the key pose, throughout the loop, and after resize', async pattern => {
  const { rig, resizeTo } = await setup(pattern)
  const point = new Vector3()
  let worst
  render.mockImplementation((scene, camera) => {
    scene.updateMatrixWorld()
    camera.updateMatrixWorld()
    scene.traverse(mesh => {
      if (!mesh.isMesh) return
      const vertices = mesh.geometry.attributes.position
      for (let i = 0; i < vertices.count; i++) {
        point.fromBufferAttribute(vertices, i).applyMatrix4(mesh.matrixWorld).project(camera)
        const extent = Math.max(Math.abs(point.x), Math.abs(point.y))
        if (extent > worst.extent) {
          worst = { ...worst, extent, geometry: mesh.geometry.type }
        }
      }
    })
  })
  try {
    const loop = loopFor(pattern)
    const times = [...poseFor(pattern).map(frame => frame.at), ...Array.from({ length: 64 }, (_, i) => i * loop / 64)]
    for (const width of [240, 354, 208, 240]) {
      worst = { extent: 0, width, at: 'resize' }
      resizeTo(width)
      expect(worst.extent, JSON.stringify(worst)).toBeLessThan(1)
      let max = worst
      for (const at of times) {
        worst = { extent: 0, width, at }
        rig.seek(at)
        if (worst.extent > max.extent) max = worst
      }
      expect(max.extent, JSON.stringify(max)).toBeLessThan(1)
    }
  } finally { rig.dispose() }
})

it.each([
  ['approaching the key pose', 900, 1],
  ['returning from the key pose', 2050, 2],
  ['before the loop wraps', 4300, 0],
  ['after the loop wraps', 100, 0],
])('reports the nearest displayed core pose when paused: %s', async (_, time, index) => {
  const onFrame = vi.fn()
  const { rig } = await setup('core', onFrame)
  try {
    rig.seek(time)
    rig.pause()
    expect(onFrame.mock.lastCall[0].note).toBe(poseFor('core')[index].note)
  } finally { rig.dispose() }
})
