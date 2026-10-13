import SwiftUI
import WebKit

private let appBackground = UIColor(red: 17/255, green: 21/255, blue: 28/255, alpha: 1)

@main
struct TrendlineApp: App {
    var body: some Scene {
        WindowGroup {
            WebView()
                .ignoresSafeArea()
                .background(Color(appBackground))
        }
    }
}

/// Bridges the web app to native storage (a JSON file in Documents) and the share sheet.
final class Bridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static var stateURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("trendline-state.json")
    }
    weak var webView: WKWebView?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "store":
            if let json = message.body as? String {
                try? json.data(using: .utf8)?.write(to: Bridge.stateURL, options: .atomic)
            }
        case "share":
            guard let body = message.body as? [String: Any],
                  let name = body["name"] as? String,
                  let text = body["text"] as? String else { return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            try? text.write(to: url, atomically: true, encoding: .utf8)
            let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            guard var top = webView?.window?.rootViewController else { return }
            while let presented = top.presentedViewController { top = presented }
            sheet.popoverPresentationController?.sourceView = webView
            top.present(sheet, animated: true)
        default:
            break
        }
    }

    // Open web links in Safari instead of inside the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, ["http", "https"].contains(url.scheme ?? ""),
           action.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let content = WKUserContentController()
        var literal = "null"
        if let saved = try? String(contentsOf: Bridge.stateURL, encoding: .utf8),
           let data = try? JSONEncoder().encode(saved),
           let encoded = String(data: data, encoding: .utf8) {
            literal = encoded
        }
        content.addUserScript(WKUserScript(source: "window.__NATIVE_STATE__ = \(literal);",
                                           injectionTime: .atDocumentStart, forMainFrameOnly: true))
        content.add(context.coordinator, name: "store")
        content.add(context.coordinator, name: "share")

        let config = WKWebViewConfiguration()
        config.userContentController = content
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = appBackground
        webView.scrollView.backgroundColor = appBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.navigationDelegate = context.coordinator
        context.coordinator.webView = webView

        if let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        }
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}
}
