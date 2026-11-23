// VENDORED FROM packages/liftiq-sensor@0.1.0 — do not edit (run tools/vendor-sensor.mjs)
// SPDX-License-Identifier: AGPL-3.0-or-later
// Default BleTransport: the browser's Web Bluetooth API (navigator.bluetooth).
// See README.md "Transport interface". `navigator` is only read when a method is called, so
// importing this module in Node (tests, SSR) is safe.

export class WebBluetoothTransport {
  #listeners = new WeakMap(); // characteristic -> notification listener
  #servers = new WeakMap(); // device -> GATT server returned by connect()

  isSupported() {
    return typeof navigator !== "undefined" && Boolean(navigator) && "bluetooth" in navigator;
  }

  // Must run from a user gesture (Web Bluetooth requirement). Returns the BluetoothDevice
  // (an opaque handle for the client; it only relies on `.name`).
  requestDevice(filters, optionalServices) {
    return navigator.bluetooth.requestDevice({ filters, optionalServices });
  }

  async connect(device) {
    this.#servers.set(device, await device.gatt.connect());
  }

  disconnect(device) {
    if (device?.gatt?.connected) device.gatt.disconnect();
  }

  isConnected(device) {
    return Boolean(device?.gatt?.connected);
  }

  // Resolves the primary service and the characteristic in one step. Rejects when either is absent.
  async getCharacteristic(device, serviceUuid, characteristicUuid) {
    const server = this.#servers.get(device) ?? device.gatt;
    const service = await server.getPrimaryService(serviceUuid);
    return service.getCharacteristic(characteristicUuid);
  }

  // Registers `onValue(DataView)` and enables notifications.
  async startNotifications(characteristic, onValue) {
    this.#removeListener(characteristic);
    const listener = (event) => onValue(event.target.value);
    this.#listeners.set(characteristic, listener);
    characteristic.addEventListener("characteristicvaluechanged", listener);
    await characteristic.startNotifications();
  }

  // Removes the listener and (best effort) disables notifications; never throws.
  async stopNotifications(characteristic) {
    this.#removeListener(characteristic);
    try {
      await characteristic.stopNotifications?.();
    } catch {
      // device already gone
    }
  }

  readValue(characteristic) {
    return characteristic.readValue();
  }

  writeValue(characteristic, bytes) {
    return characteristic.writeValue(bytes);
  }

  // Calls `callback()` when the device drops. Returns an unsubscribe function.
  onDisconnect(device, callback) {
    device.addEventListener("gattserverdisconnected", callback);
    return () => device.removeEventListener("gattserverdisconnected", callback);
  }

  #removeListener(characteristic) {
    const listener = this.#listeners.get(characteristic);
    if (listener) characteristic.removeEventListener("characteristicvaluechanged", listener);
    this.#listeners.delete(characteristic);
  }
}
