import Capacitor
import Foundation
import WidgetKit

/**
 * Hands the Home Screen and Lock Screen widgets what they show (lib/widgets.js builds it): a small
 * JSON file in the App Group, which the widget extension reads (OpenGymWidgets), and a nudge to
 * WidgetKit to draw them again. The page only writes when something the widgets show changed.
 *
 * Since v1.4.5 it also hands the page the sets logged on the widget (WidgetLogger in
 * WorkoutActivity.swift, lib/widget-logger.js): drain gives the queue, ack takes out what the
 * page applied and saved, and "widgetEvent" tells an awake page that one came in.
 */
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(queued), name: WidgetLogger.didChange, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    @objc private func queued() {
        notifyListeners("widgetEvent", data: [:])
    }

    @objc func drain(_ call: CAPPluginCall) {
        call.resolve(["events": WidgetLogger.events()])
    }

    @objc func ack(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") as? [String]) ?? []
        WidgetLogger.remove(ids: Set(ids))
        call.resolve()
    }

    static let fileName = "widget.json"

    @objc func write(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else {
            call.reject("json is required")
            return
        }
        guard let dir = OpenGymGroup.container else {
            call.reject("no App Group")
            return
        }
        do {
            try data.write(to: dir.appendingPathComponent(WidgetBridgePlugin.fileName), options: .atomic)
            WidgetCenter.shared.reloadAllTimelines()
            call.resolve()
        } catch {
            call.reject("could not write the widget data")
        }
    }
}
