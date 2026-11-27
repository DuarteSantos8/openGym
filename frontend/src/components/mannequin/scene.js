// The three.js side of the mannequin rig (EP26-T01, E5a). Loaded on demand by
// components/mannequin/Mannequin.jsx, and only once the device has said it can make a WebGL
// context: the sheet shows a still picture instead when it cannot. It draws the rig from the
// skeleton in poses.js, plays a pattern's loop only while it is asked to, and frees everything
// on dispose().
import * as THREE from 'three'
import { RIG, skeletonAt, keyFrameFor, loopFor, poseFor, frameIndexAt, VIEW_BETA } from './poses.js'

const BODY = {
  torso: 0.115, shoulder: 0.055, hip: 0.075, upperArm: 0.05, forearm: 0.04,
  hand: 0.05, thigh: 0.085, shin: 0.06, foot: 0.045, neck: 0.05,
}

/** The app's own colours, so the rig follows the theme and the accent the person chose. */
function themeColor(name, fallback) {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return fallback
  const probe = document.createElement('span')
  probe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;background-color:var(' + name + ')'
  document.body.append(probe)
  const colour = getComputedStyle(probe).backgroundColor
  probe.remove()
  return colour && colour !== 'rgba(0, 0, 0, 0)' ? colour : fallback
}

const vec = p => new THREE.Vector3(p[0], p[1], p[2])

/** Put a capsule so that it spans the two points, the way a bone does. */
function place(mesh, a, b) {
  const from = vec(a), to = vec(b)
  const dir = to.clone().sub(from)
  const len = dir.length()
  mesh.position.copy(from).add(to).multiplyScalar(0.5)
  if (len > 1e-6) mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.divideScalar(len))
}

/**
 * A limb of the rig. Its length never changes: a bone is as long as the segment between its two
 * joints, and a pose only turns it. So the shape is built once and only turned afterwards.
 */
function bone(radius, length, material, flatten = 1) {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 14)
  const mesh = new THREE.Mesh(geo, material)
  mesh.scale.z = flatten
  return mesh
}

