import { describe, it, expect, vi } from 'vitest'
import { Window } from 'happy-dom'
import { SportsLib } from '@sports-alliance/sports-lib'
import { fileProblem, previewActivityFile } from './addon-activity.js'

const gpx = '<?xml version="1.0"?><gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Walk</name><trkseg><trkpt lat="40.0" lon="-74.0"><time>2026-11-10T10:00:00Z</time></trkpt><trkpt lat="40.005" lon="-74.0"><time>2026-11-10T10:10:00Z</time></trkpt></trkseg></trk></gpx>'

describe('local activity preview', () => {
  it('rejects other file types and over-sized inputs before reading the bytes', async () => {
    expect(fileProblem({ name: 'hack.html', size: 10 })).toMatch(/GPX/)
    expect(fileProblem({ name: 'x.fit', size: 20 * 1024 * 1024 })).toMatch(/15 MB/)
    const text = vi.fn()
    await expect(previewActivityFile({ name: 'bad.txt', size: 99, text })).rejects.toThrow(/GPX/)
    expect(text).not.toHaveBeenCalled()
  })

  it('parses a real GPX file without uploading it and produces honest units', async () => {
    const file = { name: 'morning.gpx', size: gpx.length, text: async () => gpx }
    const result = await previewActivityFile(file, {
      loadLibrary: async () => ({ SportsLib }), DOMParserCtor: (new Window()).DOMParser
    })
    expect(result.kind).toBe('GPX')
    expect(result.distanceKm).toBeCloseTo(0.56, 1)
    expect(result.durationMinutes).toBe(10)
    expect(result.filename).toBe('morning.gpx')
    expect(result.localOnly).toBe(true)
  })

  it('passes TCX and FIT to their appropriate library importers', async () => {
    const event = { getFirstActivity: () => ({
      getDistance: () => ({ getValue: () => 1000 }),
      getDuration: () => ({ getValue: () => 120 })
    }) }
    const imports = { importFromTCX: vi.fn(async () => event), importFromFit: vi.fn(async () => event) }
    const opts = { loadLibrary: async () => ({ SportsLib: imports }), DOMParserCtor: (new Window()).DOMParser }
    const tcx = await previewActivityFile({ name: 'trip.tcx', size: 20, text: async () => '<TrainingCenterDatabase />' }, opts)
    expect(tcx.durationMinutes).toBe(2)
    expect(imports.importFromTCX).toHaveBeenCalledTimes(1)
    const fit = await previewActivityFile({ name: 'watch.fit', size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, opts)
    expect(fit.distanceKm).toBe(1)
    expect(imports.importFromFit).toHaveBeenCalledTimes(1)
  })
})
