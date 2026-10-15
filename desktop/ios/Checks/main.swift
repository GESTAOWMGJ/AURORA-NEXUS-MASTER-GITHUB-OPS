import Foundation
import AuroraIOSCore

// Offline executable checks for Command Line Tools installations without XCTest.
// XCTest and simulator UI tests remain separate evidence, on runners with Xcode.
struct FailedCheck: Error { let label: String }
func expect(_ value: Bool, _ label: String) throws {
    if !value { throw FailedCheck(label: label) }
}
func parse(_ object: [String: Any]) throws -> BuildProvenance {
    try BuildProvenance.parse(JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]))
}
func rejects(_ object: [String: Any]) -> Bool {
    do { _ = try parse(object); return false } catch { return true }
}
let sha = String(repeating: "a", count: 40)
let fixture: [String: Any] = [
    "schemaVersion": "aurora.ios.build.v1", "sourceSha": sha, "productVersion": "2.3.4-beta.9",
    "releaseId": "aurora-2.3.4-beta.9-" + sha, "certificateSha256": NSNull(),
    "bundleIdentifier": "local.auroranexus.ios.unsigned", "bundleIdentityStatus": "UNSIGNED_TEST_IDENTITY",
    "distribution": "NATIVE_IOS_CANDIDATE", "signingStatus": "UNSIGNED", "nativeAcceptanceVerified": false
]
let checks: [(String, () throws -> Void)] = [
    ("canonical-navigation", {
        for path in ["/portal", "/setup", "/downloads", "/account-security"] {
            try expect(PortalPolicy.canNavigate(URL(string: PortalPolicy.origin + path)!, mainFrame: true), path)
        }
    }),
    ("foreign-navigation-rejected", {
        for text in ["http://auroranexus.com.br", "https://auroranexus.com.br.evil.test", "file:///tmp/test",
                     "javascript:alert(1)", "https://user:pass@auroranexus.com.br", "https://auroranexus.com.br:444"] {
            try expect(!PortalPolicy.canNavigate(URL(string: text)!, mainFrame: true), "foreign navigation")
        }
    }),
    ("firebase-auth-is-subframe-only", {
        let url = URL(string: "https://wmgj-hml-jfn-20260927.firebaseapp.com/__/auth/iframe")!
        try expect(PortalPolicy.canNavigate(url, mainFrame: false), "authentication iframe")
        try expect(!PortalPolicy.canNavigate(url, mainFrame: true), "authentication mainframe")
        try expect(!PortalPolicy.canDownloadOrSelectFiles(documentURL: url), "authentication download")
    }),
    ("anonymous-fixed-diagnostic", {
        let request = PortalPolicy.diagnosticRequest()
        try expect(request.url == PortalDestination.portal.url && request.httpMethod == "GET", "fixed GET")
        try expect(!request.httpShouldHandleCookies && request.timeoutInterval == 8, "bounded anonymous request")
        try expect(request.value(forHTTPHeaderField: "Cookie") == nil && request.value(forHTTPHeaderField: "Authorization") == nil, "no credentials")
    }),
    ("http200-never-proves-integration", {
        let result = PublicOriginDiagnostic.headers(url: PortalDestination.portal.url, status: 200)
        try expect(result.status == "PUBLIC_HEADERS_OBSERVED", "public headers")
        try expect(!result.authenticatedSessionVerified && !result.integrationVerified && !result.privateResponseBodyRead, "no operational claims")
        try expect(PublicOriginDiagnostic.headers(url: PortalDestination.setup.url, status: 200).status == "ORIGIN_CONFLICT", "fixed diagnostic origin")
        try expect(PublicOriginDiagnostic.headers(url: PortalDestination.portal.url, status: 999).status == "ORIGIN_CONFLICT", "valid HTTP status")
    }),
    ("exact-provenance-contract", {
        let value = try parse(fixture)
        try expect(value.sourceSha == sha && value.productVersion == "2.3.4-beta.9", "source and version")
        try expect(value.releaseId == "aurora-2.3.4-beta.9-" + sha, "common release identity")
        try expect(value.certificateSha256 == nil && !value.nativeAcceptanceVerified, "unsigned candidate")
    }),
    ("tampered-or-credential-provenance-rejected", {
        for field in ["sourceSha", "productVersion", "releaseId", "bundleIdentifier", "bundleIdentityStatus", "distribution", "signingStatus"] {
            var altered = fixture; altered[field] = "invalid"
            try expect(rejects(altered), "invalid " + field)
        }
        var credential = fixture; credential["token"] = "synthetic"
        try expect(rejects(credential), "unknown credential field")
        var missing = fixture; missing.removeValue(forKey: "certificateSha256")
        try expect(rejects(missing), "required nullable field")
    }),
    ("signature-and-native-acceptance-not-inferred", {
        for replacement in [true, 0, "false"] as [Any] {
            var altered = fixture; altered["nativeAcceptanceVerified"] = replacement
            try expect(rejects(altered), "strict pending boolean")
        }
        var altered = fixture; altered["certificateSha256"] = String(repeating: "b", count: 64)
        try expect(rejects(altered), "no invented certificate")
    }),
    ("all-channels-require-real-receipts-and-automation", {
        let requirement = InstallationRequirement()
        try expect(requirement.methods == ["CLOUD_OAUTH", "API_TOKEN", "LOCAL_AGENT", "MANUAL"], "four independent channels")
        try expect(requirement.requiredFlags == ["processingVerified", "receiptPersisted", "replayVerified", "automationConfigured", "automationVerified", "eligible"], "receipt and automation requirements")
        try expect(!requirement.operationalProofIncluded && !requirement.installationComplete, "not installed")
    })
]
var passed: [String] = []
var failed: [String] = []
for (name, check) in checks {
    do { try check(); passed.append(name) } catch { failed.append(name) }
}
let result: [String: Any] = ["schemaVersion": "aurora.ios.offline-checks.v1", "passed": passed,
                            "failed": failed, "passedTotal": passed.count, "failedTotal": failed.count,
                            "networkUsed": false, "iOSAppCompiled": false, "nativeAcceptanceVerified": false]
print(String(data: try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), encoding: .utf8)!)
if !failed.isEmpty { exit(1) }
