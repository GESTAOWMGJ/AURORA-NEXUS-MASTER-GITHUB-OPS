"""Generate an unsigned iOS candidate from this checkout; never provision or sign."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

IOS_ROOT = Path(__file__).resolve().parent
REPO_ROOT = IOS_ROOT.parents[1]
SOURCES = (
    "App/AuroraNexusApp.swift", "App/PortalWebView.swift", "App/NativeStatusCenter.swift",
    "Sources/AuroraIOSCore/PortalPolicy.swift", "Sources/AuroraIOSCore/BuildProvenance.swift",
    "Sources/AuroraIOSCore/CanonicalDiagnostics.swift",
)
UI_TEST = "UITests/AuroraNexusUITests.swift"
VERSION_SOURCE = "firebase-migration/functions/src/auroraReleaseStatus.ts"


def identity(repo: Path, bundle_identifier: str | None, unsigned_test_identity: bool) -> dict:
    if bool(bundle_identifier) == unsigned_test_identity:
        raise ValueError("Choose one configured bundle identifier or explicit unsigned test identity")
    bundle = bundle_identifier or "local.auroranexus.ios.unsigned"
    if not re.fullmatch(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}", bundle):
        raise ValueError("Invalid bundle identifier")
    text = (repo / VERSION_SOURCE).read_text(encoding="utf-8")
    matches = re.findall(r'export const AURORA_PRODUCT_VERSION = "([^"\r\n]+)";', text)
    if len(matches) != 1 or not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?", matches[0]):
        raise ValueError("Missing unique canonical product version")
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, check=True,
                         capture_output=True, text=True).stdout.strip()
    if not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("Invalid checkout source SHA")
    changed = subprocess.run(["git", "status", "--porcelain", "--untracked-files=all", "--",
                              "desktop/ios", VERSION_SOURCE], cwd=repo, check=True,
                             capture_output=True, text=True).stdout.strip()
    if changed:
        raise ValueError("Commit iOS and canonical version sources before configuring a source-bound candidate")
    version = matches[0]
    return {"schemaVersion": "aurora.ios.build.v1", "sourceSha": sha,
            "productVersion": version, "releaseId": f"aurora-{version}-{sha}",
            "certificateSha256": None, "bundleIdentifier": bundle,
            "bundleIdentityStatus": "UNSIGNED_TEST_IDENTITY" if unsigned_test_identity else "CONFIGURED_UNVERIFIED_WITH_APPLE",
            "distribution": "NATIVE_IOS_CANDIDATE", "signingStatus": "UNSIGNED",
            "nativeAcceptanceVerified": False}


def oid(label: str) -> str:
    return hashlib.sha256(label.encode("ascii")).hexdigest()[:24].upper()


def project(provenance: dict, build_number: str) -> str:
    if not re.fullmatch(r"[1-9][0-9]{0,8}", build_number):
        raise ValueError("Build number must be a positive integer of at most 9 digits")
    objects: list[str] = []

    def add(label: str, body: str) -> str:
        key = oid(label)
        objects.append(f"\t\t{key} = {{ {body} }};")
        return key

    def array(values: list[str]) -> str:
        return "(" + ", ".join(values) + ",)" if values else "()"

    app_builds = []
    refs = []
    for name in SOURCES + (UI_TEST,):
        ref = add("ref:" + name, f'isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = "../{name}"; sourceTree = "<group>";')
        refs.append(ref)
        item = add("build:" + name, f"isa = PBXBuildFile; fileRef = {ref};")
        if name == UI_TEST:
            test_build = item
        else:
            app_builds.append(item)
    resource = add("ref:provenance", 'isa = PBXFileReference; lastKnownFileType = text.json; path = BuildProvenance.json; sourceTree = "<group>";')
    resource_build = add("build:provenance", f"isa = PBXBuildFile; fileRef = {resource};")
    refs.append(resource)
    app_product = add("product:app", 'isa = PBXFileReference; explicitFileType = wrapper.application; path = AuroraNexus.app; sourceTree = BUILT_PRODUCTS_DIR;')
    test_product = add("product:test", 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = AuroraNexusUITests.xctest; sourceTree = BUILT_PRODUCTS_DIR;')
    products = add("group:products", f'isa = PBXGroup; children = {array([app_product, test_product])}; name = Products; sourceTree = "<group>";')
    group = add("group:main", f'isa = PBXGroup; children = {array(refs + [products])}; sourceTree = "<group>";')
    app_sources = add("phase:app:sources", f"isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {array(app_builds)}; runOnlyForDeploymentPostprocessing = 0;")
    app_resources = add("phase:app:resources", f"isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = {array([resource_build])}; runOnlyForDeploymentPostprocessing = 0;")
    test_sources = add("phase:test:sources", f"isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = {array([test_build])}; runOnlyForDeploymentPostprocessing = 0;")
    configurations = {}
    numeric_version = re.match(r"\d+\.\d+\.\d+", provenance["productVersion"])[0]
    for target in ("project", "app", "test"):
        configs = []
        for mode in ("Debug", "Release"):
            settings = ['CLANG_ENABLE_MODULES = YES', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0', 'SDKROOT = iphoneos', 'SWIFT_VERSION = 5.0', 'CODE_SIGNING_ALLOWED = NO', 'CODE_SIGNING_REQUIRED = NO', 'TARGETED_DEVICE_FAMILY = "1,2"']
            if mode == "Debug":
                settings += ['SWIFT_ACTIVE_COMPILATION_CONDITIONS = DEBUG', 'SWIFT_OPTIMIZATION_LEVEL = "-Onone"']
            if target != "project":
                bundle = provenance["bundleIdentifier"] + (".uitests" if target == "test" else "")
                settings += [f'PRODUCT_BUNDLE_IDENTIFIER = "{bundle}"', 'PRODUCT_NAME = "$(TARGET_NAME)"', f'MARKETING_VERSION = "{numeric_version}"', f'CURRENT_PROJECT_VERSION = {build_number}', 'SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"', 'SWIFT_EMIT_LOC_STRINGS = NO']
                if target == "app":
                    settings += ['INFOPLIST_FILE = ../App/Info.plist', 'GENERATE_INFOPLIST_FILE = NO']
                else:
                    settings += ['GENERATE_INFOPLIST_FILE = YES', 'TEST_TARGET_NAME = AuroraNexus']
            configs.append(add(f"config:{target}:{mode}", f'isa = XCBuildConfiguration; buildSettings = {{ ' + "; ".join(settings) + f'; }}; name = {mode};'))
        configurations[target] = add("configs:" + target, f"isa = XCConfigurationList; buildConfigurations = {array(configs)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;")
    proxy = add("proxy", f'isa = PBXContainerItemProxy; containerPortal = {oid("project")}; proxyType = 1; remoteGlobalIDString = {oid("target:app")}; remoteInfo = AuroraNexus;')
    dependency = add("dependency", f'isa = PBXTargetDependency; target = {oid("target:app")}; targetProxy = {proxy};')
    app = add("target:app", f'isa = PBXNativeTarget; buildConfigurationList = {configurations["app"]}; buildPhases = {array([app_sources, app_resources])}; buildRules = (); dependencies = (); name = AuroraNexus; productName = AuroraNexus; productReference = {app_product}; productType = "com.apple.product-type.application";')
    test = add("target:test", f'isa = PBXNativeTarget; buildConfigurationList = {configurations["test"]}; buildPhases = {array([test_sources])}; buildRules = (); dependencies = {array([dependency])}; name = AuroraNexusUITests; productName = AuroraNexusUITests; productReference = {test_product}; productType = "com.apple.product-type.bundle.ui-testing";')
    root = add("project", f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 1600; }}; buildConfigurationList = {configurations["project"]}; compatibilityVersion = "Xcode 14.0"; developmentRegion = en; hasScannedForEncodings = 0; knownRegions = (en, Base); mainGroup = {group}; productRefGroup = {products}; projectDirPath = ""; projectRoot = ""; targets = {array([app, test])};')
    return '// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n' + "\n".join(objects) + f'\n\t}};\n\trootObject = {root};\n}}\n'


def scheme() -> str:
    def ref(label: str, product: str, name: str) -> str:
        return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{oid(label)}" BuildableName="{escape(product)}" BlueprintName="{name}" ReferencedContainer="container:AuroraNexus.xcodeproj"/>'
    app = ref("target:app", "AuroraNexus.app", "AuroraNexus")
    test = ref("target:test", "AuroraNexusUITests.xctest", "AuroraNexusUITests")
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="NO" buildForAnalyzing="YES">{app}</BuildActionEntry>
<BuildActionEntry buildForTesting="YES" buildForRunning="NO" buildForProfiling="NO" buildForArchiving="NO" buildForAnalyzing="YES">{test}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">{test}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO"><BuildableProductRunnable runnableDebuggingMode="0">{app}</BuildableProductRunnable></LaunchAction>
<ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" useCustomWorkingDirectory="NO"><BuildableProductRunnable runnableDebuggingMode="0">{app}</BuildableProductRunnable></ProfileAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''


def configure(repo: Path, ios_root: Path, bundle_identifier: str | None,
              unsigned_test_identity: bool, build_number: str) -> dict:
    provenance = identity(repo, bundle_identifier, unsigned_test_identity)
    for name in SOURCES + (UI_TEST, "App/Info.plist"):
        path = ios_root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError("Missing regular iOS source: " + name)
    project_text = project(provenance, build_number)
    generated = ios_root / "Generated"
    if generated.is_symlink() or getattr(generated, "is_junction", lambda: False)():
        raise ValueError("Generated directory cannot be a link")
    generated.mkdir(exist_ok=True)
    xcode = generated / "AuroraNexus.xcodeproj"
    schemes = xcode / "xcshareddata" / "xcschemes"
    # Refuse symlink redirection at every output component, including repeated local runs.
    for target in (xcode, xcode / "xcshareddata", schemes):
        if target.is_symlink() or getattr(target, "is_junction", lambda: False)():
            raise ValueError("Linked generated output")
        target.mkdir(exist_ok=True)
    outputs = {generated / "BuildProvenance.json": json.dumps(provenance, sort_keys=True, indent=2) + "\n",
               xcode / "project.pbxproj": project_text,
               schemes / "AuroraNexus.xcscheme": scheme()}
    for path in outputs:
        if path.is_symlink() or (path.exists() and (not path.is_file() or path.stat().st_nlink != 1)):
            raise ValueError("Output must be an unlinked regular file")
    for path, content in outputs.items():
        path.write_text(content, encoding="utf-8", newline="\n")
    return provenance


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--bundle-identifier")
    choice.add_argument("--unsigned-test-identity", action="store_true")
    parser.add_argument("--build-number", default="1")
    args = parser.parse_args()
    result = configure(REPO_ROOT, IOS_ROOT, args.bundle_identifier,
                       args.unsigned_test_identity, args.build_number)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