export async function createMannequinScene(container, { pattern, onFrame, onError } = {}) {
  const probe = document.createElement('canvas')
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw Object.assign(new Error('webgl'), { code: 'webgl' })
  const loop = loopFor(pattern)
  if (!loop) throw Object.assign(new Error('no pose for ' + pattern), { code: 'npose' })

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
  container.append(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30)
  const dir = new THREE.Vector3(Math.cos(VIEW_BETA), 0, Math.sin(VIEW_BETA))
  const target = new THREE.Vector3(0, 0.80, 0.08)
  camera.position.copy(target).addScaledVector(dir, -3.4).add(new THREE.Vector3(0, 0.35, 0))
  camera.lookAt(target)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x303038, 1.7))
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.5); keyLight.position.set(-2.5, 3, 2); scene.add(keyLight)
  const rimLight = new THREE.DirectionalLight(0xffffff, 0.7); rimLight.position.set(2.5, 1.5, -2.5); scene.add(rimLight)

  const skin = new THREE.MeshStandardMaterial({ color: themeColor('--acc-ink', '#30d158'), roughness: 0.55, metalness: 0.05 })
  const limb = new THREE.MeshStandardMaterial({ color: themeColor('--label', '#ffffff'), roughness: 0.6, metalness: 0.05 })

  const parts = {}
  parts.head = new THREE.Mesh(new THREE.SphereGeometry(RIG.headR, 20, 14), skin)
  parts.neck = bone(BODY.neck, RIG.neck, skin)
  parts.torso = bone(BODY.torso, RIG.torso, skin, 0.72)
  parts.shoulders = bone(BODY.shoulder, RIG.shoulderHalf * 2, skin)
  parts.hips = bone(BODY.hip, RIG.hipHalf * 2, skin)
  parts.upperArmL = bone(BODY.upperArm, RIG.upperArm, limb)
  parts.upperArmR = bone(BODY.upperArm, RIG.upperArm, limb)
  parts.forearmL = bone(BODY.forearm, RIG.forearm, limb)
  parts.forearmR = bone(BODY.forearm, RIG.forearm, limb)
  parts.handL = new THREE.Mesh(new THREE.SphereGeometry(BODY.hand, 12, 8), skin)
  parts.handR = new THREE.Mesh(new THREE.SphereGeometry(BODY.hand, 12, 8), skin)
  parts.thighL = bone(BODY.thigh, RIG.thigh, limb)
  parts.thighR = bone(BODY.thigh, RIG.thigh, limb)
  parts.shinL = bone(BODY.shin, RIG.shin, limb)
  parts.shinR = bone(BODY.shin, RIG.shin, limb)
  parts.footL = bone(BODY.foot, RIG.footLen, limb, 0.6)
  parts.footR = bone(BODY.foot, RIG.footLen, limb, 0.6)
  for (const mesh of Object.values(parts)) scene.add(mesh)

  /** Move every part onto the rig as the skeleton says it is. */
  function apply(s) {
    parts.head.position.copy(vec(s.head))
    place(parts.neck, s.chest, s.head)
    place(parts.torso, s.pelvis, s.chest)
    place(parts.shoulders, s.shoulderL, s.shoulderR)
    place(parts.hips, s.hipL, s.hipR)
    place(parts.upperArmL, s.shoulderL, s.elbowL)
    place(parts.upperArmR, s.shoulderR, s.elbowR)
    place(parts.forearmL, s.elbowL, s.wristL)
    place(parts.forearmR, s.elbowR, s.wristR)
    parts.handL.position.copy(vec(s.wristL))
    parts.handR.position.copy(vec(s.wristR))
    place(parts.thighL, s.hipL, s.kneeL)
    place(parts.thighR, s.hipR, s.kneeR)
    place(parts.shinL, s.kneeL, s.ankleL)
    place(parts.shinR, s.kneeR, s.ankleR)
    place(parts.footL, s.heelL, s.toeL)
    place(parts.footR, s.heelR, s.toeR)
  }

  const key = keyFrameFor(pattern)
  let clock = key ? key.at : 0
  let playing = false, raf = 0, last = 0, disposed = false, shown = -1

  const paint = () => {
    const s = skeletonAt(pattern, clock)
    if (s) apply(s)
    // The words beside the rig follow the pose, but only when the pose actually changes.
    const i = frameIndexAt(pattern, clock)
    if (i !== shown) { shown = i; onFrame?.(poseFor(pattern)[i]) }
  }
  const render = () => { if (!disposed) renderer.render(scene, camera) }

  const tick = () => {
    raf = 0
    if (disposed) return
    if (playing) {
      const now = performance.now()
      const dt = last ? now - last : 16
      last = now
      clock = (clock + dt) % loop
      paint()
    }
    render()
    if (playing) raf = requestAnimationFrame(tick)
  }
  const request = () => { if (!raf && !disposed) raf = requestAnimationFrame(tick) }

  const resize = () => {
    const w = container.clientWidth || 260, h = container.clientHeight || 340
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    render()
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  ro?.observe(container)
  const onLost = ev => { ev.preventDefault(); onError?.() }
  renderer.domElement.addEventListener('webglcontextlost', onLost)

  paint()
  resize()

  return {
    play() { if (playing || disposed) return; playing = true; last = 0; request() },
    pause() { playing = false; last = 0; if (raf) { cancelAnimationFrame(raf); raf = 0 } },
    seek(ms) { clock = ms; paint(); render() },
    dispose() {
      disposed = true
      playing = false
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      ro?.disconnect()
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      for (const mesh of Object.values(parts)) { mesh.geometry.dispose(); mesh.material.dispose() }
      skin.dispose(); limb.dispose()
      renderer.dispose()
      renderer.forceContextLoss?.()
      renderer.domElement.remove()
    },
  }
}
