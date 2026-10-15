#!/usr/bin/env python3
"""Offline integrity checks only. Never installs, opens or executes payloads."""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import zipfile

SCHEMA = "aurora.unified-beta-delivery.v1"
COMPONENTS = ("server", "web", "satellite", "iaMaster", "windowsIntegration")
MAX_FILE = 128 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024


class VerificationError(ValueError):
    pass


def demand(condition, code):
    if not condition:
        raise VerificationError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def signing_bytes(certificate):
    return ("AURORA_ACTIVE_RELEASE_V" + str(certificate["schemaVersion"]) + "\0").encode("ascii") + canonical(certificate)


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        demand(key not in result, "DUPLICATE_JSON_KEY")
        result[key] = value
    return result


def parse_json(data):
    try:
        return json.loads(data, object_pairs_hook=unique_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(VerificationError("INVALID_JSON")))
    except (ValueError, UnicodeError):
        raise VerificationError("INVALID_JSON") from None


def safe_name(name):
    demand(isinstance(name, str) and name and len(name) <= 240
           and "\\" not in name and ":" not in name and "\0" not in name
           and not any(ord(c) < 32 for c in name), "UNSAFE_PATH")
    parts = name.split("/")
    demand(not PurePosixPath(name).is_absolute()
           and all(part not in ("", ".", "..") and not part.endswith((" ", "."))
                   and not re.fullmatch(r"(?i)(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?", part)
                   for part in parts), "UNSAFE_PATH")
    return parts


def linked(path):
    metadata = path.lstat()
    return (stat.S_ISLNK(metadata.st_mode)
            or bool(getattr(metadata, "st_file_attributes", 0) & 0x400))


def read_regular(path, limit=MAX_FILE):
    metadata = path.lstat()
    demand(not linked(path) and stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1,
           "NON_REGULAR_FILE")
    demand(metadata.st_size <= limit, "FILE_TOO_LARGE")
    with path.open("rb") as stream:
        data = stream.read(limit + 1)
    demand(len(data) == metadata.st_size and len(data) <= limit, "FILE_CHANGED_OR_TOO_LARGE")
    return data


def read_tree(root):
    demand(root.is_dir() and not linked(root), "UNSAFE_ROOT")
    files, folded, total = {}, set(), 0
    for current, directories, names in os.walk(root, followlinks=False):
        for name in directories:
            path = Path(current) / name
            demand(not linked(path) and path.is_dir(), "LINKED_DIRECTORY")
            safe_name(path.relative_to(root).as_posix())
        for name in names:
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            safe_name(relative)
            demand(relative.casefold() not in folded, "CASE_COLLISION")
            folded.add(relative.casefold())
            data = read_regular(path)
            total += len(data)
            demand(total <= MAX_TOTAL, "DELIVERY_TOO_LARGE")
            files[relative] = data
    return files


def verify_component_zip(data, manifest_bytes, manifest):
    expected = manifest.get("files")
    demand(isinstance(expected, dict) and bool(expected), "INVALID_COMPONENT_FILES")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        for name in names:
            safe_name(name)
        demand(len(set(names)) == len(names) == len({n.casefold() for n in names})
               and set(names) == set(expected) | {"manifest.json"}, "PACKAGE_CLOSURE_CONFLICT")
        demand(sum(entry.file_size for entry in entries) <= MAX_TOTAL, "PACKAGE_TOO_LARGE")
        for entry in entries:
            demand(not entry.is_dir() and not entry.flag_bits & 1 and entry.file_size <= MAX_FILE
                   and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG), "UNSAFE_PACKAGE_ENTRY")
            content = archive.read(entry)
            demand(content == manifest_bytes if entry.filename == "manifest.json"
                   else digest(content) == expected[entry.filename], "PACKAGE_FILE_INTEGRITY_CONFLICT")


