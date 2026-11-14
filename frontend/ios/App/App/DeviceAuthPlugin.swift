import Foundation
import Capacitor
import LocalAuthentication

/**
 * The phone's own screen lock, asked before the app deletes an account its pairing proves
 * (components/DeleteAccount.jsx, lib/device-auth.js). `.deviceOwnerAuthentication` is Face ID or
 * Touch ID, falling back to the passcode, so any phone with a lock can answer it.
 *
 * Usage from JS:
 *   const DeviceAuth = registerPlugin('DeviceAuth');
 *   await DeviceAuth.check();                 // { secure: true } when there is a lock to ask
 *   await DeviceAuth.verify({ reason: '…' }); // resolves once unlocked; rejects with the code
 *                                             // 'cancelled', 'not-secure' (no lock) or 'failed'
 */
@objc(DeviceAuthPlugin)
public class DeviceAuthPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DeviceAuthPlugin"
    public let jsName = "DeviceAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "check", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "verify", returnType: CAPPluginReturnPromise),
    ]

    @objc func check(_ call: CAPPluginCall) {
        var error: NSError?
        let secure = LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: &error)
        call.resolve(["secure": secure])
    }

    @objc func verify(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // No passcode at all is the one case the sheet goes ahead without a lock; anything
            // else that stops the check (a locked-out sensor, say) is a failure.
            let code = (error as? LAError)?.code == .passcodeNotSet ? "not-secure" : "failed"
            call.reject(error?.localizedDescription ?? code, code)
            return
        }
        let reason = call.getString("reason") ?? "Confirm it's you"
        context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, error in
            if ok {
                call.resolve(["verified": true])
                return
            }
            switch (error as? LAError)?.code {
            case .userCancel?, .appCancel?, .systemCancel?:
                call.reject("cancelled", "cancelled")
            case .passcodeNotSet?:
                call.reject("no screen lock", "not-secure")
            default:
                call.reject(error?.localizedDescription ?? "failed", "failed")
            }
        }
    }
}
