import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { createScanner, readAppleHealthExport, readingsFromExportText } from './apple-export.js'
import { phoneTime } from '../../../../api/health/fold.js'
import { applyReadings } from './sync.js'

const rec = (type, value, start, { unit = '', end = start, source = 'iPhone', extra = '' } = {}) =>
  `<Record type="${type}" sourceName="${source}" unit="${unit}" creationDate="${start}" startDate="${start}" endDate="${end}" value="${value}"${extra}>\n</Record>\n`
const sleep = (value, start, end, source = 'Watch') =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${source}" startDate="${start}" endDate="${end}" value="${value}"/>\n`

const XML = '<?xml version="1.0"?>\n<HealthData locale="it_IT">\n' +
  rec('HKQuantityTypeIdentifierBodyMass', '176.4', '2026-10-10 07:30:00 +0200', { unit: 'lb' }) +
  rec('HKQuantityTypeIdentifierBodyMass', '80.0', '2026-10-11 07:31:00 +0200', { unit: 'kg' }) +
  rec('HKQuantityTypeIdentifierBodyFatPercentage', '0.184', '2026-10-11 07:31:00 +0200', { unit: '%' }) +
  rec('HKQuantityTypeIdentifierHeight', '1.80', '2025-01-01 10:00:00 +0100', { unit: 'm' }) +
  // a walk counted by both the phone and the watch: the day is the larger total, not the sum
  rec('HKQuantityTypeIdentifierStepCount', '4000', '2026-10-11 09:00:00 +0200', { source: 'iPhone' }) +
  rec('HKQuantityTypeIdentifierStepCount', '2000', '2026-10-11 18:00:00 +0200', { source: 'iPhone' }) +
  rec('HKQuantityTypeIdentifierStepCount', '5500', '2026-10-11 09:00:00 +0200', { source: 'Watch' }) +
  rec('HKQuantityTypeIdentifierDistanceWalkingRunning', '2', '2026-10-11 09:00:00 +0200', { unit: 'mi' }) +
  rec('HKQuantityTypeIdentifierActiveEnergyBurned', '418.4', '2026-10-11 09:00:00 +0200', { unit: 'kJ' }) +
  rec('HKQuantityTypeIdentifierHeartRate', '60', '2026-10-11 09:00:00 +0200', { unit: 'count/min' }) +
  rec('HKQuantityTypeIdentifierHeartRate', '140', '2026-10-11 10:00:00 +0200', { unit: 'count/min' }) +
  rec('HKQuantityTypeIdentifierRestingHeartRate', '52', '2026-10-11 06:00:00 +0200', { unit: 'count/min' }) +
  rec('HKQuantityTypeIdentifierOxygenSaturation', '0.98', '2026-10-11 06:00:00 +0200', { unit: '%' }) +
  // a night recorded by both: 23:00–06:00 asleep on the watch, 23:30–05:00 on the phone, in bed ignored
  sleep('HKCategoryValueSleepAnalysisInBed', '2026-10-10 22:30:00 +0200', '2026-10-11 06:30:00 +0200', 'iPhone') +
  sleep('HKCategoryValueSleepAnalysisAsleepCore', '2026-10-10 23:00:00 +0200', '2026-10-11 03:00:00 +0200') +
  sleep('HKCategoryValueSleepAnalysisAsleepDeep', '2026-10-11 03:00:00 +0200', '2026-10-11 06:00:00 +0200') +
  sleep('HKCategoryValueSleepAnalysisAsleepUnspecified', '2026-10-10 23:30:00 +0200', '2026-10-11 05:00:00 +0200', 'iPhone') +
  '</HealthData>\n'

const by = rs => Object.fromEntries(rs.map(r => [`${r.type}@${r.d}`, r]))

