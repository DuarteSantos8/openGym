// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
import { packetToHex } from "./protocol.js";

const RATE_WINDOW_MS = 2000;

// Tracks the firmware's wrapping uint16 sequence counter plus debug statistics
// (packet rate, totals, drops, last raw packet). Pure logic, no DOM.
export class PacketTracker {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.reset();
  }

  reset() {
    this.lastSeqRaw = null;
    this.seqUnwrapped = null;
    this.total = 0;
    this.dropped = 0;
    this.invalid = 0;
    this.arrivals = [];
    this.lastHex = "";
    this.lastAt = null;
  }

  recordInvalid(dataView) {
    this.invalid += 1;
    if (dataView) this.lastHex = packetToHex(dataView);
  }

  // Returns { seq, dropped }: seq is the unwrapped (monotonic) counter or null
  // for legacy packets; dropped is the number of packets missing before this one.
  record(reading, dataView) {
    const at = this.now();
    this.total += 1;
    this.lastAt = at;
    this.arrivals.push(at);
    while (this.arrivals.length && at - this.arrivals[0] > RATE_WINDOW_MS) this.arrivals.shift();
    if (dataView) this.lastHex = packetToHex(dataView);

    const raw = reading.seq;
    if (raw === null || raw === undefined) return { seq: null, dropped: 0 };
    if (this.lastSeqRaw === null) {
      this.lastSeqRaw = raw;
      this.seqUnwrapped = raw;
      return { seq: raw, dropped: 0 };
    }
    const delta = (raw - this.lastSeqRaw + 0x10000) & 0xFFFF;
    this.lastSeqRaw = raw;
    this.seqUnwrapped += delta;
    const dropped = Math.max(0, delta - 1);
    this.dropped += dropped;
    return { seq: this.seqUnwrapped, dropped };
  }

  rateHz() {
    const at = this.now();
    const recent = this.arrivals.filter((time) => at - time <= RATE_WINDOW_MS);
    if (recent.length < 2) return 0;
    const span = recent[recent.length - 1] - recent[0];
    return span > 0 ? (recent.length - 1) * 1000 / span : 0;
  }

  snapshot() {
    return {
      total: this.total,
      dropped: this.dropped,
      invalid: this.invalid,
      rateHz: this.rateHz(),
      lastHex: this.lastHex,
      lastAgeMs: this.lastAt === null ? null : this.now() - this.lastAt,
    };
  }
}
