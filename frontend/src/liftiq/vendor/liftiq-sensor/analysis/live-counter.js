// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
// Causal live pulse counter (see docs/REP_ANALYSIS.md). No look-ahead.
import { normalizeSamples, MAX_DT } from './pulses.js';

export function createLiveCounter(options = {}) {
  const o = {
    tau: 4, peakMin: 0.45, refractory: 1.0, clip: 12, edge: 0.1,
    confirmFraction: 0.7, minRiseS: 0.15, stillWindowS: 1.0, stillStd: 0.35, maxWaitS: 5,
    ...options,
  };
  const buf = [];
  const pulses = [];
  let up = null;
  let gn = 0;
  let ready = false;
  let v = 0;
  let vPrev = 0;
  let lastT = null;
  let cand = null;
  let lastStart = null;
  let armed = true;
  let vLow = 0;
  let count = 0;

  function establishGravity() {
    const t1 = buf[buf.length - 1].t;
    let lo = 0;
    while (t1 - buf[lo].t > o.stillWindowS) lo++;
    if (t1 - buf[lo].t < o.stillWindowS * 0.95) return false;
    const w = buf.slice(lo);
    const mags = w.map((p) => Math.hypot(p.ax, p.ay, p.az));
    const mu = mags.reduce((a, b) => a + b, 0) / mags.length;
    const sd = Math.sqrt(mags.reduce((a, b) => a + (b - mu) ** 2, 0) / mags.length);
    const timedOut = t1 - buf[0].t > o.maxWaitS;
    if (sd > o.stillStd && !timedOut) return false;
    const avg = (k) => w.reduce((a, p) => a + p[k], 0) / w.length;
    const g = [avg('ax'), avg('ay'), avg('az')];
    gn = Math.hypot(...g);
    up = g.map((x) => x / gn);
    return true;
  }

  function confirm(c, now) {
    if (c.tStart === null || c.t - c.tStart < o.minRiseS) return null; // impulse / handling shock
    const last = pulses[pulses.length - 1];
    const pulse = { t: c.t, vPeak: c.v, tStart: c.tStart, confirmedAt: now, latencyS: now - c.t };
    if (last && c.t - last.t <= o.refractory) {
      // same rule as offline: keep the larger within the refractory period (count unchanged)
      if (c.v > last.vPeak) pulses[pulses.length - 1] = pulse;
      return null;
    }
    pulses.push(pulse);
    count++;
    return pulse;
  }

  function step(p) {
    const a = Math.max(-o.clip, Math.min(o.clip, p.ax * up[0] + p.ay * up[1] + p.az * up[2] - gn));
    if (lastT !== null) {
      let dt = p.t - lastT;
      if (dt > 0) {
        if (dt > MAX_DT) dt = MAX_DT;
        v = v * Math.max(0, 1 - dt / o.tau) + a * dt;
      }
    }
    if (v > o.edge && vPrev <= o.edge) lastStart = p.t;
    let newRep = null;
    if (!armed) {
      // after a resolved candidate wait for the signal to fall away (or a fresh rise) before re-arming,
      // so the slow tail of an impulse/rejected pulse cannot create a second candidate
      if (v < vLow) vLow = v;
      if (v < o.peakMin || v > vLow + 0.1) {
        armed = true;
        if (v > o.edge && vLow <= o.edge) lastStart = p.t;
        else if (v > vLow + 0.1) lastStart = p.t - 0.02;
      }
    }
    if (armed) {
      if (v > o.peakMin && (!cand || v > cand.v)) cand = { t: p.t, v, tStart: lastStart };
      if (cand && v <= o.confirmFraction * cand.v) {
        newRep = confirm(cand, p.t);
        cand = null;
        armed = false;
        vLow = v;
      }
    }
    vPrev = v;
    lastT = p.t;
    return newRep;
  }

  return {
    /** Feed one sample ({t,ax,ay,az} or app fields). Returns {count, ready, newRep?}. */
    push(sample) {
      const [s] = normalizeSamples([sample]);
      let newRep = null;
      if (s) {
        if (!ready) {
          buf.push(s);
          if (establishGravity()) {
            ready = true;
            for (const b of buf) newRep = step(b) || newRep; // replay buffered start (causal)
            buf.length = 0;
          }
        } else {
          newRep = step(s);
        }
      }
      const out = { count, ready };
      if (newRep) out.newRep = newRep;
      return out;
    },
    get count() { return count; },
    get ready() { return ready; },
    get pulses() { return pulses.slice(); },
  };
}
