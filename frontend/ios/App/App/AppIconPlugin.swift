import Foundation
import Capacitor
import UIKit

/**
 * The home-screen icon (Settings → Look & Home → App icon, lib/app-icon.js). The alternate icons
 * are AppIcon sets in Assets.xcassets, named in ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES so
 * the asset compiler writes their sizes and CFBundleAlternateIcons into the built Info.plist. The
 * ids and set names are the ones in src/lib/app-icon-variants.js (scripts/app-icons.mjs).
 *
 * iOS confirms the switch with its own alert ("You have changed the icon for openGym"); an app
 * cannot leave it out.
 *
 * Usage from JS:
 *   const AppIcon = registerPlugin('AppIcon')
 *   await AppIcon.getIcon()                  // { supported: true, name: 'default' }
 *   await AppIcon.setIcon({ name: 'sky' })   // { name: 'sky' }
 */
@objc(AppIconPlugin)
public class AppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIconPlugin"
    public let jsName = "AppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setIcon", returnType: CAPPluginReturnPromise),
    ]

    /// Icon id → alternate icon name; the original is the primary icon (nil).
    static let icons: [String: String] = [
        "light": "AppIcon-Light",
        "mono": "AppIcon-Mono",
        "neon": "AppIcon-Neon",
        "sky": "AppIcon-Sky",
        "orange": "AppIcon-Orange",
        "pink": "AppIcon-Pink",
        "violet": "AppIcon-Violet",
        "halloween": "AppIcon-Halloween",
    ]

    static func id(for iconName: String?) -> String {
        guard let iconName = iconName else { return "default" }
        return icons.first(where: { $0.value == iconName })?.key ?? "default"
    }

    @objc func getIcon(_ call: CAPPluginCall) {
        // UIApplication is main-thread only; plugin calls arrive on a background queue.
        DispatchQueue.main.async {
            let app = UIApplication.shared
            call.resolve([
                "supported": app.supportsAlternateIcons,
                "name": AppIconPlugin.id(for: app.alternateIconName),
            ])
        }
    }

    @objc func setIcon(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), name == "default" || AppIconPlugin.icons[name] != nil else {
            call.reject("unknown icon")
            return
        }
        let target = name == "default" ? nil : AppIconPlugin.icons[name]
        DispatchQueue.main.async {
            let app = UIApplication.shared
            guard app.supportsAlternateIcons else {
                call.reject("alternate icons are not supported")
                return
            }
            // Setting the icon already in use would still show the system alert.
            if app.alternateIconName == target {
                call.resolve(["name": name])
                return
            }
            app.setAlternateIconName(target) { error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["name": name])
                }
            }
        }
    }
}
