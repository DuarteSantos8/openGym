import Foundation
import Capacitor
import AuthenticationServices

/**
 * Sign in with the server's identity provider (OIDC) in the system browser
 * (lib/oidc-app.js). ASWebAuthenticationSession shows the provider's page with Safari's cookies
 * and passwords, and catches the way back on the opengym scheme itself, so the code never goes
 * through the app's URL handler where another app could have claimed the scheme.
 *
 * Usage from JS:
 *   const OidcBrowser = registerPlugin('OidcBrowser');
 *   await OidcBrowser.open({ url });   // { url: 'opengym://oidc?...' }; rejects 'cancelled' or 'failed'
 */
@objc(OidcBrowserPlugin)
public class OidcBrowserPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "OidcBrowserPlugin"
    public let jsName = "OidcBrowser"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]
    private var session: ASWebAuthenticationSession?

    @objc func open(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              url.scheme == "https" || url.scheme == "http" else {
            call.reject("not a web address", "failed")
            return
        }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "opengym") { [weak self] back, error in
                self?.session = nil
                if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    call.reject("cancelled", "cancelled")
                    return
                }
                guard error == nil, let back = back, back.host == "oidc" else {
                    call.reject("the sign-in did not come back", "failed", error)
                    return
                }
                call.resolve(["url": back.absoluteString])
            }
            session.presentationContextProvider = self
            // Shares Safari's session, so someone already signed in at the provider is not asked again.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                self.session = nil
                call.reject("the browser could not open", "failed")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
