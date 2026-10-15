import SwiftUI
import WebKit

final class PortalBrowser: ObservableObject {
    weak var webView: WKWebView?
    @Published var blockedOperation = false

    func navigate(_ destination: PortalDestination) {
        blockedOperation = false
        webView?.load(URLRequest(url: destination.url))
    }
    func back() { if webView?.canGoBack == true { webView?.goBack() } }
    func reload() { webView?.reload() }
}

struct PortalWebView: UIViewRepresentable {
    @ObservedObject var browser: PortalBrowser

    func makeCoordinator() -> Coordinator { Coordinator(browser: browser) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // The app's own website store receives the portal's ordinary HttpOnly session.
        // No cookie, password, Firebase token, TOTP secret or browser state is exported/copied.
        configuration.websiteDataStore = .default()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.preferences.isFraudulentWebsiteWarningEnabled = true
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        browser.webView = view
        view.load(URLRequest(url: PortalDestination.portal.url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        private let browser: PortalBrowser
        init(browser: PortalBrowser) { self.browser = browser }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let frame = navigationAction.targetFrame, let url = navigationAction.request.url,
                  PortalPolicy.canNavigate(url, mainFrame: frame.isMainFrame),
                  !navigationAction.shouldPerformDownload else {
                browser.blockedOperation = true
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            guard let url = navigationResponse.response.url,
                  PortalPolicy.canNavigate(url, mainFrame: navigationResponse.isForMainFrame),
                  navigationResponse.canShowMIMEType else {
                browser.blockedOperation = true
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge,
                     completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
            completionHandler(.performDefaultHandling, nil)
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            // No popup, external browser launch, arbitrary URL handler or JavaScript bridge.
            browser.blockedOperation = true
            return nil
        }

        func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            // Camera/microphone capabilities are not declared by this candidate.
            decisionHandler(.deny)
        }
    }
}
