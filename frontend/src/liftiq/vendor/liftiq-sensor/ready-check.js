// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
// Ready check: is the machine still enough to start a set? Pure, fed with the live accelerometer stream.
// Still = over the last `windowS` seconds every axis varies by less than `axisStd` (m/s^2, population std)
// and the vector length looks like gravity. The check is "ready" after `holdS` seconds of continuous stillness.
// Replaces the 5 s firmware calibration in the Train flow: gravity is derived later from the recorded data.

export const READY_DEFAULTS = Object.freeze({ windowS: 0.75, holdS: 1.5, axisStd: 0.3, gMin: 8.5, gMax: 11.5 });

export function createStillnessDetector(options = {}) {
  const o = { ...READY_DEFAULTS, ...options };
  let buf = [];
  let stillSince = null;
  let lastT = null;

  function evaluate(t) {
    const n = buf.length;
    const span = buf[n - 1].t - buf[0].t;
    if (n < 5 || span < o.windowS * 0.9) return false;
    let mx = 0, my = 0, mz = 0;
    for (const s of buf) { mx += s.ax; my += s.ay; mz += s.az; }
    mx /= n; my /= n; mz /= n;
    let vx = 0, vy = 0, vz = 0;
    for (const s of buf) { vx += (s.ax - mx) ** 2; vy += (s.ay - my) ** 2; vz += (s.az - mz) ** 2; }
    const std = Math.sqrt(Math.max(vx, vy, vz) / n);
    const g = Math.hypot(mx, my, mz);
    void t;
    return std < o.axisStd && g > o.gMin && g < o.gMax;
  }

  return {
    options: o,
    reset() { buf = []; stillSince = null; lastT = null; },
    /** sample: {t (s), ax, ay, az} (m/s^2). Returns {still, stillS, progress, ready}. */
    push(sample) {
      const t = Number(sample.t);
      if (![t, sample.ax, sample.ay, sample.az].every(Number.isFinite)) return this.state();
      if (lastT !== null && (t < lastT || t - lastT > 1)) { buf = []; stillSince = null; } // gap / restart
      lastT = t;
      buf.push({ t, ax: sample.ax, ay: sample.ay, az: sample.az });
      while (buf.length > 1 && t - buf[0].t > o.windowS) buf.shift();
      if (evaluate(t)) { if (stillSince === null) stillSince = buf[0].t; } else stillSince = null;
      this._t = t;
      return this.state();
    },
    state() {
      const stillS = stillSince === null || lastT === null ? 0 : Math.max(0, lastT - stillSince);
      return { still: stillSince !== null, stillS, progress: Math.min(1, stillS / o.holdS), ready: stillS >= o.holdS };
    },
  };
}
