// The gym reminder's map (#614, redrawn again in 1.4.4): a small map card under which the map
// moves while the pin stays in the middle, the way Apple Maps and ride apps fine-tune a spot. No
// tiny handles: drag the map, the pin marks the place, the circle around it is the radius (set
// with the segmented control below the map). OpenStreetMap tiles through Leaflet, loaded only when
// the editor opens (and only in the phone app; the web build never has the page). Dark mode
// darkens the tiles in CSS (index.css .gym-map), Reduce Motion turns the glides into jumps.
import { useEffect, useRef } from 'react'
import { TILES } from '../lib/gym-places.js'

const still = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

/** The zoom that shows a circle of `radius` metres at `lat` across about `px` pixels. */
export function zoomFor(radius, lat, px) {
  const mPerPxAtZ0 = 156543.034 * Math.cos(lat * Math.PI / 180)
  const z = Math.log2(mPerPxAtZ0 * px / (radius * 2 * 1.6))
  return Math.max(3, Math.min(18, Math.floor(z * 2) / 2))
}

/**
 * `pos` the place, `radius` in metres, `onMove(pos)` once the map comes to rest after a drag (or
 * the arrow keys). A new `pos` from outside (a search, "Show where I am") moves the map there
 * without calling onMove back.
 */
export default function GymMap({ pos, radius, onMove, label }) {
  const host = useRef(null)
  const live = useRef(null)
  const cb = useRef(onMove)
  cb.current = onMove
  const rNow = useRef(radius)
  rNow.current = radius
  useEffect(() => {
    let gone = false
    Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]).then(([mod]) => {
      const L = mod.default || mod
      if (gone || !host.current) return
      const start = pos || { lat: 20, lng: 0 }
      const zoom = pos ? zoomFor(rNow.current, start.lat, host.current.clientHeight || 300) : 2
      const map = L.map(host.current, { zoomControl: false, attributionControl: true, zoomSnap: 0.5, inertia: !still() }).setView([start.lat, start.lng], zoom)
      map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>')
      L.tileLayer(TILES.url, { maxZoom: TILES.maxZoom, attribution: TILES.attribution, className: 'gym-tiles' }).addTo(map)
      const circle = L.circle([start.lat, start.lng], { radius: rNow.current, className: 'gym-radius', interactive: false }).addTo(map)
      // A move we made ourselves (a search, the locate button) is not one to report back.
      let ours = false
      const wrap = host.current.parentElement
      map.on('movestart', () => { if (!ours) wrap?.classList.add('moving') })
      map.on('move', () => circle.setLatLng(map.getCenter()))
      map.on('moveend', () => {
        wrap?.classList.remove('moving')
        const c = map.getCenter()
        circle.setLatLng(c)
        if (ours) { ours = false; return }
        cb.current?.({ lat: c.lat, lng: c.lng })
      })
      const go = (p, z) => {
        const c = map.getCenter()
        if (Math.abs(c.lat - p.lat) < 1e-7 && Math.abs(c.lng - p.lng) < 1e-7 && (z == null || z === map.getZoom())) return
        ours = true
        map.setView([p.lat, p.lng], z ?? map.getZoom(), { animate: !still() })
      }
      live.current = { map, circle, go }
      // The page may still be sliding in: measure once it sits.
      setTimeout(() => { if (!gone) map.invalidateSize({ pan: false }) }, 350)
    }).catch(() => {})
    return () => { gone = true; live.current?.map.remove(); live.current = null }
  }, [])
  // A new place from outside: the map glides (or jumps) there.
  useEffect(() => {
    const m = live.current
    if (m && pos) m.go(pos)
  }, [pos?.lat, pos?.lng])
  // A new radius: the circle follows and the zoom fits it, around the same centre.
  useEffect(() => {
    const m = live.current
    if (!m) return
    m.circle.setRadius(radius)
    const c = m.map.getCenter()
    m.go({ lat: c.lat, lng: c.lng }, zoomFor(radius, c.lat, host.current?.clientHeight || 300))
  }, [radius])
  return <div className="gym-map" ref={host} role="application" aria-label={label} />
}
