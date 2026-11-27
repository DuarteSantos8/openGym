// The mannequin rig's pose schema (EP26-T01, E5a): the frames of each movement pattern, the
// loop they run in, and the skeleton they describe. The schema is the contract the other
// movement tasks build on, so it is checked here rather than in the component that draws it.
import { describe, expect, it } from 'vitest'
import { PATTERNS } from '../../content/exercise-guides.js'
import { POSES, POSE_LOOPS, POSE_LIMITS, JOINT_NAMES, RIG, poseFor, loopFor, keyFrameFor,
  stillTextFor, jointsAt, skeletonAt } from './poses.js'

const localePacks = import.meta.glob('../../locales/*.js', { eager: true, import: 'default' })

const patterns = () => Object.keys(POSES)

describe('the mannequin poses', () => {
  it('covers only movement patterns the app knows', () => {
    for (const p of patterns()) expect(PATTERNS).toContain(p)
  })

  it.each([
    ['lunge', 'Both knees are bent, with one foot ahead of the other.', (a, b) =>
      b.heelL[2] > b.toeR[2] && b.pelvis[1] < a.pelvis[1] && b.kneeR[1] < b.kneeL[1]],
    ['hinge', 'The hips are back and the torso tilts forward.', (a, b) =>
      b.pelvis[2] < a.pelvis[2] && b.chest[2] > b.pelvis[2] && b.pelvis[1] > a.pelvis[1] - 0.1],
    ['push-h', 'The arms reach straight forward at chest height.', (a, b) =>
      b.wristL[2] > a.wristL[2] && Math.abs(b.wristL[1] - b.shoulderL[1]) < 0.08],
    ['push-v', 'The arms extend overhead.', (a, b) => b.wristL[1] > a.wristL[1] && b.elbowL[1] > b.shoulderL[1]],
    ['pull-h', 'The elbows draw back and the hands come toward the ribs.', (a, b) =>
      b.elbowL[2] < b.shoulderL[2] && b.wristL[2] < a.wristL[2]],
    ['pull-v', 'The elbows move down as the hands come toward the chest.', (a, b) =>
      b.elbowL[1] < b.shoulderL[1] && b.wristL[1] < a.wristL[1]],
    ['core', 'Lying on the back, one arm reaches back as the opposite leg extends.', (a, b) =>
      b.wristL[2] < a.wristL[2] && b.ankleR[1] < a.ankleR[1] && b.wristR[1] === a.wristR[1]],
    ['isolation', 'The forearms curl up while the upper arms stay by the sides.', (a, b) =>
      b.wristL[1] > a.wristL[1] && b.elbowL.every((value, i) => value === a.elbowL[i])],
  ])('%s has its own readable still and a distinct movement', (pattern, note, matches) => {
    const frames = poseFor(pattern)
    expect(frames).not.toBeNull()
    expect(frames[0].at).toBe(0)
    expect(loopFor(pattern)).toBeGreaterThanOrEqual(POSE_LIMITS.minLoopMs)
    expect(loopFor(pattern)).toBeLessThanOrEqual(POSE_LIMITS.maxLoopMs)
    expect(stillTextFor(pattern)).toBe(note)
    expect(matches(skeletonAt(pattern, 0), skeletonAt(pattern, keyFrameFor(pattern).at))).toBe(true)
    for (let at = 0; at < loopFor(pattern); at += 37) {
      const skeleton = skeletonAt(pattern, at)
      expect(Object.values(skeleton).flat().every(Number.isFinite)).toBe(true)
      expect(Math.hypot(...skeleton.hipL.map((value, i) => value - skeleton.hipR[i]))).toBeCloseTo(2 * RIG.hipHalf, 2)
      expect(Math.min(skeleton.toeL[1], skeleton.toeR[1], skeleton.heelL[1], skeleton.heelR[1])).toBeGreaterThanOrEqual(-1e-6)
    }
  })
  it('gives every pattern a loop that matches its frames', () => {
    for (const p of patterns()) {
      expect(loopFor(p)).toBeGreaterThanOrEqual(POSE_LIMITS.minLoopMs)
      expect(loopFor(p)).toBeLessThanOrEqual(POSE_LIMITS.maxLoopMs)
    }
  })

  it('keeps each pattern to a readable number of frames, in order and inside its loop', () => {
    for (const p of patterns()) {
      const frames = poseFor(p)
      expect(frames.length).toBeGreaterThanOrEqual(POSE_LIMITS.minFrames)
      expect(frames.length).toBeLessThanOrEqual(POSE_LIMITS.maxFrames)
      for (let i = 1; i < frames.length; i++) expect(frames[i].at).toBeGreaterThan(frames[i - 1].at)
      for (const f of frames) {
        expect(f.at).toBeGreaterThanOrEqual(0)
        expect(f.at).toBeLessThan(loopFor(p))
      }
    }
  })

  it('names every frame and writes a sentence for it', () => {
    for (const p of patterns()) {
      for (const f of poseFor(p)) {
        expect(typeof f.name).toBe('string')
        expect(f.name.trim().length).toBeGreaterThan(0)
        expect(typeof f.note).toBe('string')
        expect(f.note.trim().length).toBeGreaterThan(20)
      }
    }
  })

  it('uses only the rig\'s own joints, and angles the rig can hold', () => {
    for (const p of patterns()) {
      for (const f of poseFor(p)) {
        for (const [joint, angle] of Object.entries(f.joints)) {
          expect(JOINT_NAMES).toContain(joint)
          expect(Number.isFinite(angle)).toBe(true)
          expect(angle).toBeGreaterThanOrEqual(POSE_LIMITS.angle[0])
          expect(angle).toBeLessThanOrEqual(POSE_LIMITS.angle[1])
        }
      }
    }
  })

  it('marks exactly one key pose per pattern, and says it in words', () => {
    for (const p of patterns()) {
      const keys = poseFor(p).filter(f => f.key)
      expect(keys.length).toBe(1)
      expect(keyFrameFor(p)).toBe(keys[0])
      expect(stillTextFor(p)).toBe(keys[0].note)
      expect(stillTextFor(p).length).toBeGreaterThan(20)
    }
  })

  it('has no pose for a pattern it does not know', () => {
    expect(poseFor('nonsense')).toBe(null)
    expect(loopFor('nonsense')).toBe(null)
    expect(keyFrameFor('nonsense')).toBe(null)
    expect(stillTextFor('nonsense')).toBe('')
  })

  it('reads a frame back exactly as it was written', () => {
    for (const p of patterns()) {
      for (const f of poseFor(p)) {
        const at = jointsAt(p, f.at)
        for (const [joint, angle] of Object.entries(f.joints)) expect(at[joint]).toBeCloseTo(angle, 6)
      }
    }
  })

  it('moves between two frames instead of jumping', () => {
    const p = 'squat'
    const frames = poseFor(p)
    const a = frames[0], b = frames[1]
    const mid = (a.at + b.at) / 2
    const at = jointsAt(p, mid)
    for (const joint of Object.keys(a.joints)) {
      const lo = Math.min(a.joints[joint], b.joints[joint])
      const hi = Math.max(a.joints[joint], b.joints[joint])
      expect(at[joint]).toBeGreaterThanOrEqual(lo - 1e-9)
      expect(at[joint]).toBeLessThanOrEqual(hi + 1e-9)
    }
  })

  it('keeps both feet on the floor through the standing sequences', () => {
    for (const p of patterns().filter(p => p !== 'lunge' && p !== 'core')) {
      for (const f of poseFor(p)) {
        const s = skeletonAt(p, f.at)
        expect(s.heelL[1]).toBeCloseTo(0, 6)
        expect(s.toeL[1]).toBeCloseTo(0, 6)
        expect(s.heelR[1]).toBeCloseTo(0, 6)
        expect(s.toeR[1]).toBeCloseTo(0, 6)
        expect(s.ankleL[1]).toBeCloseTo(RIG.ankleY, 6)
        expect(s.ankleR[1]).toBeCloseTo(RIG.ankleY, 6)
      }
    }
  })

  it('names every point of the skeleton with a finite position', () => {
    const s = skeletonAt('squat', 0)
    for (const [name, point] of Object.entries(s)) {
      expect(Array.isArray(point)).toBe(true)
      expect(point.length).toBe(3)
      for (const n of point) expect(Number.isFinite(n)).toBe(true)
    }
  })

  it('sits down for a squat and back up again', () => {
    const frames = poseFor('squat')
    const standing = frames[0]
    const key = keyFrameFor('squat')
    const top = skeletonAt('squat', standing.at)
    const bottom = skeletonAt('squat', key.at)
    expect(bottom.pelvis[1]).toBeLessThan(top.pelvis[1])
    expect(top.pelvis[1]).toBeCloseTo(RIG.ankleY + RIG.shin + RIG.thigh, 6)
  })

  it('puts the knee over the toe at the bottom of a squat', () => {
    const key = keyFrameFor('squat')
    const s = skeletonAt('squat', key.at)
    expect(s.kneeL[2]).toBeGreaterThan(s.ankleL[2])
    expect(s.hipL[2]).toBeLessThan(s.ankleL[2])
  })

  it('keeps the head above the hips in every frame', () => {
    for (const f of poseFor('squat')) {
      const s = skeletonAt('squat', f.at)
      expect(s.head[1]).toBeGreaterThan(s.pelvis[1])
    }
  })

  it('reaches the arms forward for balance at the bottom', () => {
    const key = keyFrameFor('squat')
    const s = skeletonAt('squat', key.at)
    expect(s.wristL[2]).toBeGreaterThan(s.shoulderL[2])
    expect(s.wristR[2]).toBeGreaterThan(s.shoulderR[2])
  })

  it('says every frame in every language, so no one reads it in English by mistake', () => {
    expect(Object.keys(localePacks)).toHaveLength(25)
    for (const [locale, pack] of Object.entries(localePacks)) {
      expect(pack['Movement pattern example'], locale).toBeTruthy()
      expect(pack['Movement pattern example']).not.toBe('Movement pattern example')
    }
    for (const p of patterns()) {
      for (const f of poseFor(p)) {
        for (const [locale, pack] of Object.entries(localePacks)) {
          expect(pack[f.note], locale + ' ' + p + ' ' + f.name).toBeTruthy()
          expect(pack[f.note]).not.toBe(f.note)
        }
      }
    }
  })
})
