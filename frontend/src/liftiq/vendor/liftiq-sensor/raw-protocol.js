// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
// Research-capture ("Lab") protocol: chunk parsing, reassembly, header/sample decoding and
// Raw CSV v1 generation. Pure logic: no DOM, no Bluetooth (unit tested).

import { RAW_UUID } from "./protocol.js";
export { RAW_UUID };
export const APP_VERSION = "s0.2";

// Control commands (written to the existing control characteristic).
export const RAW_CMD = Object.freeze({ ARM: 0x10, START: 0x11, STOP: 0x12, DOWNLOAD: 0x13, RESEND: 0x14, ERASE: 0x15 });

// Chunk types: [type u8][chunkIndex u16 LE][len u8][payload...]
export const RAW_CHUNK = Object.freeze({ STATUS: 0x01, DATA: 0x02, INFO: 0x03, DONE: 0x04 });

// Firmware capture states.
export const RAW_STATE = Object.freeze({
  IDLE: 0, ARMING: 1, ARMED: 2, CAPTURING: 3, READY: 4, UPLOADING: 5, ERROR: 6,
});

export const RAW_SAMPLE_BYTES = 12;   // gyro XYZ + accel XYZ int16
export const SENSORTIME_US_PER_LSB = 39.0625;
// Datasheet sensitivities (LSB per unit) by configured range.
const ACCEL_LSB_PER_G = { 2: 16384, 4: 8192, 8: 4096, 16: 2048 };
const GYRO_LSB_PER_DPS = { 2000: 16.4, 1000: 32.8, 500: 65.6, 250: 131.2, 125: 262.4 };
const G_TO_MS2 = 9.81;

export function encodeRawCommand(command, arg1, arg2) {
  if (command === RAW_CMD.RESEND) {
    const bytes = new Uint8Array(5);
    const view = new DataView(bytes.buffer);
    bytes[0] = command;
    view.setUint16(1, arg1, true);
    view.setUint16(3, arg2, true);
    return bytes;
  }
  return new Uint8Array([command]);
}

export function parseRawChunk(dataView) {
  if (!(dataView instanceof DataView) || dataView.byteLength < 4) return null;
  const type = dataView.getUint8(0);
  const index = dataView.getUint16(1, true);
  const length = dataView.getUint8(3);
  if (dataView.byteLength < 4 + length) return null;
  const payload = new Uint8Array(length);
  for (let i = 0; i < length; i++) payload[i] = dataView.getUint8(4 + i);
  return { type, index, length, payload };
}

export function parseRawStatus(chunk) {
  if (!chunk || chunk.type !== RAW_CHUNK.STATUS || chunk.length < 12) return null;
  const view = new DataView(chunk.payload.buffer, chunk.payload.byteOffset, chunk.payload.byteLength);
  return {
    state: view.getUint8(0),
    errorCode: view.getUint8(1),
    armPercent: view.getUint8(2),
    capacityReduced: (view.getUint8(3) & 0x01) !== 0,
    autoStopped: (view.getUint8(3) & 0x02) !== 0,
    sampleCount: view.getUint32(4, true),
    capacitySamples: view.getUint32(8, true),
  };
}

export function parseRawInfo(chunk) {
  if (!chunk || (chunk.type !== RAW_CHUNK.INFO && chunk.type !== RAW_CHUNK.DONE) || chunk.length < 8) return null;
  const view = new DataView(chunk.payload.buffer, chunk.payload.byteOffset, chunk.payload.byteLength);
  return {
    payloadSize: view.getUint16(0, true),
    totalChunks: view.getUint16(2, true),
    totalBytes: view.getUint32(4, true),
  };
}

// Reassembles the byte stream from (possibly lost, duplicated, reordered) DATA chunks.
export class RawDownload {
  constructor() {
    this.chunks = new Map();
    this.info = null;
    this.duplicates = 0;
    this.invalid = 0;
  }

