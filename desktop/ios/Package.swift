// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AuroraIOSCore",
    platforms: [.macOS(.v13), .iOS(.v16)],
    products: [.library(name: "AuroraIOSCore", targets: ["AuroraIOSCore"]),
               .executable(name: "AuroraIOSChecks", targets: ["AuroraIOSChecks"])],
    targets: [
        .target(name: "AuroraIOSCore"),
        .executableTarget(name: "AuroraIOSChecks", dependencies: ["AuroraIOSCore"], path: "Checks"),
        .testTarget(name: "AuroraIOSCoreTests", dependencies: ["AuroraIOSCore"])
    ],
    swiftLanguageVersions: [.v5]
)
