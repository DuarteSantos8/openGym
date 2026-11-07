import { describe, expect, it } from 'vitest'
import { clock, coarseLeft, lastThree, restView } from './rest-timer-view.js'
import { REST_MAX } from './duration.js'

describe('restView', () => {
  it('a full rest is all progress, the ring complete', () => {
    const v = restView({ left: 90, total: 90 })
    expect(v).toMatchObject({ time: '1:30', progress: 1, ringOffset: 0, glow: false, label: 'Rest', plusLabel: '+15s', skipLabel: 'Skip', announce: '' })
  })
  it('half way is half', () => {
    expect(restView({ left: 45, total: 90 })).toMatchObject({ progress: 0.5, ringOffset: 50 })
  })
  it('glows for 3, 2, 1 only', () => {
    for (const left of [3, 2, 1]) expect(restView({ left, total: 90 }).glow).toBe(true)
    for (const left of [4, 0]) expect(restView({ left, total: 90 }).glow).toBe(false)
    expect(lastThree(2, true)).toBe(false)
  })
  it('rest over: 0:00, no progress, said once, +15s starts a new rest', () => {
    expect(restView({ left: 0, total: 90, over: true })).toMatchObject({
      time: '0:00', progress: 0, ringOffset: 0, glow: false, label: 'Rest over', plusLabel: 'Rest +15s', skipLabel: 'Dismiss', announce: 'Rest over', plusOff: false })
  })
  it('paused changes the label, not the glow', () => {
    expect(restView({ left: 2, total: 90, paused: true })).toMatchObject({ label: 'Paused', glow: true })
  })
  it('switch sides keeps its own label', () => {
    expect(restView({ left: 20, total: 20, switching: true }).label).toBe('Switch sides')
  })
  it('progress never goes over 1 or under 0', () => {
    expect(restView({ left: 120, total: 90 }).progress).toBe(1)
    expect(restView({ left: -5, total: 90 }).progress).toBe(0)
    expect(restView({ left: 5, total: 0 }).progress).toBe(0)
  })
  it('+15s is off at the longest rest, but not when the rest is over', () => {
    expect(restView({ left: REST_MAX, total: REST_MAX }).plusOff).toBe(true)
    expect(restView({ left: REST_MAX - 15, total: REST_MAX }).plusOff).toBe(false)
  })
  it('a hold: its own label, overtime counts up, nothing is announced', () => {
    expect(restView({ left: 20, total: 45, work: true }).label).toBe('Hold')
    expect(restView({ left: -7, total: 45, work: true, overtime: true }).time).toBe('+0:07')
    expect(restView({ left: 0, total: 45, work: true, over: true }).announce).toBe('')
  })
})

describe('spoken label', () => {
  it('rounds up to 5 s above 10 s, exact below', () => {
    expect([90, 87, 61, 11, 10, 7, 0].map(coarseLeft)).toEqual([90, 90, 65, 15, 10, 7, 0])
    expect(restView({ left: 87, total: 90 }).spoken).toBe('1:30 left on the clock')
  })
  it('clock pads seconds', () => {
    expect(clock(65)).toBe('1:05')
  })
})
