import Foundation
import Capacitor
import UIKit

/**
 * Minimal local Capacitor plugin that hands a self-contained HTML document to the iOS system
 * print sheet (Save to Files as PDF, share, a real printer). The printable plan page
 * (lib/plan-share.js planPrintHTML) reaches a PDF this way without bundling a PDF library —
 * UIKit renders it.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const Print = registerPlugin('Print');
 *   await Print.printHtml({ html: '<!doctype html>…', name: 'Weekly Training Plan' });
 */
@objc(PrintPlugin)
public class PrintPlugin: CAPPlugin {

    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else {
            call.reject("html is required")
            return
        }
        let jobName = call.getString("name") ?? "openGym"

        DispatchQueue.main.async {
            let controller = UIPrintInteractionController.shared

            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = jobName
            controller.printInfo = info

            // The document carries its own @page margins; keep the formatter's own insets at 0
            // so they don't stack on top.
            let formatter = UIMarkupTextPrintFormatter(markupText: html)
            formatter.perPageContentInsets = .zero
            controller.printFormatter = formatter

            controller.present(animated: true) { (_, completed, error) in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["completed": completed])
                }
            }
        }
    }
}
