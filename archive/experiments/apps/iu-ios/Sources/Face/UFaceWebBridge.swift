import Foundation
import WebKit

@MainActor
final class UFaceWebBridge: NSObject, ObservableObject {
    weak var webView: WKWebView?
    var onReady: (() -> Void)?

    func send(state: UFaceState) {
        guard let webView else { return }
        guard let data = try? JSONEncoder().encode(state),
              let json = String(data: data, encoding: .utf8) else {
            return
        }

        let js = "window.uFace && window.uFace.applyState(\(json));"
        webView.evaluateJavaScript(js)
    }
}
