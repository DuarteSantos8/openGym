// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseRawChunk } from "./raw-protocol.js";
import {
  DEVICE_FILTERS,
  LEGACY_DEVICE_NAME,
  NOTIFY_UUID,
  INFO_UUID,
  RAW_UUID,
  SERVICE_UUID,
  parseInfo,
  WRITE_UUID,
  decodeTelemetry,
  encodeRepThresholds,
} from "./protocol.js";
import { WebBluetoothTransport } from "./web-bluetooth-transport.js";

// LiftIQ BLE client on top of a small BleTransport (see README.md). Notifications stay enabled
// for the whole connection (the battery and calibration indicators need packets even between
// sets). Implements the interface SessionMachine expects: write(bytes), readValue(), isConnected().
// The default transport is Web Bluetooth; pass `transport` to use another one (Capacitor, a fake).
export class BleClient {
  constructor({ onPacket, onInvalidPacket, onDisconnect, onRawChunk = () => {}, transport = new WebBluetoothTransport() }) {
    this.transport = transport;
    this.onRawChunk = onRawChunk;
    this.rawCharacteristic = null;
    this.info = null;
    this.handleRawValue = (dataView) => this.onRawChunk(parseRawChunk(dataView));
    this.onPacket = onPacket;
    this.onInvalidPacket = onInvalidPacket;
    this.onDisconnect = onDisconnect;
    this.device = null;
    this.notifyCharacteristic = null;
    this.writeCharacteristic = null;
    this.offDisconnect = null;
    this.handleValue = (dataView) => {
      const reading = decodeTelemetry(dataView);
      if (reading) this.onPacket(reading, dataView);
      else this.onInvalidPacket?.(dataView);
    };
    this.handleDisconnect = () => {
      this.#teardown();
      this.onDisconnect();
    };
  }

  static isSupported(transport = new WebBluetoothTransport()) {
    return transport.isSupported();
  }

  get name() {
    return this.device?.name || LEGACY_DEVICE_NAME;
  }

  isConnected() {
    return Boolean(this.device) && this.transport.isConnected(this.device);
  }

  async connect() {
    // Must run from a user gesture (Web Bluetooth requirement).
    const device = await this.transport.requestDevice(DEVICE_FILTERS, [SERVICE_UUID]);
    this.device = device;
    this.offDisconnect = this.transport.onDisconnect(device, this.handleDisconnect);
    try {
      await this.transport.connect(device);
      this.notifyCharacteristic = await this.transport.getCharacteristic(device, SERVICE_UUID, NOTIFY_UUID);
      this.writeCharacteristic = await this.transport.getCharacteristic(device, SERVICE_UUID, WRITE_UUID);
      await this.transport.startNotifications(this.notifyCharacteristic, this.handleValue);
      // Research-capture characteristic: absent on older firmware (Lab page then stays disabled).
      try {
        this.rawCharacteristic = await this.transport.getCharacteristic(device, SERVICE_UUID, RAW_UUID);
        await this.transport.startNotifications(this.rawCharacteristic, this.handleRawValue);
      } catch {
        this.rawCharacteristic = null;
      }
      // Optional INFO characteristic (firmware/protocol version). Absent or unreadable on
      // older firmware: that must never fail the connection.
      this.info = null;
      try {
        const infoCharacteristic = await this.transport.getCharacteristic(device, SERVICE_UUID, INFO_UUID);
        this.info = parseInfo(await this.transport.readValue(infoCharacteristic));
      } catch {
        this.info = null;
      }
    } catch (error) {
      this.disconnect();
      this.#teardown();
      throw error;
    }
  }

  disconnect() {
    if (this.device) this.transport.disconnect(this.device);
  }

  #teardown() {
    this.offDisconnect?.();
    this.offDisconnect = null;
    if (this.notifyCharacteristic) void this.transport.stopNotifications(this.notifyCharacteristic);
    if (this.rawCharacteristic) void this.transport.stopNotifications(this.rawCharacteristic);
    this.rawCharacteristic = null;
    this.info = null;
    this.device = null;
    this.notifyCharacteristic = null;
    this.writeCharacteristic = null;
  }

  async write(bytes) {
    if (!this.writeCharacteristic || !this.isConnected()) throw new Error("Sensor is not connected.");
    await this.transport.writeValue(this.writeCharacteristic, bytes);
  }

  get rawSupported() {
    return Boolean(this.rawCharacteristic);
  }

  writeRaw(bytes) {
    return this.write(bytes);
  }

  async readRawStatus() {
    if (!this.rawCharacteristic || !this.isConnected()) return null;
    return parseRawChunk(await this.transport.readValue(this.rawCharacteristic));
  }

  async readValue() {
    if (!this.notifyCharacteristic || !this.isConnected()) throw new Error("Sensor is not connected.");
    return this.transport.readValue(this.notifyCharacteristic);
  }

  async sendThresholds(thresholds) {
    await this.write(encodeRepThresholds(thresholds));
  }
}
