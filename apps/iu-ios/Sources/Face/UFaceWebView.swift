import SwiftUI
import WebKit

struct UFaceWebView: UIViewRepresentable {
    let bridge: UFaceWebBridge

    func makeCoordinator() -> Coordinator {
        Coordinator(bridge: bridge)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true

        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "uFaceReady")
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.navigationDelegate = context.coordinator

        bridge.webView = webView

        if let url = Bundle.main.url(forResource: "u_face_renderer", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        private let bridge: UFaceWebBridge

        init(bridge: UFaceWebBridge) {
            self.bridge = bridge
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "uFaceReady" else { return }
            bridge.onReady?()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            bridge.webView = webView
        }
    }
}
