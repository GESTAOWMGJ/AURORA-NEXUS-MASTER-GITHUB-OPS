import XCTest
@testable import AuroraIOSCore

final class NativeCoreTests: XCTestCase {
    private let source = String(repeating: "a", count: 40)

    private func fixture() -> [String: Any] {
        ["schemaVersion": "aurora.ios.build.v1", "sourceSha": source, "productVersion": "1.1.0-beta.1",
         "releaseId": "aurora-1.1.0-beta.1-" + source, "certificateSha256": NSNull(),
         "bundleIdentifier": "local.auroranexus.ios.unsigned",
         "bundleIdentityStatus": "UNSIGNED_TEST_IDENTITY", "distribution": "NATIVE_IOS_CANDIDATE",
         "signingStatus": "UNSIGNED", "nativeAcceptanceVerified": false]
    }

    private func parse(_ value: [String: Any]) throws -> BuildProvenance {
        try BuildProvenance.parse(JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]))
    }

    func testCanonicalNavigation() {
        for path in ["/portal", "/setup", "/account-security", "/__/firebase/init.json", "/downloads"] {
            XCTAssertTrue(PortalPolicy.canNavigate(URL(string: PortalPolicy.origin + path)!, mainFrame: true))
        }
    }

    func testForeignSchemesCredentialsPortsAndDeceptiveHostsAreBlocked() {
        for text in ["http://auroranexus.com.br/portal", "https://auroranexus.com.br.evil.test/portal",
                     "https://auroranexus.com.br@evil.test/", "https://user:pass@auroranexus.com.br/",
                     "https://auroranexus.com.br:444/", "file:///tmp/private", "javascript:alert(1)",
                     "https://evil.test/https://auroranexus.com.br"] {
            XCTAssertFalse(PortalPolicy.canNavigate(URL(string: text)!, mainFrame: true), text)
        }
    }

    func testFirebaseInfrastructureIsOnlyAnExactAuthenticationSubframe() {
        let helper = URL(string: "https://wmgj-hml-jfn-20260927.firebaseapp.com/__/auth/iframe")!
        XCTAssertTrue(PortalPolicy.canNavigate(helper, mainFrame: false))
        XCTAssertFalse(PortalPolicy.canNavigate(helper, mainFrame: true))
        XCTAssertFalse(PortalPolicy.canDownloadOrSelectFiles(documentURL: helper))
        XCTAssertFalse(PortalPolicy.canNavigate(URL(string: "https://other.firebaseapp.com/__/auth/iframe")!, mainFrame: false))
        XCTAssertFalse(PortalPolicy.canNavigate(URL(string: "https://wmgj-hml-jfn-20260927.firebaseapp.com/download")!, mainFrame: false))
    }

    func testFileAndDownloadOriginIsCanonicalOnly() {
        XCTAssertTrue(PortalPolicy.canDownloadOrSelectFiles(documentURL: PortalDestination.portal.url))
        XCTAssertFalse(PortalPolicy.canDownloadOrSelectFiles(documentURL: URL(string: "https://example.com")!))
    }

    func testDiagnosticRequestHasNoAuthenticationOrArbitraryDestination() {
        let request = PortalPolicy.diagnosticRequest()
        XCTAssertEqual(request.url, PortalDestination.portal.url)
        XCTAssertEqual(request.httpMethod, "GET")
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertEqual(request.timeoutInterval, 8)
    }

    func testHttpSuccessDoesNotProveLoginMfaIngestionOrInstallation() {
        let result = PublicOriginDiagnostic.headers(url: PortalDestination.portal.url, status: 200)
        XCTAssertEqual(result.status, "PUBLIC_HEADERS_OBSERVED")
        XCTAssertFalse(result.authenticatedSessionVerified)
        XCTAssertFalse(result.integrationVerified)
        XCTAssertFalse(result.privateResponseBodyRead)
        XCTAssertEqual(InstallationRequirement().status, "PENDING_AUTHENTICATED_OBSERVATION")
        XCTAssertFalse(InstallationRequirement().installationComplete)
    }

    func testDiagnosticRejectsRedirectedOriginAndInvalidStatus() {
        XCTAssertEqual(PublicOriginDiagnostic.headers(url: URL(string: "https://example.com"), status: 200).status, "ORIGIN_CONFLICT")
        XCTAssertEqual(PublicOriginDiagnostic.headers(url: PortalDestination.setup.url, status: 200).status, "ORIGIN_CONFLICT")
        XCTAssertEqual(PublicOriginDiagnostic.headers(url: PortalDestination.portal.url, status: 999).status, "ORIGIN_CONFLICT")
        XCTAssertFalse(PublicOriginDiagnostic.redirectBlocked.integrationVerified)
    }

    func testExactSourceVersionAndReleaseIdParse() throws {
        let value = try parse(fixture())
        XCTAssertEqual(value.sourceSha, source)
        XCTAssertEqual(value.productVersion, "1.1.0-beta.1")
        XCTAssertNil(value.certificateSha256)
        XCTAssertFalse(value.nativeAcceptanceVerified)
    }

    func testClosedContractRejectsUnknownMissingAndCredentialFields() {
        var unknown = fixture(); unknown["token"] = "synthetic-forbidden"
        XCTAssertThrowsError(try parse(unknown))
        var missing = fixture(); missing.removeValue(forKey: "certificateSha256")
        XCTAssertThrowsError(try parse(missing))
    }

    func testMismatchedSourceReleaseAndVersionAreRejected() {
        for field in ["sourceSha", "releaseId", "productVersion"] {
            var value = fixture(); value[field] = "wrong"
            XCTAssertThrowsError(try parse(value), field)
        }
    }

    func testNoAppleIdentitySignatureOrAcceptanceCanBeInferred() {
        for (field, replacement) in [("bundleIdentityStatus", "APP_STORE_VERIFIED"),
                                      ("signingStatus", "SIGNED"), ("distribution", "APP_STORE_RELEASED")] {
            var value = fixture(); value[field] = replacement
            XCTAssertThrowsError(try parse(value))
        }
        var accepted = fixture(); accepted["nativeAcceptanceVerified"] = true
        XCTAssertThrowsError(try parse(accepted))
        var signed = fixture(); signed["certificateSha256"] = String(repeating: "b", count: 64)
        XCTAssertThrowsError(try parse(signed))
    }

    func testDistributionPreparationIsNotSignatureOrStoreAcceptance() throws {
        var value = fixture()
        value["bundleIdentifier"] = "br.com.synthetic.aurora"
        value["bundleIdentityStatus"] = "CONFIGURED_UNVERIFIED_WITH_APPLE"
        value["distribution"] = "APP_STORE_CANDIDATE"
        value["signingStatus"] = "APPLE_SIGNING_REQUESTED"
        let parsed = try parse(value)
        XCTAssertFalse(parsed.nativeAcceptanceVerified)
        XCTAssertNil(parsed.certificateSha256)
        value["signingStatus"] = "SIGNED"
        XCTAssertThrowsError(try parse(value))
        value["signingStatus"] = "APPLE_SIGNING_REQUESTED"
        value["bundleIdentifier"] = "local.auroranexus.ios.unsigned"
        XCTAssertThrowsError(try parse(value))
    }

    func testNumericBooleanCannotBypassAcceptanceGuard() {
        var value = fixture(); value["nativeAcceptanceVerified"] = 0
        XCTAssertThrowsError(try parse(value))
    }

    func testReadinessRequiresEachIndependentChannelAndRealReceipts() {
        let requirement = InstallationRequirement()
        XCTAssertEqual(requirement.methods, ["CLOUD_OAUTH", "API_TOKEN", "LOCAL_AGENT", "MANUAL"])
        XCTAssertEqual(requirement.requiredFlags, ["processingVerified", "receiptPersisted", "replayVerified",
                                                  "automationConfigured", "automationVerified", "eligible"])
        XCTAssertFalse(requirement.operationalProofIncluded)
        XCTAssertFalse(requirement.installationComplete)
    }
}
