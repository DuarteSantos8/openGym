// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
import { NOTIFY_HZ, PHASE_NAMES, createSessionCsv, decodeTelemetry } from "./protocol.js";

// Explicit capture state machine. No DOM, no Web Bluetooth: everything it
// touches is injected (ble client, storage, clock), so it is unit-testable.
//
// States:   disconnected, idle (connected, ready), calibrating, recording,
//           paused, reviewing, saving.
// UI events: bleConnected, bleDisconnected, startSet, pause, resume, stop,
//           retryCalibration, continueSet, saveReview, dismissSaved.
// BLE events: onReading(reading, { seq, dropped }) for EVERY decoded packet.
//
// Calibration is derived from the persistent status byte of any packet
// (firmwareStatus 2 = calibrated/tracking), so one lost notification cannot
// desync app and firmware, and a timeout never strands the user: Stop/Cancel
// and Retry stay available, and a late status 2 is offered as "Continue".

export const STATES = Object.freeze({
  DISCONNECTED: "disconnected",
  IDLE: "idle",
  CALIBRATING: "calibrating",
  RECORDING: "recording",
  PAUSED: "paused",
  REVIEWING: "reviewing",
  SAVING: "saving",
});

export const CALIBRATION_TIMEOUT_MS = 15000;
// Firmware calibrates for ~5 s. A status 2 seen earlier than this after the
// start command without ever seeing status 1 must be left over from before.
export const MIN_CALIBRATION_MS = 4000;
export const START_COMMAND = new Uint8Array([0x01]);

const FIRMWARE = Object.freeze({ NONE: 0, CALIBRATING: 1, CALIBRATED: 2, FAILED: 3 });

const defaultClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id),
};

export class SessionMachine {
  constructor({ ble, storage, clock = defaultClock, uuid, log = () => {}, calibrationTimeoutMs = CALIBRATION_TIMEOUT_MS, minCalibrationMs = MIN_CALIBRATION_MS, isBlocked = () => false } = {}) {
    this.isBlocked = isBlocked;
    this.ble = ble;
    this.storage = storage;
    this.clock = clock;
    this.uuid = uuid || (() => globalThis.crypto.randomUUID());
    this.log = log;
    this.calibrationTimeoutMs = calibrationTimeoutMs;
    this.minCalibrationMs = minCalibrationMs;

    this.state = STATES.DISCONNECTED;
    this.connected = false;
    this.firmwareStatus = null;   // last status byte seen, null before any packet
    this.session = null;
    this.latestRepCount = 0;
    this.latestPhase = 0;
    this.stalled = false;
    this.canContinue = false;
    this.calibrationStartedAt = null;
    this.sawCalibrating = false;
    this.stopping = false;
    this.message = "";
    this.error = "";
    this.lastSaved = null;
    this.timer = null;
    this.listeners = new Set();
  }

  // ---- observation -------------------------------------------------------
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot() {
    const inSet = [STATES.CALIBRATING, STATES.RECORDING, STATES.PAUSED].includes(this.state);
    return {
      state: this.state,
      connected: this.connected,
      firmwareStatus: this.firmwareStatus,
      calibrated: this.connected && this.firmwareStatus === FIRMWARE.CALIBRATED,
      stalled: this.stalled,
      canContinue: this.canContinue,
      calibrationStartedAt: this.calibrationStartedAt,
      calibrationTimeoutMs: this.calibrationTimeoutMs,
      repCount: this.latestRepCount,
      phase: this.latestPhase,
      session: this.session,
      message: this.message,
      error: this.error,
      lastSaved: this.lastSaved,
      canStart: this.state === STATES.IDLE && this.connected && !this.isBlocked(),
      canPause: this.state === STATES.RECORDING && !this.stopping,
      canResume: this.state === STATES.PAUSED && !this.stopping,
      canStop: inSet && !this.stopping,
      canRetry: this.state === STATES.CALIBRATING && this.connected,
      stopLabel: this.state === STATES.CALIBRATING ? "Cancel" : "Stop set",
    };
  }

  _emit() {
    const snap = this.snapshot();
    for (const listener of [...this.listeners]) listener(snap);
  }

