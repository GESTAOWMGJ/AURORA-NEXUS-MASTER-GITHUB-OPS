import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct PublicOriginDiagnostic: Equatable {
    public let status: String
    public let httpStatus: Int?
    public let authenticatedSessionVerified = false
    public let integrationVerified = false
    public let privateResponseBodyRead = false

    public static let notObserved = PublicOriginDiagnostic(status: "NOT_OBSERVED", httpStatus: nil)
    public static let unavailable = PublicOriginDiagnostic(status: "NETWORK_UNAVAILABLE", httpStatus: nil)
    public static let redirectBlocked = PublicOriginDiagnostic(status: "REDIRECT_BLOCKED", httpStatus: nil)

    public static func headers(url: URL?, status: Int) -> PublicOriginDiagnostic {
        guard let url, url == PortalDestination.portal.url, (100...599).contains(status) else {
            return PublicOriginDiagnostic(status: "ORIGIN_CONFLICT", httpStatus: nil)
        }
        return PublicOriginDiagnostic(status: "PUBLIC_HEADERS_OBSERVED", httpStatus: status)
    }
}

/// A manual, anonymous, headers-only GET of the fixed canonical entry.
/// It never copies WebKit cookies, credentials, response bodies or authentication state.
public enum CanonicalDiagnostics {
    public static func run() async -> PublicOriginDiagnostic {
        await withCheckedContinuation { continuation in
            let probe = HeaderProbe { continuation.resume(returning: $0) }
            probe.start()
        }
    }
}

private final class HeaderProbe: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private var completion: ((PublicOriginDiagnostic) -> Void)?
    private var observation: PublicOriginDiagnostic?
    private var session: URLSession?

    init(completion: @escaping (PublicOriginDiagnostic) -> Void) {
        self.completion = completion
    }

    func start() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 10
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        session?.dataTask(with: PortalPolicy.diagnosticRequest()).resume()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        observation = .redirectBlocked
        completionHandler(nil)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        // The system evaluates TLS. No custom trust exception or stored credential is supplied.
        completionHandler(.performDefaultHandling, nil)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask,
                    didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if observation == nil, let http = response as? HTTPURLResponse {
            observation = .headers(url: http.url, status: http.statusCode)
        }
        // Stop at response headers. Never consume or persist a response body.
        completionHandler(.cancel)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let result = observation ?? .unavailable
        let callback = completion
        completion = nil
        session.finishTasksAndInvalidate()
        self.session = nil
        callback?(result)
    }
}