  setInfo(info) {
    if (!info || info.payloadSize <= 0 || info.totalChunks <= 0) return false;
    this.info = info;
    // Drop any chunk that cannot belong to this stream.
    for (const [index, bytes] of [...this.chunks]) {
      if (!this.#validLength(index, bytes.length)) {
        this.chunks.delete(index);
        this.invalid += 1;
      }
    }
    return true;
  }

  #validLength(index, length) {
    if (!this.info) return true;
    const { payloadSize, totalChunks, totalBytes } = this.info;
    if (index >= totalChunks) return false;
    const expected = index === totalChunks - 1 ? totalBytes - payloadSize * (totalChunks - 1) : payloadSize;
    return length === expected;
  }

  // Returns true if the chunk was new.
  addChunk(index, bytes) {
    if (!this.#validLength(index, bytes.length)) {
      this.invalid += 1;
      return false;
    }
    if (this.chunks.has(index)) {
      this.duplicates += 1;
      return false;
    }
    this.chunks.set(index, bytes);
    return true;
  }

  get received() {
    return this.chunks.size;
  }

  get total() {
    return this.info ? this.info.totalChunks : null;
  }

  // Missing chunk indexes as contiguous ranges [{ first, count }]; null until info is known.
  missingRanges() {
    if (!this.info) return null;
    const ranges = [];
    let start = null;
    for (let i = 0; i < this.info.totalChunks; i++) {
      const missing = !this.chunks.has(i);
      if (missing && start === null) start = i;
      if (!missing && start !== null) {
        ranges.push({ first: start, count: i - start });
        start = null;
      }
    }
    if (start !== null) ranges.push({ first: start, count: this.info.totalChunks - start });
    return ranges;
  }

  get complete() {
    return Boolean(this.info) && this.chunks.size === this.info.totalChunks;
  }

  assemble() {
    if (!this.complete) throw new Error("Download is not complete.");
    const out = new Uint8Array(this.info.totalBytes);
    for (let i = 0; i < this.info.totalChunks; i++) {
      out.set(this.chunks.get(i), i * this.info.payloadSize);
    }
    return out;
  }
}

function readFloats(view, offset) {
  return [0, 1, 2].map((i) => view.getFloat32(offset + i * 4, true));
}

