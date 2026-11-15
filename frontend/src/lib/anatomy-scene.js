// The three.js side of the 3D body (EP12): loaded lazily by components/AnatomyViewer.jsx only when
// the person opens the 3D view. It renders on demand (after an orbit, a pick or a colour change),
// never in a constant loop, caps the pixel ratio, pauses while off screen and frees everything on
// dispose(). The model is this app's own file; nothing is fetched elsewhere.
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { NEUTRAL } from './muscle-3d.js'

const SELECTED = new THREE.Color(0xffffff)

export async function createAnatomyScene(container, { url, colors, onPick, reduceMotion = false }) {
  const probe = document.createElement('canvas')
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw Object.assign(new Error('webgl'), { code: 'webgl' })

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
  container.append(renderer.domElement)
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.6))
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1.5, 2.5, 3); scene.add(key)
  const rim = new THREE.DirectionalLight(0xffffff, 0.6); rim.position.set(-2, 1.5, -3); scene.add(rim)

  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const gltf = await loader.loadAsync(url)
  const meshes = new Map()
  gltf.scene.traverse(o => {
    if (!o.isMesh) return
    o.material = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, color: new THREE.Color(...colors[0]),
      ...(o.name === NEUTRAL ? { transparent: true, opacity: 0.55, depthWrite: false } : {}) })
    if (o.name === NEUTRAL) o.renderOrder = 1
    meshes.set(o.name, o)
  })
  scene.add(gltf.scene)

  // Frame the body: orbit around its middle, upright, never under the floor or over the head.
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const mid = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
  camera.position.set(mid.x, mid.y, mid.z + size.y * 2.1)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(mid)
  Object.assign(controls, { enablePan: false, enableDamping: !reduceMotion, dampingFactor: 0.12, minPolarAngle: Math.PI * 0.2, maxPolarAngle: Math.PI * 0.8,
    minDistance: size.y * 0.9, maxDistance: size.y * 3 })

  let raf = 0, visible = true, disposed = false
  const render = () => { raf = 0; if (disposed || !visible) return; if (controls.update()) request(); renderer.render(scene, camera) }
  const request = () => { if (!raf && !disposed) raf = requestAnimationFrame(render) }
  controls.addEventListener('change', request)
  const resize = () => {
    const w = container.clientWidth || 320, h = container.clientHeight || 420
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); request()
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
  ro?.observe(container)
  const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) request() }) : null
  io?.observe(container)
  const onLost = ev => { ev.preventDefault(); onPick?.({ lost: true }) }
  renderer.domElement.addEventListener('webglcontextlost', onLost)

  // A tap that did not drag picks the muscle under it.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  let down = null
  const onDown = e => { down = [e.clientX, e.clientY] }
  const onUp = e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return
    const r = renderer.domElement.getBoundingClientRect()
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const hit = ray.intersectObjects([...meshes.values()].filter(m => m.name !== NEUTRAL), false)[0]
    onPick?.({ id: hit ? hit.object.name : null })
  }
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)

  let levels = {}, selected = null
  const paint = () => {
    for (const [name, m] of meshes) {
      if (name === NEUTRAL) { m.material.color.setRGB(...colors[0]); continue }
      m.material.color.setRGB(...colors[Math.max(0, Math.min(4, levels[name] | 0))])
      if (name === selected) m.material.color.lerp(SELECTED, 0.45)
      m.material.emissive = new THREE.Color(name === selected ? 0x222222 : 0x000000)
    }
    request()
  }
  resize()

  return {
    meshNames: [...meshes.keys()],
    setLevels(next) { levels = next || {}; paint() },
    highlight(id) { selected = id || null; paint() },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      ro?.disconnect(); io?.disconnect(); controls.dispose()
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      renderer.domElement.removeEventListener('webglcontextlost', onLost)
      for (const m of meshes.values()) { m.geometry.dispose(); m.material.dispose() }
      renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove()
    }
  }
}