  _set(state, message) {
    const previous = this.state;
    this.state = state;
    if (message !== undefined) this.message = message;
    if (previous !== state) this.log(`[session] ${previous} -> ${state}`);
    this._emit();
  }

  _clearTimer() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  _idleState() {
    return this.connected ? STATES.IDLE : STATES.DISCONNECTED;
  }

  // ---- BLE events --------------------------------------------------------
  bleConnected() {
    this.connected = true;
    this.firmwareStatus = null;
    this.error = "";
    if (this.state === STATES.DISCONNECTED) {
      this._set(STATES.IDLE, "Ready when you are. Start a set to calibrate the sensor.");
    } else {
      this._emit();
    }
  }

  bleDisconnected() {
    this.connected = false;
    this.firmwareStatus = null;
    this.canContinue = false;
    switch (this.state) {
      case STATES.RECORDING:
      case STATES.PAUSED:
        this._clearTimer();
        this._enterReview("Sensor disconnected. Review the rep count to save captured data.");
        break;
      case STATES.CALIBRATING:
        this._clearTimer();
        this.session = null;
        this.stalled = false;
        this._set(STATES.DISCONNECTED, "Connection lost before the set started. Reconnect and try again.");
        break;
      case STATES.IDLE:
        this._set(STATES.DISCONNECTED, "Sensor disconnected.");
        break;
      default:
        this._emit(); // reviewing / saving / already disconnected
    }
  }

  onReading(reading, { seq = null, dropped = 0 } = {}) {
    if (reading.calibrationCode !== undefined && reading.calibrationCode !== null) {
      this.firmwareStatus = reading.calibrationCode;
    }
    switch (this.state) {
      case STATES.CALIBRATING:
        this._calibrationProgress(reading.calibrationCode);
        break;
      case STATES.RECORDING:
        this._recordSample(reading, seq, dropped);
        break;
      case STATES.PAUSED:
        // Reps are physical: keep tracking the firmware count while paused.
        // No samples are logged; the count at resume/stop is the firmware's.
        this.latestRepCount = reading.repCount;
        this.latestPhase = reading.phase;
        this._emit();
        break;
      default:
        this._emit();
    }
  }

  _recordSample(reading, seq, dropped) {
    this.latestRepCount = reading.repCount;
    this.latestPhase = reading.phase;
    if (!this.stopping && this.session?.startedAt) {
      const arrival = (this.clock.now() - new Date(this.session.startedAt).getTime()) / 1000;
      // Sensor time from the unwrapped sequence counter (deterministic 50 Hz); legacy
      // packets without seq fall back to arrival time. arrival_s is kept as a last column.
      let elapsed = arrival;
      if (seq !== null && seq !== undefined) {
        if (this.session.firstSeq === undefined) this.session.firstSeq = seq;
        elapsed = (seq - this.session.firstSeq) / NOTIFY_HZ;
      }
      this.session.samples.push({
        elapsed_s: Number(elapsed.toFixed(3)),
        arrival_s: Number(arrival.toFixed(3)),
        ax_m_s2: reading.ax,
        ay_m_s2: reading.ay,
        az_m_s2: reading.az,
        total_accel_m_s2: reading.totalAccel,
        dynamic_accel_m_s2: reading.dynamicAccel,
        phase: PHASE_NAMES[reading.phase],
        phase_id: reading.phase,
        rep_count: reading.repCount,
        seq,
      });
      this.session.sampleCount = this.session.samples.length;
      this.session.droppedPackets += dropped;
      this.session.repCount = reading.repCount;
    }
    this._emit();
  }

