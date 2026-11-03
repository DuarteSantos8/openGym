import Foundation
import Capacitor
#if canImport(CoreNFC)
import CoreNFC
#endif

/**
 * openGym's NFC stickers (lib/nfc.js, components/Nfc.jsx): writes one openGym link onto a sticker
 * with Core NFC's own sheet ("Hold the top of your iPhone near the sticker").
 *
 * Reading needs nothing here: an iPhone XS or newer reads NDEF stickers in the background, and the
 * https://opengym.ch/nfc link on ours comes back to the page as opengym://nfc?... (through
 * opengym.ch/nfc, or straight away once opengym.ch is an associated domain), via @capacitor/app.
 *
 * Only NDEF stickers: no card emulation, nothing reads or copies a gym's access card.
 *
 * Usage from JS:
 *   const NfcTags = registerPlugin('NfcTags')
 *   await NfcTags.isAvailable()     // { supported, enabled }
 *   await NfcTags.write({ url, alert: 'Hold the top…', done: 'Sticker ready.' })
 *   await NfcTags.cancel()
 * A failed write rejects with code cancelled | read-only | too-small | unsupported | failed.
 */
@objc(NfcTagsPlugin)
public class NfcTagsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NfcTagsPlugin"
    public let jsName = "NfcTags"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    #if canImport(CoreNFC)
    private var session: NFCNDEFReaderSession?
    private var pending: CAPPluginCall?
    private var message: NFCNDEFMessage?
    private var doneText = ""
    #endif

    @objc func isAvailable(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        let ok = NFCNDEFReaderSession.readingAvailable
        call.resolve(["supported": ok, "enabled": ok])
        #else
        call.resolve(["supported": false, "enabled": false])
        #endif
    }

    @objc func write(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        guard NFCNDEFReaderSession.readingAvailable else {
            call.reject("this iPhone cannot write NFC stickers", "unsupported")
            return
        }
        guard let url = call.getString("url"), !url.isEmpty, url.count <= 512,
              let record = NFCNDEFPayload.wellKnownTypeURIPayload(string: url) else {
            call.reject("url is required", "failed")
            return
        }
        let alert = call.getString("alert") ?? ""
        let done = call.getString("done") ?? ""
        DispatchQueue.main.async {
            self.settle(code: "cancelled", why: "replaced by a newer write")
            self.session?.invalidate()
            self.pending = call
            self.message = NFCNDEFMessage(records: [record])
            self.doneText = done
            let s = NFCNDEFReaderSession(delegate: self, queue: nil, invalidateAfterFirstRead: false)
            if !alert.isEmpty { s.alertMessage = alert }
            self.session = s
            s.begin()
        }
        #else
        call.reject("this iPhone cannot write NFC stickers", "unsupported")
        #endif
    }

    @objc func cancel(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        DispatchQueue.main.async {
            self.settle(code: "cancelled", why: "cancelled")
            self.session?.invalidate()
            self.session = nil
            call.resolve()
        }
        #else
        call.resolve()
        #endif
    }

    #if canImport(CoreNFC)
    /// Ends the waiting call once: resolved without a code, rejected with one.
    private func settle(code: String?, why: String = "") {
        guard let call = pending else { return }
        pending = nil
        message = nil
        if let code = code { call.reject(why, code) } else { call.resolve(["written": true]) }
    }

    /// Fails the write and closes the sheet with a short reason.
    private func fail(_ session: NFCNDEFReaderSession, _ code: String, _ why: String) {
        DispatchQueue.main.async {
            self.settle(code: code, why: why)
            session.invalidate(errorMessage: why)
        }
    }
    #endif
}

#if canImport(CoreNFC)
extension NfcTagsPlugin: NFCNDEFReaderSessionDelegate {
    public func readerSessionDidBecomeActive(_ session: NFCNDEFReaderSession) {}

    public func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        // Cancel on the sheet, its timeout, or our own invalidate after a write (settled by then).
        let code = (error as? NFCReaderError)?.code
        let cancelled = code == .readerSessionInvalidationErrorUserCanceled || code == .readerSessionInvalidationErrorSessionTimeout
        DispatchQueue.main.async {
            // A session replaced by a newer write ends later: its end is not the new one's.
            guard self.session === session else { return }
            self.session = nil
            self.settle(code: cancelled ? "cancelled" : "failed", why: error.localizedDescription)
        }
    }

    // Required, never used: a session with tag detection gets didDetect tags instead.
    public func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    public func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard tags.count == 1, let tag = tags.first else {
            // Two stickers at once: wait for one.
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(500)) { session.restartPolling() }
            return
        }
        session.connect(to: tag) { error in
            if let error = error { self.fail(session, "failed", error.localizedDescription); return }
            tag.queryNDEFStatus { status, capacity, error in
                if let error = error { self.fail(session, "failed", error.localizedDescription); return }
                DispatchQueue.main.async {
                    guard let message = self.message else { session.invalidate(); return }
                    switch status {
                    case .notSupported: self.fail(session, "unsupported", "This sticker can't hold a link.")
                    case .readOnly: self.fail(session, "read-only", "This sticker is locked.")
                    case .readWrite:
                        if capacity < message.length { self.fail(session, "too-small", "This sticker is too small."); return }
                        tag.writeNDEF(message) { error in
                            if let error = error { self.fail(session, "failed", error.localizedDescription); return }
                            DispatchQueue.main.async {
                                if !self.doneText.isEmpty { session.alertMessage = self.doneText }
                                self.settle(code: nil)
                                session.invalidate()
                            }
                        }
                    @unknown default: self.fail(session, "failed", "Unknown sticker.")
                    }
                }
            }
        }
    }
}
#endif
