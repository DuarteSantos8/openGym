import Foundation
import Capacitor
#if canImport(CoreNFC)
import CoreNFC
#endif

/**
 * openGym's NFC stickers (lib/nfc.js, components/Nfc.jsx): writes one openGym link onto a sticker
 * with Core NFC's own sheet ("Hold the top of your iPhone near the sticker").
 *
 * Our own stickers need no read here: an iPhone XS or newer reads NDEF stickers in the background,
 * and the https://opengym.ch/nfc link on ours comes back to the page as opengym://nfc?... (through
 * opengym.ch/nfc, or straight away once opengym.ch is an associated domain), via @capacitor/app.
 *
 * A machine's tag (lib/nfc.js readMachineTagOnce) is read on demand with NFCTagReaderSession: its
 * uid and its URI and text records come back as text. A tag is untrusted: nothing here opens,
 * writes or acts on what it holds.
 *
 * Only NDEF stickers: no card emulation, nothing reads or copies a gym's access card.
 *
 * Usage from JS:
 *   const NfcTags = registerPlugin('NfcTags')
 *   await NfcTags.isAvailable()     // { supported, enabled }
 *   await NfcTags.write({ url, alert: 'Hold the top…', done: 'Sticker ready.' })
 *   await NfcTags.read({ alert: 'Hold your phone…' })  // { uid, records: [{ type: 'uri'|'text', value }] }
 *   await NfcTags.cancel()          // ends a write or a read
 * A failed write rejects with code cancelled | read-only | too-small | unsupported | failed.
 * A failed read rejects with code cancelled | unsupported | failed. Only one of them runs at a time.
 */
@objc(NfcTagsPlugin)
public class NfcTagsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NfcTagsPlugin"
    public let jsName = "NfcTags"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
    ]

    #if canImport(CoreNFC)
    private var session: NFCNDEFReaderSession?
    private var pending: CAPPluginCall?
    private var message: NFCNDEFMessage?
    private var doneText = ""
    // The machine-tag read: its own session and call, apart from the write's.
    private var tagSession: NFCTagReaderSession?
    private var readPending: CAPPluginCall?
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
            self.endRead("replaced by a write")
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

    @objc func read(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        guard NFCTagReaderSession.readingAvailable else {
            call.reject("this iPhone cannot read NFC tags", "unsupported")
            return
        }
        let alert = call.getString("alert") ?? ""
        DispatchQueue.main.async {
            // One at a time: a write or an older read in progress ends here.
            self.settle(code: "cancelled", why: "replaced by a read")
            self.session?.invalidate()
            self.session = nil
            self.endRead("replaced by a newer read")
            self.readPending = call
            self.tagSession = NFCTagReaderSession(pollingOption: [.iso14443, .iso15693], delegate: self, queue: nil)
            guard let s = self.tagSession else {
                self.settleRead(code: "failed", why: "could not start reading")
                return
            }
            if !alert.isEmpty { s.alertMessage = alert }
            s.begin()
        }
        #else
        call.reject("this iPhone cannot read NFC tags", "unsupported")
        #endif
    }

    @objc func cancel(_ call: CAPPluginCall) {
        #if canImport(CoreNFC)
        DispatchQueue.main.async {
            self.settle(code: "cancelled", why: "cancelled")
            self.session?.invalidate()
            self.session = nil
            self.endRead("cancelled")
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

    /// Ends the waiting read once: resolved with what the tag held, rejected with a code.
    private func settleRead(code: String?, why: String = "", result: [String: Any] = [:]) {
        guard let call = readPending else { return }
        readPending = nil
        if let code = code { call.reject(why, code) } else { call.resolve(result) }
    }

    /// Cancels a read in progress, if any, and closes its sheet (main queue).
    private func endRead(_ why: String) {
        settleRead(code: "cancelled", why: why)
        tagSession?.invalidate()
        tagSession = nil
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

#if canImport(CoreNFC)
extension NfcTagsPlugin: NFCTagReaderSessionDelegate {
    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        // Only Cancel on the sheet is cancelled; a timeout fails, so the page offers the QR code.
        // Our own invalidate after a read ends here too, settled by then.
        let cancelled = (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorUserCanceled
        DispatchQueue.main.async {
            // A session replaced by a newer read ends later: its end is not the new one's.
            guard self.tagSession === session else { return }
            self.tagSession = nil
            self.settleRead(code: cancelled ? "cancelled" : "failed", why: error.localizedDescription)
        }
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard tags.count == 1, let tag = tags.first else {
            // Two tags at once: wait for one.
            DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(500)) { session.restartPolling() }
            return
        }
        let uid: Data
        let ndef: NFCNDEFTag?
        switch tag {
        case .miFare(let t): uid = t.identifier; ndef = t
        case .iso15693(let t): uid = t.identifier; ndef = t
        case .iso7816(let t): uid = t.identifier; ndef = t
        case .feliCa(let t): uid = t.currentIDm; ndef = t
        @unknown default: uid = Data(); ndef = nil
        }
        let hex = uid.map { String(format: "%02x", $0) }.joined()
        session.connect(to: tag) { error in
            if let error = error { self.failRead(session, error.localizedDescription); return }
            guard let ndef = ndef else { self.finishRead(session, uid: hex, records: []); return }
            ndef.queryNDEFStatus { status, _, error in
                // An unformatted or empty tag still has its uid.
                if error != nil || status == .notSupported { self.finishRead(session, uid: hex, records: []); return }
                ndef.readNDEF { message, error in
                    guard error == nil, let message = message else { self.finishRead(session, uid: hex, records: []); return }
                    self.finishRead(session, uid: hex, records: NfcTagsPlugin.textRecords(message))
                }
            }
        }
    }

    /// URI and text records as plain strings: at most 8, each 1 to 512 characters, the rest ignored.
    static func textRecords(_ message: NFCNDEFMessage) -> [[String: String]] {
        var out: [[String: String]] = []
        for payload in message.records {
            if out.count >= 8 { break }
            if let uri = payload.wellKnownTypeURIPayload()?.absoluteString {
                if (1...512).contains(uri.count) { out.append(["type": "uri", "value": uri]) }
            } else if let text = payload.wellKnownTypeTextPayload().0 {
                if (1...512).contains(text.count) { out.append(["type": "text", "value": text]) }
            }
        }
        return out
    }

    /// Resolves the read once and closes the sheet.
    private func finishRead(_ session: NFCTagReaderSession, uid: String, records: [[String: String]]) {
        DispatchQueue.main.async {
            guard self.tagSession === session else { session.invalidate(); return }
            self.settleRead(code: nil, result: ["uid": uid, "records": records])
            session.invalidate()
        }
    }

    /// Fails the read and closes the sheet with a short reason.
    private func failRead(_ session: NFCTagReaderSession, _ why: String) {
        DispatchQueue.main.async {
            if self.tagSession === session { self.settleRead(code: "failed", why: why) }
            session.invalidate(errorMessage: why)
        }
    }
}
#endif