def verify(directory, trusted_public_key_sha256=None):
    result = {"schemaVersion": SCHEMA, "status": "PREPARADO", "complete": False,
              "integrityVerified": False, "signatureVerified": False,
              "trustedPublisherVerified": False,
              "signatureProvided": False,
              "signatureStatus": "PENDING", "missingComponents": list(COMPONENTS),
              "installationExecuted": False, "deviceAcceptanceVerified": False}
    try:
        files = read_tree(Path(directory))
        result["signatureProvided"] = "trust/release-envelope-signed.json" in files
        demand("release-envelope.json" in files and "SHA256SUMS" in files, "DELIVERY_INDEX_REQUIRED")
        envelope = parse_json(files["release-envelope.json"])
        demand(isinstance(envelope, dict) and envelope.get("schemaVersion") == SCHEMA
               and envelope.get("status") == "PREPARADO" and envelope.get("complete") is False,
               "INVALID_DELIVERY_INDEX")
        source, expected = envelope.get("sourceSha"), envelope.get("files")
        demand(isinstance(source, str) and re.fullmatch("[a-f0-9]{40}", source)
               and isinstance(expected, dict) and "VERIFY.py" in expected, "INVALID_DELIVERY_IDENTITY")
        demand(set(files) == set(expected) | {"release-envelope.json", "SHA256SUMS"}, "FILE_SET_CONFLICT")
        for name, record in expected.items():
            safe_name(name)
            demand(isinstance(record, dict) and set(record) == {"sha256", "size"}
                   and type(record["size"]) is int and record["size"] >= 0
                   and record["size"] == len(files[name])
                   and record["sha256"] == digest(files[name]), "FILE_INTEGRITY_CONFLICT")
        sums = {}
        for line in files["SHA256SUMS"].decode("utf-8").splitlines():
            match = re.fullmatch(r"([a-f0-9]{64})  (.+)", line)
            demand(match is not None, "INVALID_CHECKSUM_INDEX")
            name = match[2]
            safe_name(name)
            demand(name not in sums, "DUPLICATE_CHECKSUM")
            sums[name] = match[1]
        demand(set(sums) == set(files) - {"SHA256SUMS"}
               and all(sums[name] == digest(files[name]) for name in sums), "CHECKSUM_INDEX_CONFLICT")
        demand("trust/certificate.json" in files, "CERTIFICATE_REQUIRED")
        certificate = parse_json(files["trust/certificate.json"])
        cert_keys = {"schemaVersion", "sourceSha", "productVersion", "canonicalOrigin", "releaseRunId",
                     "ciRunId", "publishedAtUtc", "status", "checks", "components"}
        checks = {"ciPassed", "humanReviewApproved", "protectedDeploySucceeded", "smokePassed"}
        demand(isinstance(certificate, dict) and set(certificate) == cert_keys
               and type(certificate.get("schemaVersion")) is int and certificate["schemaVersion"] == 2
               and certificate.get("sourceSha") == source
               and certificate.get("canonicalOrigin") == "https://auroranexus.com.br"
               and certificate.get("status") == "ACTIVE"
               and isinstance(certificate.get("checks"), dict) and set(certificate["checks"]) == checks
               and all(certificate["checks"][name] is True for name in checks)
               and all(isinstance(certificate.get(name), str) and re.fullmatch("[1-9][0-9]{0,19}", certificate[name])
                       for name in ("releaseRunId", "ciRunId"))
               and isinstance(certificate.get("components"), dict)
               and set(certificate["components"]) == set(COMPONENTS), "CERTIFICATE_IDENTITY_CONFLICT")
        demand(envelope.get("certificateSha256") == digest(signing_bytes(certificate)),
               "CERTIFICATE_DIGEST_CONFLICT")
        product_version = certificate["productVersion"]
        demand(isinstance(product_version, str)
               and re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?", product_version),
               "INVALID_PRODUCT_VERSION")
        identity = {"releaseId": "aurora-" + product_version + "-" + source,
                    "productVersion": product_version, "sourceSha": source,
                    "certificateSha256": envelope["certificateSha256"]}
        demand(all(envelope.get(name) == value for name, value in identity.items())
               and envelope.get("components") == certificate["components"]
               and ("identity" not in envelope or envelope["identity"] == identity)
               and all(certificate["components"][component].get("version") == product_version
                       for component in ("server", "web")), "DELIVERY_CERTIFICATE_IDENTITY_CONFLICT")
        manifests = {}
        for component in COMPONENTS:
            path = "manifests/" + component + "-manifest.json"
            demand(path in files, "COMPONENT_MANIFEST_REQUIRED")
            pin = certificate["components"][component]
            manifest = parse_json(files[path])
            manifests[component] = manifest
            declared_source = manifest.get("sourceRevision") if component == "iaMaster" else manifest.get(
                "sourceCommit" if component == "satellite" else "sourceSha")
            demand(isinstance(pin, dict) and set(pin) == {"version", "sourceSha", "manifestSha256"}
                   and pin.get("sourceSha") == source and pin.get("manifestSha256") == digest(files[path])
                   and declared_source == source and manifest.get("version") == pin.get("version"),
                   "COMPONENT_IDENTITY_CONFLICT")
        result["missingComponents"] = []
        missing_payloads = []
        runtime_payloads = {}
        for component in ("server", "web"):
            prefix = "payloads/" + component + "/"
            present = {name[len(prefix):] for name in files if name.startswith(prefix)}
            expected_runtime = manifests[component].get("files")
            demand(isinstance(expected_runtime, dict) and expected_runtime, "INVALID_RUNTIME_FILES")
            if present:
                demand(present == set(expected_runtime) and all(
                    digest(files[prefix + name]) == expected_runtime[name] for name in present),
                    "RUNTIME_FILE_INTEGRITY_CONFLICT")
            else:
                missing_payloads.extend(prefix + name for name in expected_runtime)
            runtime_payloads[component] = "VERIFIED_BYTES" if present else "DEPLOYED_REFERENCE_ONLY"
        result["runtimePayloads"] = runtime_payloads
        for component in ("iaMaster", "windowsIntegration"):
            path = "payloads/" + component + "/" + component + "-package.zip"
            if path not in files:
                missing_payloads.append(path)
            else:
                verify_component_zip(files[path], files["manifests/" + component + "-manifest.json"], manifests[component])
        satellite = manifests["satellite"].get("files")
        demand(isinstance(satellite, list) and bool(satellite), "INVALID_SATELLITE_FILES")
        satellite_names = set()
        for record in satellite:
            demand(isinstance(record, dict) and isinstance(record.get("name"), str), "INVALID_SATELLITE_FILE")
            safe_name(record["name"])
            demand("/" not in record["name"] and record["name"].casefold() not in satellite_names,
                   "INVALID_SATELLITE_FILE")
            satellite_names.add(record["name"].casefold())
            path = "payloads/satellite/" + record["name"]
            if path not in files:
                missing_payloads.append(path)
            else:
                demand(record.get("size") == len(files[path]) and record.get("sha256") == digest(files[path]),
                       "SATELLITE_FILE_INTEGRITY_CONFLICT")
        result["missingPayloads"] = missing_payloads
        result["allDeclaredPayloadsPresent"] = not missing_payloads
        demand(not result["signatureProvided"] or "trust/public-trust.json" in files,
               "PUBLIC_TRUST_REQUIRED_FOR_SIGNATURE")
        if "trust/public-trust.json" in files:
            trust = parse_json(files["trust/public-trust.json"])
            demand(isinstance(trust, dict) and set(trust) == {"publicKeySpkiPem", "publicKeySha256"}
                   and isinstance(trust["publicKeySpkiPem"], str), "INVALID_PUBLIC_TRUST")
            pem = trust["publicKeySpkiPem"]
            demand(pem.startswith("-----BEGIN PUBLIC KEY-----\n")
                   and pem.rstrip().endswith("-----END PUBLIC KEY-----"), "INVALID_PUBLIC_TRUST")
            der = base64.b64decode("".join(pem.splitlines()[1:-1]), validate=True)
            demand(digest(der) == trust["publicKeySha256"], "PUBLIC_KEY_FINGERPRINT_CONFLICT")
            if trusted_public_key_sha256 is not None:
                demand(isinstance(trusted_public_key_sha256, str)
                       and re.fullmatch("[a-f0-9]{64}", trusted_public_key_sha256)
                       and digest(der) == trusted_public_key_sha256, "TRUST_ANCHOR_CONFLICT")
            if "trust/release-envelope-signed.json" in files:
                signed = parse_json(files["trust/release-envelope-signed.json"])
                demand(isinstance(signed, dict) and set(signed) == {"certificate", "signature"}
                       and signed["certificate"] == certificate
                       and isinstance(signed["signature"], str)
                       and re.fullmatch("[A-Za-z0-9_-]{86}", signed["signature"]), "INVALID_SIGNED_ENVELOPE")
                try:
                    from cryptography.hazmat.primitives import serialization
                    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
                except ImportError:
                    result["signatureStatus"] = "PENDING_CRYPTO_BACKEND"
                else:
                    key = serialization.load_der_public_key(der)
                    demand(isinstance(key, Ed25519PublicKey), "ED25519_PUBLIC_KEY_REQUIRED")
                    signature = base64.urlsafe_b64decode(signed["signature"] + "==")
                    demand(base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=") == signed["signature"],
                           "INVALID_SIGNATURE_ENCODING")
                    key.verify(signature, signing_bytes(certificate))
                    result["signatureVerified"], result["signatureStatus"] = True, "VERIFIED_OFFLINE"
                    result["trustedPublisherVerified"] = trusted_public_key_sha256 is not None
        result.update(integrityVerified=True, sourceSha=source, certificateSha256=envelope["certificateSha256"],
                      fileCount=len(files), scope="Offline byte integrity/signature; no live pin, installation or acceptance assertion")
    except VerificationError as error:
        result["errorCode"] = str(error)
    except Exception:
        result["errorCode"] = "INVALID_OR_UNREADABLE_DELIVERY"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--trusted-public-key-sha256", help="Public fingerprint obtained outside this package")
    args = parser.parse_args()
    result = verify(args.directory, args.trusted_public_key_sha256)
    print(json.dumps(result, sort_keys=True))
    accepted = result["integrityVerified"] and (not result["signatureProvided"] or result["signatureVerified"])
    if args.trusted_public_key_sha256 is not None:
        accepted = accepted and result["trustedPublisherVerified"]
    return 0 if accepted else 2


if __name__ == "__main__":
    raise SystemExit(main())