// Parses the assembled stream (version 2): [headerLen u16][header][blocks].
// A block is [SENSORTIME u32 (24-bit) of its first sample][up to blockSamples x 12-byte samples].
// t_s = IMU time of the block start (24-bit SENSORTIME, unwrapped, x 39.0625 us) + position / sampleRateHz
// inside the block (nominal spacing; polling jitter is not visible within a block).
export function parseRawStream(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 2) throw new Error("Raw stream too short.");
  const headerLength = view.getUint16(0, true);
  if (bytes.byteLength < 2 + headerLength || headerLength < 40) throw new Error("Raw header truncated.");
  let o = 2;
  const version = view.getUint8(o); o += 1;
  if (version !== 2) throw new Error(`Unsupported raw stream version ${version}.`);
  const sampleCount = view.getUint32(o, true); o += 4;
  const sampleRateHz = view.getUint16(o, true); o += 2;
  const accelRangeG = view.getUint8(o); o += 1;
  const gyroRangeDps = view.getUint16(o, true); o += 2;
  const blockSamples = view.getUint8(o); o += 1;
  const gyroBiasDps = readFloats(view, o); o += 12;
  const gravityMs2 = readFloats(view, o); o += 12;
  const repCount = view.getUint16(o, true); o += 2;
  const sensortimeBase = view.getUint32(o, true); o += 4;
  const fwLength = view.getUint8(o); o += 1;
  let fwVersion = "";
  for (let i = 0; i < fwLength && o + i < 2 + headerLength; i++) fwVersion += String.fromCharCode(view.getUint8(o + i));
  if (blockSamples < 1) throw new Error("Invalid block size.");
  const dataStart = 2 + headerLength;
  const blocks = Math.ceil(sampleCount / blockSamples);
  if (bytes.byteLength < dataStart + blocks * 4 + sampleCount * RAW_SAMPLE_BYTES) throw new Error("Raw samples truncated.");
  const header = { sampleCount, sampleRateHz, accelRangeG, gyroRangeDps, blockSamples, gyroBiasDps, gravityMs2, repCount, sensortimeBase, fwVersion };

  const accelScale = G_TO_MS2 / (ACCEL_LSB_PER_G[accelRangeG] ?? 32768 / accelRangeG);
  const gyroScale = 1 / (GYRO_LSB_PER_DPS[gyroRangeDps] ?? 32768 / gyroRangeDps);
  const samples = [];
  let p = dataStart;
  let previousBlockTime = null;
  let cumulative = 0;   // SENSORTIME LSBs since the first block, 24-bit wrap handled
  for (let b = 0; b < blocks; b++) {
    const blockTime = view.getUint32(p, true) & 0xFFFFFF;
    p += 4;
    if (previousBlockTime !== null) cumulative += (blockTime - previousBlockTime) & 0xFFFFFF;
    previousBlockTime = blockTime;
    const inBlock = Math.min(blockSamples, sampleCount - b * blockSamples);
    for (let k = 0; k < inBlock; k++) {
      samples.push({
        t_s: cumulative * SENSORTIME_US_PER_LSB * 1e-6 + k / sampleRateHz,
        ax: view.getInt16(p + 6, true) * accelScale,
        ay: view.getInt16(p + 8, true) * accelScale,
        az: view.getInt16(p + 10, true) * accelScale,
        gx: view.getInt16(p, true) * gyroScale,
        gy: view.getInt16(p + 2, true) * gyroScale,
        gz: view.getInt16(p + 4, true) * gyroScale,
      });
      p += RAW_SAMPLE_BYTES;
    }
  }
  return { header, samples };
}

function clean(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim();
}

function triple(values) {
  return values.map((v) => Number(v.toFixed(6))).join(";");
}

export const RAW_CSV_COLUMNS = ["t_s", "ax", "ay", "az", "gx", "gy", "gz"];

// Raw CSV v1: `# key: value` header lines, then `t_s,ax,ay,az,gx,gy,gz`.
// Values are RAW converted to units (bias NOT subtracted).
export function buildRawCsv({ header, samples }, meta = {}) {
  const lines = [
    "# format: liftiq-raw v1",
    `# fw_version: ${clean(header.fwVersion)}`,
    `# device_name: ${clean(meta.deviceName)}`,
    `# app_version: ${APP_VERSION}`,
    `# captured_at: ${clean(meta.capturedAt)}`,
    `# sample_rate_hz: ${header.sampleRateHz}`,
    `# accel_range_g: ${header.accelRangeG}`,
    `# gyro_range_dps: ${header.gyroRangeDps}`,
    "# accel_units: m/s^2",
    "# gyro_units: deg/s",
    `# gyro_bias_dps: ${triple(header.gyroBiasDps)}`,
    `# gravity_ms2: ${triple(header.gravityMs2)}`,
    `# rep_count_firmware: ${header.repCount}`,
    `# dropped_chunks: ${meta.droppedChunks ?? 0}`,
    `# exercise: ${clean(meta.exercise)}`,
    `# load_kg: ${clean(meta.loadKg)}`,
    `# known_rom_cm: ${clean(meta.knownRomCm)}`,
    `# notes: ${clean(meta.notes)}`,
    RAW_CSV_COLUMNS.join(","),
  ];
  for (const s of samples) {
    lines.push([s.t_s.toFixed(6), s.ax.toFixed(4), s.ay.toFixed(4), s.az.toFixed(4),
      s.gx.toFixed(4), s.gy.toFixed(4), s.gz.toFixed(4)].join(","));
  }
  return lines.join("\n") + "\n";
}