describe('Apple Health export', () => {
  it('reads the phone\'s time format and keeps the day it wrote', () => {
    expect(phoneTime('2026-10-11 00:30:00 +0200')).toEqual({ ms: Date.parse('2026-10-11T00:30:00+02:00'), d: '2026-10-11' })
    expect(phoneTime('2026-10-11T00:30:00+02:00')).toEqual({ ms: Date.parse('2026-10-11T00:30:00+02:00'), d: '2026-10-11' })
    expect(phoneTime('2026-10-11')).toMatchObject({ d: '2026-10-11' })
    expect(phoneTime('nope')).toBeNull()
  })

  it('folds every metric into canonical units, one value per day for the totals', () => {
    const r = by(readingsFromExportText(XML))
    expect(r['weight@2026-10-10'].v).toBeCloseTo(80.013, 2)
    expect(r['weight@2026-10-11']).toMatchObject({ v: 80, sid: 'weight:' + Date.parse('2026-10-11T07:31:00+02:00'), src: 'apple-health' })
    expect(r['bodyFat@2026-10-11'].v).toBe(18.4)
    expect(r['height@2025-01-01'].v).toBe(180)
    expect(r['steps@2026-10-11']).toMatchObject({ v: 6000, sid: 'steps:2026-10-11' })
    expect(r['distance@2026-10-11'].v).toBeCloseTo(3.22, 2)
    expect(r['activeEnergy@2026-10-11'].v).toBe(100)
    expect(r['heartRate@2026-10-11']).toMatchObject({ v: 100, lo: 60, hi: 140 })
    expect(r['restingHeartRate@2026-10-11'].v).toBe(52)
    expect(r['sleep@2026-10-11']).toMatchObject({ v: 420, sid: 'sleep:2026-10-11' })
    expect(Object.keys(r).some(k => k.startsWith('undefined'))).toBe(false)
  })

  it('skips what is older than `since`', () => {
    const r = by(readingsFromExportText(XML, { since: '2026-01-01' }))
    expect(r['height@2025-01-01']).toBeUndefined()
    expect(r['weight@2026-10-11']).toBeDefined()
  })

  it('finds a tag cut between two pieces of the file', () => {
    const tags = []
    const scan = createScanner(t => tags.push(t))
    const line = rec('HKQuantityTypeIdentifierBodyMass', '80', '2026-10-11 07:31:00 +0200', { unit: 'kg' })
    for (const cut of [3, 10, 40, 90]) { scan.push(line.slice(0, cut)); scan.push(line.slice(cut)) }
    expect(tags).toHaveLength(4)
    expect(new Set(tags).size).toBe(1)
  })

  it('a second import of the same export adds nothing', () => {
    const s = { unit: 'kg', health: [], bodyweight: [], deleted: {} }
    const readings = readingsFromExportText(XML)
    const first = applyReadings(s, readings, { now: 1 })
    expect(first.added).toBe(readings.length)
    expect(applyReadings(s, readingsFromExportText(XML), { now: 2 })).toEqual({ added: 0, updated: 0 })
    expect(s.bodyweight.map(b => [b.d, b.w])).toEqual([['2026-10-10', 80], ['2026-10-11', 80]])
  })
})

// A zip as the Health app writes it: export.xml deflated, inside apple_health_export/.
function zipOf(name, text) {
  const data = Buffer.from(text, 'utf8')
  const comp = deflateRawSync(data)
  const nameB = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8)
  local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameB.length, 26)
  const cd = Buffer.alloc(46)
  cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10)
  cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(nameB.length, 28); cd.writeUInt32LE(0, 42)
  const cdStart = 30 + nameB.length + comp.length
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(46 + nameB.length, 12); eocd.writeUInt32LE(cdStart, 16)
  return new Blob([local, nameB, comp, cd, nameB, eocd])
}