  _calibrationProgress(code) {
    if (code === FIRMWARE.CALIBRATING) {
      this.sawCalibrating = true;
      this._emit();
      return;
    }
    if (code === FIRMWARE.FAILED) {
      this._clearTimer();
      this.session = null;
      this.stalled = false;
      this.canContinue = false;
      this.error = "The sensor could not complete its calibration.";
      this._set(this._idleState(), "Calibration failed. Check the sensor and try again.");
      return;
    }
    if (code === FIRMWARE.CALIBRATED) {
      const waited = this.clock.now() - this.calibrationStartedAt;
      const genuine = this.sawCalibrating || waited >= this.minCalibrationMs;
      if (!genuine) return; // leftover status from a previous calibration
      if (this.stalled) {
        // Timed out earlier, but the firmware is in fact tracking: offer to go on.
        this.canContinue = true;
        this.message = "The sensor finished calibrating and is counting reps. Continue the set, or cancel.";
        this._emit();
      } else {
        this._calibrationComplete();
      }
    }
  }

  _calibrationComplete() {
    this._clearTimer();
    this.stalled = false;
    this.canContinue = false;
    if (!this.session) {
      this._set(STATES.IDLE, "Calibration complete. The sensor is ready for your next set.");
      return;
    }
    this.session.startedAt = new Date(this.clock.now()).toISOString();
    this.latestRepCount = 0;
    this._set(STATES.RECORDING, "Calibration complete. Recording your set.");
  }

  // ---- UI events ---------------------------------------------------------
  async startSet({ exercise = "", sensorName = "", calibrateOnly = false } = {}) {
    if (!this.snapshot().canStart) return false;
    this.error = "";
    this.lastSaved = null;
    this.session = calibrateOnly ? null : {
      id: this.uuid(),
      createdAt: new Date(this.clock.now()).toISOString(),
      startedAt: null,
      exercise: exercise.trim() || "Workout set",
      sensorName,
      samples: [],
      repCount: 0,
      sampleCount: 0,
      droppedPackets: 0,
    };
    this.latestRepCount = 0;
    this.latestPhase = 0;
    return this._sendCalibrationStart(true);
  }

  // Train flow: no firmware calibration (no 0x01 command). Gravity is derived from the recorded data by
  // analysis/pulses.js, stillness is checked by ready-check.js before this is called. The legacy
  // startSet() path stays for the Lab and for older flows.
  startWithoutCalibration({ exercise = "", sensorName = "" } = {}) {
    if (!this.snapshot().canStart) return false;
    this.error = "";
    this.lastSaved = null;
    const now = new Date(this.clock.now()).toISOString();
    this.session = {
      id: this.uuid(),
      createdAt: now,
      startedAt: now,
      exercise: exercise.trim() || "Workout set",
      sensorName,
      samples: [],
      repCount: 0,
      sampleCount: 0,
      droppedPackets: 0,
    };
    this.latestRepCount = 0;
    this.latestPhase = 0;
    this._set(STATES.RECORDING, "Recording your set.");
    return true;
  }

  // Throw the current set away (calibration or recording) and return to idle. The UI confirms first.
  abort() {
    if (![STATES.CALIBRATING, STATES.RECORDING, STATES.PAUSED].includes(this.state)) return false;
    this._clearTimer();
    this.session = null;
    this.stalled = false;
    this.canContinue = false;
    this.stopping = false;
    this._set(this._idleState(), "Set cancelled.");
    return true;
  }

  async retryCalibration() {
    if (!this.snapshot().canRetry) return false;
    this.error = "";
    return this._sendCalibrationStart(false);
  }

  async _sendCalibrationStart(enterState) {
    this.stalled = false;
    this.canContinue = false;
    this.sawCalibrating = false;
    this.calibrationStartedAt = this.clock.now();
    this._clearTimer();
    this.timer = this.clock.setTimeout(() => this._onCalibrationTimeout(), this.calibrationTimeoutMs);
    if (enterState) this._set(STATES.CALIBRATING, "Calibrating — keep the sensor still…");
    else { this.message = "Calibrating — keep the sensor still…"; this._emit(); }
    try {
      await this.ble.write(START_COMMAND);
      return true;
    } catch (error) {
      this._clearTimer();
      this.session = null;
      this.error = `Start command failed: ${error.message}`;
      this._set(this._idleState(), "Could not start calibration.");
      return false;
    }
  }

