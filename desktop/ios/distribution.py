"""Opt-in iOS distribution preparation. No account login, provisioning or upload.

Requires a reviewed AppStore/identity.json, an approved RGB icon and an existing
App Store profile. Default action is check; archive/export require --archive on
an authorized Mac with Xcode and the matching identity already provisioned.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import plistlib
import re
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib
from pathlib import Path, PurePosixPath

import configure

FIELDS = {"schemaVersion", "bundleIdentifier", "teamId", "appIdPrefix", "appStoreAppId",
          "profileUuid", "distributionCertificateSha256", "approvedIconSha256",
          "exportComplianceReviewed", "usesNonExemptEncryption"}
PATTERNS = {
    "bundleIdentifier": r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+){2,}",
    "teamId": r"[A-Z0-9]{10}", "appIdPrefix": r"[A-Z0-9]{10}",
    "appStoreAppId": r"[1-9][0-9]{1,19}",
    "profileUuid": r"[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}",
    "distributionCertificateSha256": r"[a-f0-9]{64}", "approvedIconSha256": r"[a-f0-9]{64}",
}
ALLOWED_ENTITLEMENTS = {"application-identifier", "com.apple.developer.team-identifier",
                        "get-task-allow", "beta-reports-active", "keychain-access-groups"}


def validate_identity(value: dict) -> dict:
    if not isinstance(value, dict) or set(value) != FIELDS:
        raise ValueError("Identity requires the closed, reviewed distribution schema")
    if value["schemaVersion"] != "aurora.ios.distribution.v1":
        raise ValueError("Unsupported distribution identity schema")
    for key, pattern in PATTERNS.items():
        if not isinstance(value[key], str) or not re.fullmatch(pattern, value[key]):
            raise ValueError("Missing or invalid reviewed identity: " + key)
    if value["bundleIdentifier"].startswith(("local.", "example.", "com.example.")):
        raise ValueError("Synthetic bundle identity cannot be distributed")
    if value["exportComplianceReviewed"] is not True or type(value["usesNonExemptEncryption"]) is not bool:
        raise ValueError("Export compliance requires an explicit reviewed decision")
    return value


def validate_profile(profile: dict, identity: dict, now: dt.datetime | None = None) -> None:
    now = now or dt.datetime.now(dt.timezone.utc)
    expiry = profile.get("ExpirationDate")
    if not isinstance(expiry, dt.datetime):
        raise ValueError("Profile has no expiry")
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=dt.timezone.utc)
    ent = profile.get("Entitlements", {})
    if not isinstance(ent, dict):
        raise ValueError("Profile entitlements must be a dictionary")
    expected_id = identity["appIdPrefix"] + "." + identity["bundleIdentifier"]
    checks = [profile.get("UUID") == identity["profileUuid"],
              profile.get("TeamIdentifier") == [identity["teamId"]],
              profile.get("ApplicationIdentifierPrefix") == [identity["appIdPrefix"]],
              profile.get("Platform") == ["iOS"],
              expiry > now + dt.timedelta(hours=1),
              "ProvisionedDevices" not in profile,
              profile.get("ProvisionsAllDevices", False) is False,
              ent.get("application-identifier") == expected_id,
              ent.get("com.apple.developer.team-identifier") == identity["teamId"],
              ent.get("get-task-allow") is False,
              ent.get("beta-reports-active") is True,
              set(ent).issubset(ALLOWED_ENTITLEMENTS)]
    certificates = profile.get("DeveloperCertificates", [])
    if not all(checks) or len(certificates) != 1 or not isinstance(certificates[0], bytes):
        raise ValueError("Profile is not the exact, unexpired minimal App Store profile")
    if hashlib.sha256(certificates[0]).hexdigest() != identity["distributionCertificateSha256"]:
        raise ValueError("Profile distribution certificate does not match reviewed SHA-256")


def validate_icon(data: bytes, expected_hash: str) -> None:
    # Validate the complete PNG container, RGB/no-alpha format and bounded pixels.
    if len(data) > 5 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected_hash:
        raise ValueError("Approved icon hash or size mismatch")
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Icon must be a PNG")
    pos, kinds, compressed = 8, [], bytearray()
    while pos + 12 <= len(data):
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        kind = data[pos + 4:pos + 8]
        end = pos + 12 + size
        if end > len(data):
            raise ValueError("Truncated PNG")
        payload = data[pos + 8:pos + 8 + size]
        checksum = struct.unpack(">I", data[pos + 8 + size:end])[0]
        if zlib.crc32(kind + payload) & 0xffffffff != checksum:
            raise ValueError("PNG CRC mismatch")
        if kind == b"IHDR" and payload != struct.pack(">IIBBBBB", 1024, 1024, 8, 2, 0, 0, 0):
            raise ValueError("Icon must be 1024x1024, 8-bit RGB, no alpha, noninterlaced")
        if kind == b"tRNS" or kind in (b"acTL", b"fcTL", b"fdAT"):
            raise ValueError("Transparent or animated icon is not accepted")
        if kind == b"IDAT":
            compressed.extend(payload)
        kinds.append(kind)
        pos = end
        if kind == b"IEND":
            if size != 0:
                raise ValueError("Invalid PNG end")
            break
    if pos != len(data) or not kinds or kinds[0] != b"IHDR" or kinds[-1] != b"IEND" or kinds.count(b"IHDR") != 1:
        raise ValueError("Invalid PNG structure")
    limit = 1024 * (1 + 1024 * 3)
    decoder = zlib.decompressobj()
    raw = decoder.decompress(bytes(compressed), limit + 1)
    if len(raw) != limit or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError("Invalid or oversized PNG pixel stream")
    if any(raw[row * 3073] > 4 for row in range(1024)):
        raise ValueError("Invalid PNG filter")


def write_generated(root: Path, relative: str, data: bytes) -> None:
    target = root / relative
    for parent in reversed(target.parents):
        if parent == root or root in parent.parents:
            if parent.is_symlink() or getattr(parent, "is_junction", lambda: False)():
                raise ValueError("Linked distribution output")
            parent.mkdir(exist_ok=True)
    if target.is_symlink() or (target.exists() and (not target.is_file() or target.stat().st_nlink != 1)):
        raise ValueError("Distribution output must be an unlinked regular file")
    target.write_bytes(data)


def prepare(repo: Path, ios: Path, identity: dict, icon: bytes, profile: dict,
            expected_sha: str, build_number: str) -> dict:
    validate_identity(identity)
    if not re.fullmatch(r"[1-9][0-9]{0,3}", build_number):
        raise ValueError("Distribution build number must be 1..9999; never reset an uploaded build")
    provenance = configure.identity(repo, identity["bundleIdentifier"], False)
    if provenance["sourceSha"] != expected_sha:
        raise ValueError("Reviewed source SHA does not match checkout")
    validate_profile(profile, identity)
    validate_icon(icon, identity["approvedIconSha256"])
    signing = {key: identity[key] for key in ("teamId", "profileUuid")}
    provenance = configure.configure(repo, ios, identity["bundleIdentifier"], False, build_number, signing=signing)
    root = ios / "Generated"
    info = plistlib.loads((ios / "App/Info.plist").read_bytes())
    info["ITSAppUsesNonExemptEncryption"] = identity["usesNonExemptEncryption"]
    info["UISupportedInterfaceOrientations~ipad"] = [
        "UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown",
        "UIInterfaceOrientationLandscapeLeft", "UIInterfaceOrientationLandscapeRight"]
    export = {"method": "app-store-connect", "destination": "export", "signingStyle": "manual",
              "teamID": identity["teamId"], "signingCertificate": "Apple Distribution",
              "provisioningProfiles": {identity["bundleIdentifier"]: identity["profileUuid"]},
              "manageAppVersionAndBuildNumber": False, "stripSwiftSymbols": True}
    write_generated(root, "DistributionInfo.plist", plistlib.dumps(info))
    write_generated(root, "ExportOptions.plist", plistlib.dumps(export))
    write_generated(root, "Assets.xcassets/Contents.json", b'{"info":{"author":"xcode","version":1}}\n')
    catalog = {"images": [{"filename": "AppIcon1024.png", "idiom": "universal", "platform": "ios", "size": "1024x1024"}],
               "info": {"author": "xcode", "version": 1}}
    write_generated(root, "Assets.xcassets/AppIcon.appiconset/Contents.json", (json.dumps(catalog) + "\n").encode())
    write_generated(root, "Assets.xcassets/AppIcon.appiconset/AppIcon1024.png", icon)
    receipt = {"schemaVersion": "aurora.ios.distribution.preparation.v1", "sourceSha": expected_sha,
               "productVersion": provenance["productVersion"], "buildNumber": build_number,
               "identity": identity, "state": "PREPARED_NOT_SIGNED", "testFlightVerified": False,
               "appStorePublished": False, "nativeAcceptanceVerified": False}
    write_generated(root, "DistributionPreparation.json", (json.dumps(receipt, indent=2) + "\n").encode())
    return receipt


def run(command: list[str]) -> bytes:
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Never echo tool output/arguments that could contain private signing material.
        raise RuntimeError("Distribution tool failed: " + Path(command[0]).name)
    return result.stdout


def decode_profile(path: Path) -> dict:
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 1024 * 1024:
        raise ValueError("Profile must be a bounded regular file")
    return plistlib.loads(run(["security", "cms", "-D", "-i", str(path)]))


def check_toolchain() -> None:
    if sys.platform != "darwin":
        raise ValueError("Archive and Apple profile decoding require an authorized Xcode Mac runner")
    xcode = run(["xcodebuild", "-version"]).decode()
    match = re.search(r"^Xcode (\d+)", xcode, re.MULTILINE)
    sdk = run(["xcrun", "--sdk", "iphoneos", "--show-sdk-version"]).decode().strip()
    if not match or int(match[1]) < 26 or not re.fullmatch(r"\d+(?:\.\d+)*", sdk) or int(sdk.split(".")[0]) < 26:
        raise ValueError("App Store submission requires Xcode 26+ and iOS SDK 26+")


def extract_ipa(ipa: Path, output: Path) -> Path:
    with zipfile.ZipFile(ipa) as archive:
        rows = archive.infolist()
        if len(rows) > 10000 or sum(row.file_size for row in rows) > 512 * 1024 * 1024:
            raise ValueError("IPA exceeds extraction limits")
        seen = set()
        for row in rows:
            path = PurePosixPath(row.filename)
            if (path.is_absolute() or not path.parts or ".." in path.parts or "\\" in row.filename
                    or ":" in row.filename or str(path) != row.filename.rstrip("/")
                    or str(path).casefold() in seen or row.flag_bits & 1
                    or (row.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("Unsafe IPA member")
            seen.add(str(path).casefold())
        archive.extractall(output)
    app = output / "Payload/AuroraNexus.app"
    if not app.is_dir() or list((output / "Payload").iterdir()) != [app]:
        raise ValueError("IPA does not contain exactly the expected application")
    return app


def verify_ipa(ipa: Path, preparation: dict) -> dict:
    identity = preparation["identity"]
    with tempfile.TemporaryDirectory(prefix="aurora-ios-verify-") as temporary:
        root = Path(temporary)
        app = extract_ipa(ipa, root)
        run(["codesign", "--verify", "--deep", "--strict", str(app)])
        info = plistlib.loads((app / "Info.plist").read_bytes())
        source = json.loads((app / "BuildProvenance.json").read_text(encoding="utf-8"))
        expected_source = {
            "schemaVersion": "aurora.ios.build.v1", "sourceSha": preparation["sourceSha"],
            "productVersion": preparation["productVersion"],
            "releaseId": "aurora-" + preparation["productVersion"] + "-" + preparation["sourceSha"],
            "certificateSha256": None, "bundleIdentifier": identity["bundleIdentifier"],
            "bundleIdentityStatus": "CONFIGURED_UNVERIFIED_WITH_APPLE",
            "distribution": "APP_STORE_CANDIDATE", "signingStatus": "APPLE_SIGNING_REQUESTED",
            "nativeAcceptanceVerified": False,
        }
        if (info.get("CFBundleIdentifier") != identity["bundleIdentifier"]
                or info.get("CFBundleDisplayName") != "AURORA NEXUS"
                or info.get("CFBundleSupportedPlatforms") != ["iPhoneOS"]
                or info.get("ITSAppUsesNonExemptEncryption") is not identity["usesNonExemptEncryption"]
                or info.get("CFBundleVersion") != preparation["buildNumber"]
                or info.get("CFBundleShortVersionString") != preparation["productVersion"].split("-")[0].split("+")[0]
                or source != expected_source
                or type(source.get("nativeAcceptanceVerified")) is not bool):
            raise ValueError("Exported application does not match prepared source/identity/version")
        validate_profile(decode_profile(app / "embedded.mobileprovision"), identity)
        run(["codesign", "-d", "--extract-certificates", str(root / "signer"), str(app)])
        cert = (root / "signer0").read_bytes()
        if hashlib.sha256(cert).hexdigest() != identity["distributionCertificateSha256"]:
            raise ValueError("Exported signer does not match approved distribution certificate")
        run(["security", "verify-cert", "-c", str(root / "signer0"), "-p", "codeSign"])
        ent = plistlib.loads(run(["codesign", "-d", "--entitlements", ":-", str(app)]))
        if (not set(ent).issubset(ALLOWED_ENTITLEMENTS)
                or ent.get("get-task-allow", False) is not False
                or ent.get("application-identifier") != identity["appIdPrefix"] + "." + identity["bundleIdentifier"]
                or ent.get("com.apple.developer.team-identifier") != identity["teamId"]
                or any(group != identity["appIdPrefix"] + "." + identity["bundleIdentifier"]
                       for group in ent.get("keychain-access-groups", []))):
            raise ValueError("Unexpected or debug entitlements in exported app")
    return {"schemaVersion": "aurora.ios.signed-export.v1", "state": "SIGNED_IPA_VERIFIED_LOCALLY",
            "sourceSha": preparation["sourceSha"], "productVersion": preparation["productVersion"],
            "buildNumber": preparation["buildNumber"], "bundleIdentifier": identity["bundleIdentifier"],
            "distributionCertificateSha256": identity["distributionCertificateSha256"],
            "ipaSha256": hashlib.sha256(ipa.read_bytes()).hexdigest(),
            "testFlightVerified": False, "appStorePublished": False, "nativeAcceptanceVerified": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--archive", action="store_true")
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--icon", type=Path)
    parser.add_argument("--expected-source-sha")
    parser.add_argument("--build-number")
    args = parser.parse_args()
    ios, repo = configure.IOS_ROOT, configure.REPO_ROOT
    identity = validate_identity(json.loads((ios / "AppStore/identity.json").read_text(encoding="utf-8")))
    if not (args.prepare or args.archive):
        print(json.dumps({"state": "IDENTITY_CONFIGURED_NOT_VERIFIED_WITH_APPLE", "signed": False}))
        return
    if not all((args.profile, args.icon, args.expected_source_sha, args.build_number)):
        parser.error("Preparation requires profile, approved icon, exact reviewed SHA and build number")
    check_toolchain()
    if not args.icon.is_file() or args.icon.is_symlink() or args.icon.stat().st_size > 5 * 1024 * 1024:
        raise ValueError("Approved icon must be a bounded regular file")
    prepared = prepare(repo, ios, identity, args.icon.read_bytes(), decode_profile(args.profile),
                       args.expected_source_sha, args.build_number)
    if args.archive:
        root = ios / "Generated"
        for path in (root / "Distribution.xcarchive", root / "Export", root / "DistributionDerivedData"):
            if path.exists() or path.is_symlink():
                raise ValueError("Existing archive/export must be retained; use a fresh reviewed checkout")
        run(["xcodebuild", "archive", "-project", str(root / "AuroraNexus.xcodeproj"),
             "-scheme", "AuroraNexus", "-configuration", "Release", "-sdk", "iphoneos",
             "-destination", "generic/platform=iOS", "-archivePath", str(root / "Distribution.xcarchive"),
             "-derivedDataPath", str(root / "DistributionDerivedData")])
        run(["xcodebuild", "-exportArchive", "-archivePath", str(root / "Distribution.xcarchive"),
             "-exportPath", str(root / "Export"), "-exportOptionsPlist", str(root / "ExportOptions.plist")])
        ipas = list((root / "Export").glob("*.ipa"))
        if len(ipas) != 1 or ipas[0].is_symlink():
            raise ValueError("Expected exactly one exported IPA")
        receipt = verify_ipa(ipas[0], prepared)
        write_generated(root, "SignedExportReceipt.json", (json.dumps(receipt, indent=2) + "\n").encode())
        print(json.dumps(receipt, sort_keys=True))
    else:
        print(json.dumps({"state": prepared["state"], "sourceSha": prepared["sourceSha"]}))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, plistlib.InvalidFileException) as error:
        print("BLOCKED: " + str(error), file=sys.stderr)
        sys.exit(1)
