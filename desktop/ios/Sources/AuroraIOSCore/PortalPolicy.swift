import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum PortalDestination {
    case portal, setup
    public var url: URL {
        URL(string: "https://auroranexus.com.br" + (self == .portal ? "/portal" : "/setup"))!
    }
}

public enum PortalPolicy {
    public static let origin = "https://auroranexus.com.br"
    private static let firebaseHelperHost = "wmgj-hml-jfn-20260927.firebaseapp.com"

    public static func isCanonical(_ url: URL) -> Bool {
        guard let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme?.lowercased() == "https"
            && parts.host?.lowercased() == "auroranexus.com.br"
            && parts.user == nil && parts.password == nil
            && (parts.port == nil || parts.port == 443)
    }

    public static func canNavigate(_ url: URL, mainFrame: Bool) -> Bool {
        if isCanonical(url) { return true }
        // This infrastructure frame is only for the existing HML Firebase Auth SDK.
        // It never becomes a user entry, download origin or native credential channel.
        guard !mainFrame, let parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        return parts.scheme == "https" && parts.host == firebaseHelperHost
            && parts.user == nil && parts.password == nil && (parts.port == nil || parts.port == 443)
            && parts.path == "/__/auth/iframe"
    }

    public static func canDownloadOrSelectFiles(documentURL: URL) -> Bool {
        isCanonical(documentURL)
    }

    public static func diagnosticRequest() -> URLRequest {
        var request = URLRequest(url: PortalDestination.portal.url,
                                 cachePolicy: .reloadIgnoringLocalAndRemoteCacheData,
                                 timeoutInterval: 8)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("text/html", forHTTPHeaderField: "Accept")
        return request
    }
}
