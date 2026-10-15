import Foundation

public enum NativeContractError: Error {
    case invalidBuildProvenance
}

public struct BuildProvenance: Codable, Equatable {
    public let schemaVersion: String
    public let sourceSha: String
    public let productVersion: String
    public let releaseId: String
    public let certificateSha256: String?
    public let bundleIdentifier: String
    public let bundleIdentityStatus: String
    public let distribution: String
    public let signingStatus: String
    public let nativeAcceptanceVerified: Bool

    public static func parse(_ data: Data) throws -> BuildProvenance {
        let keys: Set<String> = ["schemaVersion", "sourceSha", "productVersion", "releaseId",
                                 "certificateSha256", "bundleIdentifier", "bundleIdentityStatus",
                                 "distribution", "signingStatus", "nativeAcceptanceVerified"]
        guard data.count <= 16384,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == keys else { throw NativeContractError.invalidBuildProvenance }
        let value = try JSONDecoder().decode(BuildProvenance.self, from: data)
        let source = value.sourceSha.range(of: "^[a-f0-9]{40}$", options: .regularExpression) != nil
        let version = value.productVersion.range(
            of: #"^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?$"#,
            options: .regularExpression) != nil
        let bundle = value.bundleIdentifier.range(
            of: #"^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}$"#, options: .regularExpression) != nil
        let unsigned = value.distribution == "NATIVE_IOS_CANDIDATE" && value.signingStatus == "UNSIGNED"
        let signingRequested = value.distribution == "APP_STORE_CANDIDATE"
            && value.signingStatus == "APPLE_SIGNING_REQUESTED"
            && value.bundleIdentityStatus == "CONFIGURED_UNVERIFIED_WITH_APPLE"
            && !value.bundleIdentifier.hasPrefix("local.")
            && !value.bundleIdentifier.hasPrefix("example.")
            && !value.bundleIdentifier.hasPrefix("com.example.")
        guard value.schemaVersion == "aurora.ios.build.v1", source, version, bundle,
              value.releaseId == "aurora-" + value.productVersion + "-" + value.sourceSha,
              value.certificateSha256 == nil,
              ["UNSIGNED_TEST_IDENTITY", "CONFIGURED_UNVERIFIED_WITH_APPLE"].contains(value.bundleIdentityStatus),
              unsigned || signingRequested,
              value.nativeAcceptanceVerified == false
        else { throw NativeContractError.invalidBuildProvenance }
        return value
    }
}

public struct InstallationRequirement: Equatable {
    public let schemaVersion = "aurora.installation.acceptance.v1"
    public let status = "PENDING_AUTHENTICATED_OBSERVATION"
    public let methods = ["CLOUD_OAUTH", "API_TOKEN", "LOCAL_AGENT", "MANUAL"]
    public let requiredFlags = ["processingVerified", "receiptPersisted", "replayVerified",
                               "automationConfigured", "automationVerified", "eligible"]
    public let operationalProofIncluded = false
    public let installationComplete = false
    public init() {}
}
