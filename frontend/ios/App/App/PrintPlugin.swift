import Foundation
import Capacitor
import UIKit
import WebKit

/**
 * Minimal local Capacitor plugin that hands a self-contained HTML document to the iOS system
 * print sheet (Save to Files as PDF, share, a real printer). The printouts (lib/print-doc.js:
 * the plan, a routine, a workout, the performance report) reach a PDF this way without bundling
 * a PDF library.
 *
 * The page is laid out by an off-screen WKWebView, the same WebKit as the app, so its CSS is
 * honoured: the page-break rules that keep an exercise whole, the inline SVG charts, flex and
 * grid. (UIMarkupTextPrintFormatter, used before, is a far older HTML importer that ignores
 * break-inside and @page, so exercises could be cut in half and the text ran to the paper edge.)
 * WebKit has no @page margin boxes, so the margins and the footer ("opengym.ch" and
 * "Page 1 of 3") are drawn here by a UIPrintPageRenderer.
 *
 * Usage from JS:
 *   import { registerPlugin } from '@capacitor/core';
 *   const Print = registerPlugin('Print');
 *   await Print.printHtml({ html: '<!doctype html>…', name: 'Weekly Training Plan',
 *                           footer: { left: 'opengym.ch', page: 'Page {0} of {1}' } });
 */
@objc(PrintPlugin)
public class PrintPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "PrintPlugin"
    public let jsName = "Print"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise),
    ]

    // Held until the print sheet is done: the web view must outlive the layout and the spooling.
    private var printView: WKWebView?  // not `webView`: CAPPlugin has one (the app's own)
    private var pending: CAPPluginCall?

    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html"), !html.isEmpty else {
            call.reject("html is required")
            return
        }
        DispatchQueue.main.async {
            // One print at a time is all the UI can start; a second tap replaces the first.
            self.pending?.reject("replaced by a newer print")
            self.cleanUp()
            self.pending = call
            // A4 width in points, so the page lays out the way it will print.
            let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 595, height: 842), configuration: WKWebViewConfiguration())
            view.isHidden = true
            view.navigationDelegate = self
            // In the window (hidden): WebKit only lays out a view that is in one.
            self.bridge?.viewController?.view.addSubview(view)
            self.printView = view
            // The renderer below draws the margins, so the document's own @page margins go.
            let page = html.replacingOccurrences(of: "</head>", with: "<style>@page { margin: 0 !important; }</style></head>")
            view.loadHTMLString(page, baseURL: nil)
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // Fonts and SVG settle a moment after the load event.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.present(webView) }
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(error: error.localizedDescription)
    }

    public func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(error: error.localizedDescription)
    }

    private func present(_ webView: WKWebView) {
        guard let call = pending, webView === printView else { return }
        let footer = call.getObject("footer")
        let renderer = FooterPageRenderer(
            left: footer?["left"] as? String ?? "opengym.ch",
            page: footer?["page"] as? String ?? "{0} / {1}"
        )
        renderer.addPrintFormatter(webView.viewPrintFormatter(), startingAtPageAt: 0)

        let info = UIPrintInfo(dictionary: nil)
        info.outputType = .general
        info.jobName = call.getString("name") ?? "openGym"

        let controller = UIPrintInteractionController.shared
        controller.printInfo = info
        controller.printPageRenderer = renderer
        controller.present(animated: true) { (_, completed, error) in
            if let error = error {
                self.finish(error: error.localizedDescription)
            } else {
                self.pending?.resolve(["completed": completed])
                self.pending = nil
                self.cleanUp()
            }
        }
    }

    private func finish(error: String) {
        pending?.reject(error)
        pending = nil
        cleanUp()
    }

    private func cleanUp() {
        printView?.navigationDelegate = nil
        printView?.removeFromSuperview()
        printView = nil
    }
}

/// Margins around the page content, and a footer line on every page: the site on the leading
/// side, the page number on the trailing side, in the reader's language and direction.
final class FooterPageRenderer: UIPrintPageRenderer {
    private let left: String
    private let page: String
    // 15 mm top and 14 mm sides like the printouts' own @page margins (lib/print-doc.js); the
    // bottom holds the footer line (footerHeight) above a 7 mm edge.
    private let insets = UIEdgeInsets(top: 42.5, left: 39.7, bottom: 20, right: 39.7)

    init(left: String, page: String) {
        self.left = left
        self.page = page
        super.init()
        footerHeight = 28
    }

    override var printableRect: CGRect { paperRect.inset(by: insets) }

    override func drawFooterForPage(at pageIndex: Int, in footerRect: CGRect) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.systemFont(ofSize: 7.5),
            .foregroundColor: UIColor(red: 0.6, green: 0.63, blue: 0.68, alpha: 1),
        ]
        let number = page
            .replacingOccurrences(of: "{0}", with: String(pageIndex + 1))
            .replacingOccurrences(of: "{1}", with: String(numberOfPages))
        let rtl = UIApplication.shared.userInterfaceLayoutDirection == .rightToLeft
        let leading = NSAttributedString(string: left, attributes: attrs)
        let trailing = NSAttributedString(string: number, attributes: attrs)
        let (first, second) = rtl ? (trailing, leading) : (leading, trailing)
        let y = footerRect.maxY - first.size().height
        first.draw(at: CGPoint(x: footerRect.minX, y: y))
        second.draw(at: CGPoint(x: footerRect.maxX - second.size().width, y: y))
    }
}
