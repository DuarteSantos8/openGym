import Capacitor
import UIKit

/**
 * The system's vertical bar, for the page (lib/vertical-bar.js). On iPhone Duo's outer display
 * iOS moves the status bar to a column on the side and hands that column to the app as a side
 * safe-area inset; a UITabBar moves into it on its own, the page's tab bar does not. The page asks
 * for the side the bar is on (`left`, `right`, or none) and `top`, where the system's own region
 * in that column (the camera, the clock, the battery) ends, so its tabs can stand below it.
 *
 * MainViewController hands every layout pass to `update(from:)`; a change goes out as a
 * "change" event, kept until the page listens.
 *
 * Usage from JS:
 *   const VerticalBar = registerPlugin('VerticalBar')
 *   await VerticalBar.get()   // { side: 'right', top: 174 } or { side: null, top: 0 }
 */
@objc(VerticalBarPlugin)
public class VerticalBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "VerticalBarPlugin"
    public let jsName = "VerticalBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
    ]

    struct Bar: Equatable {
        var side: String?
        var top: Double

        static let none = Bar(side: nil, top: 0)

        var data: [String: Any] { ["side": side ?? NSNull(), "top": top] }
    }

    private var bar = Bar.none

    @objc func get(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            call.resolve((self?.bar ?? .none).data)
        }
    }

    func update(from view: UIView) {
        let next = VerticalBarPlugin.bar(in: view)
        guard next != bar else { return }
        bar = next
        notifyListeners("change", data: next.data, retainUntilConsumed: true)
    }

    static func bar(in view: UIView) -> Bar {
        #if compiler(>=6.4)
        if #available(iOS 27.1, *) {
            let edge = view.traitCollection.verticalBarEdge
            guard edge != .unspecified else { return .none }
            let rightToLeft = view.effectiveUserInterfaceLayoutDirection == .rightToLeft
            let onRight = (edge == .trailing) != rightToLeft
            let width = onRight ? view.safeAreaInsets.right : view.safeAreaInsets.left
            guard width > 0 else { return .none }
            let bounds = view.bounds
            let column = CGRect(x: onRight ? bounds.maxX - width : bounds.minX, y: bounds.minY, width: width, height: bounds.height)
            let top = view.reservedRegions(kind: .occlusion)
                .map(\.frame)
                .filter { $0.intersects(column) }
                .map(\.maxY)
                .max() ?? view.safeAreaInsets.top
            return Bar(side: onRight ? "right" : "left", top: Double(top))
        }
        #endif
        return .none
    }
}