  _onCalibrationTimeout() {
    this.timer = null;
    if (this.state !== STATES.CALIBRATING) return;
    this.stalled = true;
    // The firmware status byte may already say calibrated (the old failure case).
    const trackingAlready = this.firmwareStatus === FIRMWARE.CALIBRATED && this.sawCalibrating;
    this.canContinue = trackingAlready;
    this.message = trackingAlready
      ? "The sensor finished calibrating and is counting reps. Continue the set, or cancel."
      : "Calibration is taking too long. Retry, or cancel this set.";
    this.log("[session] calibration timeout");
    this._emit();
  }

  continueSet() {
    if (this.state !== STATES.CALIBRATING || !this.canContinue) return false;
    this._calibrationComplete();
    return true;
  }

  pause() {
    if (!this.snapshot().canPause) return false;
    this._set(STATES.PAUSED, "Paused. Samples are not logged, but the sensor keeps counting reps and the live count is what gets saved.");
    return true;
  }

  resume() {
    if (!this.snapshot().canResume) return false;
    this._set(STATES.RECORDING, "Recording set data. Reps counted while paused are included.");
    return true;
  }

  async stop() {
    if (this.stopping) return false;
    if (this.state === STATES.CALIBRATING) {
      this._clearTimer();
      this.session = null;
      this.stalled = false;
      this.canContinue = false;
      this._set(this._idleState(), "Set cancelled. You can start again when ready.");
      return true;
    }
    if (this.state !== STATES.RECORDING && this.state !== STATES.PAUSED) return false;
    this.stopping = true;
    this._emit();
    // One authoritative read of the final rep count; failure must not block stopping.
    if (this.connected) {
      try {
        const finalReading = decodeTelemetry(await this.ble.readValue());
        if (finalReading) this.latestRepCount = finalReading.repCount;
      } catch (error) {
        this.log(`[session] final read failed: ${error.message}`);
      }
    }
    this.stopping = false;
    if (this.state !== STATES.RECORDING && this.state !== STATES.PAUSED) {
      // Disconnected while reading: already in review, just refresh the count.
      if (this.session) this.session.repCount = this.latestRepCount;
      this._emit();
      return true;
    }
    this._enterReview("Review the detected rep count to finish saving this set.");
    return true;
  }

  _enterReview(message) {
    const stoppedAt = new Date(this.clock.now());
    const session = this.session;
    if (!session) {
      this._set(this._idleState(), message);
      return;
    }
    session.stoppedAt = stoppedAt.toISOString();
    session.durationMs = session.startedAt
      ? Math.max(0, stoppedAt.getTime() - new Date(session.startedAt).getTime())
      : 0;
    session.repCount = this.latestRepCount;
    this._set(STATES.REVIEWING, message);
  }

  async saveReview(actualRepCount) {
    if (this.state !== STATES.REVIEWING || !this.session) return false;
    const session = this.session;
    this._set(STATES.SAVING);
    const saved = {
      ...session,
      repCount: actualRepCount,
      sensorRepCount: session.repCount,
      actualRepCount,
      repCountSource: actualRepCount === session.repCount ? "sensor-confirmed" : "user-corrected",
      sampleCount: session.samples.length,
      csv: createSessionCsv(session.samples.length === 0
        ? [{ actual_rep_count: actualRepCount }]
        : session.samples.map((sample) => ({ ...sample, actual_rep_count: actualRepCount }))),
    };
    try {
      await this.storage.save(saved);
    } catch (error) {
      this.error = `Set data is still in memory but was not saved: ${error.message}`;
      this._set(STATES.REVIEWING, "Could not save set history. Retry saving the rep count.");
      return false;
    }
    this.session = null;
    this.lastSaved = { reps: actualRepCount, durationMs: saved.durationMs };
    this._set(this._idleState(), "Set saved on this device.");
    return true;
  }

  // Workout flow hook: hand the captured set over to the workout machine (which does its own
  // analysis, review and storage) and return to idle. Returns the session or null.
  releaseReview() {
    if (this.state !== STATES.REVIEWING || !this.session) return null;
    const session = this.session;
    this.session = null;
    this._set(this._idleState(), "Set captured.");
    return session;
  }

  dismissSaved() {
    this.lastSaved = null;
    this._emit();
  }

  clearError() {
    this.error = "";
    this._emit();
  }
}