describe('everything else Health records', () => {
  const cat = (type, value, start, end = start, source = 'iPhone') =>
    `<Record type="HKCategoryTypeIdentifier${type}" sourceName="${source}" startDate="${start}" endDate="${end}" value="${value}"/>\n`
  const X = '<HealthData>\n' +
    cat('Headache', 'HKCategoryValueSeverityMild', '2026-10-11 08:00:00 +0200') +
    cat('Headache', 'HKCategoryValueSeveritySevere', '2026-10-11 18:00:00 +0200') +
    cat('Headache', 'HKCategoryValueSeverityNotPresent', '2026-10-12 08:00:00 +0200') +
    cat('MenstrualFlow', 'HKCategoryValueMenstrualFlowMedium', '2026-10-11 00:00:00 +0200') +
    cat('MenstrualFlow', 'HKCategoryValueMenstrualFlowNone', '2026-10-12 00:00:00 +0200') +
    cat('OvulationTestResult', 'HKCategoryValueOvulationTestResultLuteinizingHormoneSurge', '2026-10-11 09:00:00 +0200') +
    cat('AppleStandHour', 'HKCategoryValueAppleStandHourStood', '2026-10-11 09:00:00 +0200', '2026-10-11 10:00:00 +0200', 'Watch') +
    cat('AppleStandHour', 'HKCategoryValueAppleStandHourIdle', '2026-10-11 10:00:00 +0200', '2026-10-11 11:00:00 +0200', 'Watch') +
    cat('AppleStandHour', 'HKCategoryValueAppleStandHourStood', '2026-10-11 11:00:00 +0200', '2026-10-11 12:00:00 +0200', 'Watch') +
    cat('MindfulSession', 'HKCategoryValueNotApplicable', '2026-10-11 07:00:00 +0200', '2026-10-11 07:10:00 +0200') +
    cat('HandwashingEvent', 'HKCategoryValueNotApplicable', '2026-10-11 12:00:00 +0200', '2026-10-11 12:00:20 +0200', 'Watch') +
    rec('HKQuantityTypeIdentifierDietaryWater', '0.5', '2026-10-11 09:00:00 +0200', { unit: 'L' }) +
    rec('HKQuantityTypeIdentifierDietaryWater', '250', '2026-10-11 13:00:00 +0200', { unit: 'mL' }) +
    rec('HKQuantityTypeIdentifierBodyTemperature', '98.6', '2026-10-11 08:00:00 +0200', { unit: 'degF' }) +
    rec('HKQuantityTypeIdentifierBloodGlucose', '5.5', '2026-10-11 08:00:00 +0200', { unit: 'mmol&lt;180.1558800000541&gt;/L' }) +
    // a workout as newer phones write it: energy and distance in its statistics
    '<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" sourceName="Watch" startDate="2026-10-11 18:00:00 +0200" endDate="2026-10-11 18:45:00 +0200">\n' +
    ' <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-10-11 18:00:00 +0200" endDate="2026-10-11 18:45:00 +0200" sum="310" unit="kcal"/>\n' +
    '</Workout>\n' +
    // and as older ones did, on the workout itself
    '<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="1800" durationUnit="s" totalDistance="3.1" totalDistanceUnit="mi" totalEnergyBurned="1255.2" totalEnergyBurnedUnit="kJ" sourceName="Watch" startDate="2026-10-12 07:00:00 +0200" endDate="2026-10-12 07:30:00 +0200"/>\n' +
    '</HealthData>\n'

  it('symptoms, cycle, habits, food, vitals and workouts each fold the way the catalogue says', () => {
    const x = by(readingsFromExportText(X))
    expect(x['headache@2026-10-11'].v).toBe(4)
    expect(x['headache@2026-10-12']).toBeUndefined()
    expect(x['menstrualFlow@2026-10-11'].v).toBe(3)
    expect(x['menstrualFlow@2026-10-12']).toBeUndefined()
    expect(x['ovulationTest@2026-10-11'].v).toBe(2)
    expect(x['standHours@2026-10-11'].v).toBe(2)
    expect(x['mindful@2026-10-11'].v).toBe(10)
    expect(x['handwashing@2026-10-11'].v).toBe(1)
    expect(x['dietWater@2026-10-11'].v).toBe(750)
    expect(x['bodyTemperature@2026-10-11'].v).toBe(37)
    expect(Math.round(x['glucose@2026-10-11'].v)).toBe(99)
    expect(x['workout@2026-10-11']).toMatchObject({ v: 45, a: 'traditionalStrengthTraining', kc: 310, sid: 'workout:' + Date.parse('2026-10-11T18:00:00+02:00') })
    expect(x['workout@2026-10-12']).toMatchObject({ v: 30, a: 'running', kc: 300, km: 4.99 })
  })

  it('a workout or a symptom imported twice is still one record', () => {
    const S = { unit: 'kg', bodyweight: [], health: [] }
    applyReadings(S, readingsFromExportText(X), { now: 1 })
    const n = S.health.length
    expect(applyReadings(S, readingsFromExportText(X), { now: 2 })).toEqual({ added: 0, updated: 0 })
    expect(S.health.length).toBe(n)
    expect(S.health.find(r => r.type === 'workout' && r.a === 'running')).toMatchObject({ kc: 300, km: 4.99 })
  })
})

describe('reading the file', () => {
  it('inflates export.xml out of export.zip as a stream', async () => {
    const seen = []
    const { readings, records } = await readAppleHealthExport(zipOf('apple_health_export/export.xml', XML), { onProgress: f => seen.push(f) })
    expect(records).toBe(16)   // 13 quantities and 3 asleep spans; in-bed time is not sleep
    expect(by(readings)['steps@2026-10-11'].v).toBe(6000)
    expect(seen.at(-1)).toBe(1)
  })
  it('reads a bare export.xml too', async () => {
    const { readings } = await readAppleHealthExport(new Blob([XML]))
    expect(by(readings)['sleep@2026-10-11'].v).toBe(420)
  })
  it('says so when a zip has no export in it', async () => {
    await expect(readAppleHealthExport(zipOf('other.txt', 'hi'))).rejects.toThrow('no-export')
  })
})
