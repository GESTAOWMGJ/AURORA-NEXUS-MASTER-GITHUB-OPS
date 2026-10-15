#!/usr/bin/env python3
"""Assemble existing source-bound outputs; never install, deploy or rebuild them."""
from __future__ import annotations

import argparse
import io
from pathlib import Path
import plistlib
import re
import stat
import tempfile
import zipfile
import json

from verify_unified_beta import (COMPONENTS, MAX_FILE, MAX_TOTAL, SCHEMA, VerificationError,
                                canonical, demand, digest, linked, parse_json, read_regular,
                                safe_name, signing_bytes, verify, verify_component_zip)

CANDIDATE_SCHEMA = "aurora.unified-beta-candidate.v1"
PORTAL = "https://auroranexus.com.br/portal"
SATELLITE_NAMES = {"AURORA-NEXUS-Instalar.exe", "AURORA-NEXUS-Windows-Beta.zip",
                   "AURORA-NEXUS-Mac-HML.zip", "AURORA-NEXUS-Windows-x64-HML.exe"}
MAC_IDENTITY = {"appName": "Aurora Nexus HML-0.2.0-hml.20261001.app",
                "bundleIdentifier": "br.com.auroranexus.desktop.hml",
                "bundleVersion": "1", "shortVersion": "0.2.0"}


def json_bytes(value):
    return canonical(value) + b"\n"


def records(files):
    return {name: {"sha256": digest(data), "size": len(data)} for name, data in sorted(files.items())}


def read_bounded(root, relative):
    path = Path(root)
    demand(path.is_dir() and not linked(path), "UNSAFE_INPUT_ROOT")
    for part in safe_name(relative):
        path = path / part
        demand(not linked(path), "LINKED_INPUT_PATH")
    return read_regular(path)


def zip_files(data):
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        demand(len(set(names)) == len(names) == len({n.casefold() for n in names}), "ZIP_NAME_COLLISION")
        demand(sum(entry.file_size for entry in entries) <= MAX_TOTAL, "ZIP_TOO_LARGE")
        for entry in entries:
            safe_name(entry.filename)
            demand(not entry.is_dir() and not entry.flag_bits & 1 and entry.file_size <= MAX_FILE
                   and stat.S_IFMT(entry.external_attr >> 16) in (0, stat.S_IFREG), "UNSAFE_ZIP_ENTRY")
            files[entry.filename] = archive.read(entry)
    return files


def archive_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(files.items()):
            safe_name(name)
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = (stat.S_IFREG | 0o644) << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, data)
    return stream.getvalue()


def manifest_pin(component, data, source):
    manifest = parse_json(data)
    demand(isinstance(manifest, dict) and manifest.get("dirty") is not True, "INVALID_MANIFEST")
    field = "sourceRevision" if component == "iaMaster" else "sourceCommit" if component == "satellite" else "sourceSha"
    demand(manifest.get(field) == source and isinstance(manifest.get("version"), str)
           and re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?(?:\+[A-Za-z0-9][A-Za-z0-9.-]*)?",
                            manifest["version"]), "MANIFEST_SOURCE_OR_VERSION_CONFLICT")
    demand(all(manifest[name] == source for name in ("sourceSha", "sourceCommit", "sourceRevision") if name in manifest)
           and all(manifest[name] == manifest["version"] for name in ("version", "clientVersion") if name in manifest),
           "MANIFEST_IDENTITY_ALIAS_CONFLICT")
    return manifest, {"sourceSha": source, "version": manifest["version"], "manifestSha256": digest(data)}


def validate_payloads(files, source, pins):
    demand(set(pins) == set(COMPONENTS), "ALL_COMPONENTS_REQUIRED")
    manifests = {}
    for component in COMPONENTS:
        name = "manifests/" + component + "-manifest.json"
        demand(name in files, "ALL_MANIFESTS_REQUIRED")
        manifest, pin = manifest_pin(component, files[name], source)
        demand(pin == pins[component], "MANIFEST_PIN_CONFLICT")
        manifests[component] = manifest
    for component in ("server", "web"):
        expected = manifests[component].get("files")
        demand(isinstance(expected, dict) and expected, "RUNTIME_CLOSURE_REQUIRED")
        prefix = "payloads/" + component + "/"
        demand({name[len(prefix):] for name in files if name.startswith(prefix)} == set(expected),
               "RUNTIME_CLOSURE_CONFLICT")
        for name, expected_digest in expected.items():
            safe_name(name)
            demand(digest(files[prefix + name]) == expected_digest, "RUNTIME_PAYLOAD_CONFLICT")
    for component in ("iaMaster", "windowsIntegration"):
        name = "payloads/" + component + "/" + component + "-package.zip"
        demand(name in files, "ALL_COMPONENT_PAYLOADS_REQUIRED")
        verify_component_zip(files[name], files["manifests/" + component + "-manifest.json"], manifests[component])
    satellite = manifests["satellite"].get("files")
    demand(isinstance(satellite, list) and len(satellite) == 4
           and {record.get("name") for record in satellite if isinstance(record, dict)} == SATELLITE_NAMES,
           "ALL_PLATFORM_PAYLOADS_REQUIRED")
    for record in satellite:
        name = "payloads/satellite/" + record["name"]
        demand(name in files and record.get("size") == len(files[name])
               and record.get("sha256") == digest(files[name]), "SATELLITE_PAYLOAD_CONFLICT")
    beta = zip_files(files["payloads/satellite/AURORA-NEXUS-Windows-Beta.zip"])
    demand("manifest.json" in beta, "WINDOWS_MANIFEST_REQUIRED")
    windows_manifest = parse_json(beta["manifest.json"])
    demand(windows_manifest.get("sourceCommit") == source, "WINDOWS_SOURCE_CONFLICT")
    verify_component_zip(files["payloads/satellite/AURORA-NEXUS-Windows-Beta.zip"],
                         beta["manifest.json"], windows_manifest)
    mac = zip_files(files["payloads/satellite/AURORA-NEXUS-Mac-HML.zip"])
    path = "Aurora Nexus HML.app/Contents/Info.plist"
    demand(path in mac, "CHOSEN_MAC_BUNDLE_REQUIRED")
    plist = plistlib.loads(mac[path])
    demand(plist.get("CFBundleIdentifier") == MAC_IDENTITY["bundleIdentifier"]
           and plist.get("CFBundleName") == "Aurora Nexus HML"
           and plist.get("CFBundleVersion") == MAC_IDENTITY["bundleVersion"]
           and plist.get("CFBundleShortVersionString") == MAC_IDENTITY["shortVersion"],
           "CHOSEN_MAC_IDENTITY_CONFLICT")
    return manifests


def access_page(platform):
    return ('<!doctype html><html lang="pt-BR"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>AURORA NEXUS</title><p>Acesso ' + platform + ' ao mesmo portal privado.</p>'
            '<p><a href="' + PORTAL + '">Abrir AURORA NEXUS</a></p>'
            '<p>Use sua identidade individual e MFA. Este acesso web não é IPA/APK,'
            ' não instala um aplicativo nativo e não comprova aceite no dispositivo.</p></html>\n').encode("utf-8")


def adoption():
    return {
        "web": {"kind": "CANONICAL_PRIVATE_PORTAL", "entry": PORTAL, "acceptance": "PENDING"},
        "windows": {"kind": "EDGE_APP_ACCESS_CLIENT", "package": "AURORA-NEXUS-Instalar.exe",
                    "editorSignature": "PENDING", "nativeReceipt": "PENDING", "acceptance": "PENDING"},
        "mac": {"kind": "EXISTING_MAC_APP", **MAC_IDENTITY, "identityPreserved": True,
                "appleSignature": "PENDING", "nativeReceipt": "PENDING", "acceptance": "PENDING"},
        "ios": {"kind": "NATIVE_IOS_REQUESTED", "requestedDistribution": "NATIVE_TESTFLIGHT_APP_STORE",
                "nativeDeliveryStatus": "PENDING_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE",
                "availableWebChannel": "EXISTING_PWA", "entry": PORTAL,
                "nativeAppStoreBuild": False, "acceptance": "PENDING"},
        "android": {"kind": "EXISTING_PWA", "entry": PORTAL, "nativePlayStoreBuild": False, "acceptance": "PENDING"},
    }


def installation_policy():
    # Public requirements only. Operational receipts remain in the authorized organization.
    return {"schemaVersion": "aurora.installation.acceptance.v1", "status": "PENDING",
            "methods": ["CLOUD_OAUTH", "API_TOKEN", "LOCAL_AGENT", "MANUAL"],
            "requiredFlags": ["processingVerified", "receiptPersisted", "replayVerified",
                              "automationConfigured", "automationVerified", "eligible"],
            "operationalProofsIncluded": False, "installationComplete": False,
            "loginPingAndCiAreProcessingProof": False}


README = """# AURORA NEXUS — beta unificada preparada

Um releaseId, uma versão de produto e uma fonte comum ligam todos os alvos.
As versões de cada componente são preservadas nos manifestos oficiais.

Execute somente python VERIFY.py --directory . para verificar offline os bytes.
O verificador não instala, abre aplicativos, lê credenciais ou acessa a rede.
O certificado Ed25519 assinado e o payload verificado não significam assinatura
do ZIP, Authenticode, assinatura Apple, notarização ou aceite dos dispositivos.
Use --trusted-public-key-sha256 com o fingerprint público obtido fora do pacote
para validar a autoridade do certificado; a chave incluída sozinha não é confiança.

Web, iOS e Android usam https://auroranexus.com.br/portal e a identidade individual.
iOS nativo TestFlight/App Store foi solicitado e permanece pendente de build,
assinatura e aceite. O HTML iOS é somente canal web disponível e não satisfaz
essa entrega nativa. Android mantém PWA; nenhum IPA/APK/TestFlight é fabricado.
Mac preserva Aurora Nexus HML-0.2.0-hml.20261001.app e
br.com.auroranexus.desktop.hml, escolhidos pelo titular. Não renomeie nem substitua
por outro app e não sobrescreva instalação, dados ou configurações. Atualização
controlada requer backup/rollback e aceite. Não desative proteções do sistema.

Status PREPARADO, complete=false. Publicação do ponteiro, disponibilidade deste
ZIP e adoção de cada alvo são estados distintos. Um certificado não comprova
receipt, instalação, assinatura de editor, login ou funcionamento nativo.
Instalação completa exige processamento autenticado, recibo persistido, replay
idempotente e automação integrada/configurada, comprovados na organização.
Cloud/OAuth, token API, coleta local e manual mantêm pendências próprias;
login, ping e CI não comprovam ingestão. Nenhum recibo privado integra este ZIP.
"""


def build_candidate(functions, source):
    demand(isinstance(source, str) and re.fullmatch("[a-f0-9]{40}", source), "EXACT_SOURCE_SHA_REQUIRED")
    functions = Path(functions)
    files, pins = {}, {}
    for component in COMPONENTS:
        data = read_bounded(functions / "runtime-release", component + "-manifest.json")
        manifest, pins[component] = manifest_pin(component, data, source)
        files["manifests/" + component + "-manifest.json"] = data
        if component in ("server", "web"):
            demand(isinstance(manifest.get("files"), dict) and manifest["files"], "RUNTIME_CLOSURE_REQUIRED")
            for name in manifest["files"]:
                files["payloads/" + component + "/" + name] = read_bounded(functions, name)
        elif component in ("iaMaster", "windowsIntegration"):
            name = component + "-package.zip"
            files["payloads/" + component + "/" + name] = read_bounded(functions / "runtime-release", name)
        else:
            demand(isinstance(manifest.get("files"), list), "INVALID_SATELLITE_MANIFEST")
            for row in manifest["files"]:
                demand(isinstance(row, dict) and row.get("name") in SATELLITE_NAMES, "INVALID_SATELLITE_NAME")
                files["payloads/satellite/" + row["name"]] = read_bounded(functions / "private-downloads", row["name"])
    validate_payloads(files, source, pins)
    product_version = pins["server"]["version"]
    demand(pins["web"]["version"] == product_version, "PRODUCT_VERSION_CONFLICT")
    for target in ("web", "ios", "android"):
        files["access/" + target + "/index.html"] = access_page(target)
    files["README.md"] = README.encode("utf-8")
    files["VERIFY.py"] = read_regular(Path(__file__).with_name("verify_unified_beta.py"))
    identity = {"releaseId": "aurora-" + product_version + "-" + source, "productVersion": product_version,
                "sourceSha": source, "certificateSha256": None}
    index = {"schemaVersion": CANDIDATE_SCHEMA, "status": "PREPARADO", "complete": False,
             **identity, "identity": identity, "components": pins, "adoption": adoption(),
             "installationAcceptancePolicy": installation_policy(),
             "files": records(files), "allDeclaredPayloadsPresent": True, "missingTargets": ["ios-native"]}
    files["candidate-manifest.json"] = json_bytes(index)
    return archive_bytes(files), index


def verify_candidate(data, source, manifests_directory=None):
    files = zip_files(data)
    demand("candidate-manifest.json" in files, "CANDIDATE_MANIFEST_REQUIRED")
    index = parse_json(files["candidate-manifest.json"])
    demand(index.get("schemaVersion") == CANDIDATE_SCHEMA and index.get("sourceSha") == source
           and index.get("certificateSha256") is None and index.get("complete") is False
           and index.get("status") == "PREPARADO", "CANDIDATE_IDENTITY_CONFLICT")
    expected = index.get("files")
    demand(isinstance(expected, dict) and set(files) == set(expected) | {"candidate-manifest.json"}
           and records({n: b for n, b in files.items() if n != "candidate-manifest.json"}) == expected,
           "CANDIDATE_CLOSURE_CONFLICT")
    manifests = validate_payloads(files, source, index.get("components", {}))
    if manifests_directory is not None:
        for component in COMPONENTS:
            name = component + "-manifest.json"
            demand(files["manifests/" + name] == read_bounded(manifests_directory, name),
                   "DEPLOYED_MANIFEST_BYTES_CONFLICT")
    required = {"manifests/" + component + "-manifest.json" for component in COMPONENTS}
    required.update("payloads/" + component + "/" + name for component in ("server", "web")
                    for name in manifests[component]["files"])
    required.update("payloads/" + component + "/" + component + "-package.zip"
                    for component in ("iaMaster", "windowsIntegration"))
    required.update("payloads/satellite/" + name for name in SATELLITE_NAMES)
    required.update("access/" + target + "/index.html" for target in ("web", "ios", "android"))
    required.update({"README.md", "VERIFY.py", "candidate-manifest.json"})
    demand(set(files) == required, "UNEXPECTED_CANDIDATE_FILE")
    product_version = index["components"]["server"]["version"]
    demand(index["components"]["web"]["version"] == product_version, "PRODUCT_VERSION_CONFLICT")
    identity = {"releaseId": "aurora-" + product_version + "-" + source, "productVersion": product_version,
                "sourceSha": source, "certificateSha256": None}
    demand(index.get("identity") == identity
           and all(index.get(k) == v for k, v in identity.items())
           and index.get("adoption") == adoption()
           and index.get("missingTargets") == ["ios-native"]
           and index.get("installationAcceptancePolicy") == installation_policy(), "CANDIDATE_RELEASE_ID_CONFLICT")
    for target in ("web", "ios", "android"):
        demand(files.get("access/" + target + "/index.html") == access_page(target), "ACCESS_ENTRY_REQUIRED")
    demand(files.get("VERIFY.py") == read_regular(Path(__file__).with_name("verify_unified_beta.py"))
           and files.get("README.md") == README.encode("utf-8"), "REVIEWED_VERIFIER_REQUIRED")
    return files, index


def finalize(candidate, public_envelope, public_trust, source, trusted_public_key_sha256):
    files, index = verify_candidate(candidate, source)
    signed = parse_json(public_envelope)
    demand(isinstance(signed, dict) and set(signed) == {"certificate", "signature"}, "PUBLIC_ENVELOPE_REQUIRED")
    certificate = signed["certificate"]
    demand(certificate.get("sourceSha") == source and certificate.get("schemaVersion") == 2
           and certificate.get("components") == index["components"]
           and certificate.get("productVersion") == index["productVersion"], "SIGNED_CANDIDATE_CONFLICT")
    cert_hash = digest(signing_bytes(certificate))
    files["trust/certificate.json"] = json_bytes(certificate)
    files["trust/public-trust.json"] = public_trust
    files["trust/release-envelope-signed.json"] = public_envelope
    identity = {**index["identity"], "certificateSha256": cert_hash}
    delivery = {"schemaVersion": SCHEMA, "status": "PREPARADO", "complete": False, **identity,
                "identity": identity, "components": index["components"], "adoption": index["adoption"],
                "installationAcceptancePolicy": index["installationAcceptancePolicy"],
                "files": records(files), "candidateSha256": digest(candidate),
                "allDeclaredPayloadsPresent": True, "publicationAvailability": "PENDING",
                "missingTargets": index["missingTargets"],
                "remainingGates": ["FINAL_ARTIFACT_AVAILABILITY", "WINDOWS_EDITOR_SIGNATURE_AND_NATIVE_ACCEPTANCE",
                                   "MAC_APPLE_SIGNATURE_AND_NATIVE_ACCEPTANCE", "IOS_NATIVE_BUILD_SIGNING_AND_DEVICE_ACCEPTANCE",
                                   "ANDROID_PWA_DEVICE_ACCEPTANCE"]}
    files["release-envelope.json"] = json_bytes(delivery)
    files["SHA256SUMS"] = "".join(digest(data) + "  " + name + "\n" for name, data in sorted(files.items())).encode("utf-8")
    # Materialize only this process's new bounded temporary directory. No payload execution.
    with tempfile.TemporaryDirectory(prefix="aurora-unified-verify-") as temporary:
        root = Path(temporary)
        for name, data in files.items():
            path = root.joinpath(*safe_name(name))
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        result = verify(root, trusted_public_key_sha256)
        demand(result["integrityVerified"] and result["signatureVerified"]
               and result["trustedPublisherVerified"] and result["allDeclaredPayloadsPresent"],
               "FINAL_DELIVERY_VERIFICATION_REQUIRED")
    return archive_bytes(files), delivery


def write_exclusive(path, data):
    path = Path(path)
    demand(path.parent.is_dir() and not linked(path.parent), "SAFE_OUTPUT_DIRECTORY_REQUIRED")
    if path.exists():
        demand(read_regular(path) == data, "EXISTING_OUTPUT_CONFLICT")
        return
    with path.open("xb") as stream:
        stream.write(data)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("build")
    build.add_argument("--functions", type=Path, required=True)
    build.add_argument("--source-sha", required=True)
    build.add_argument("--output", type=Path, required=True)
    check = commands.add_parser("verify-candidate")
    check.add_argument("--candidate", type=Path, required=True)
    check.add_argument("--source-sha", required=True)
    check.add_argument("--manifests-directory", type=Path, required=True)
    final = commands.add_parser("finalize")
    final.add_argument("--candidate", type=Path, required=True)
    final.add_argument("--public-envelope", type=Path, required=True)
    final.add_argument("--public-trust", type=Path, required=True)
    final.add_argument("--source-sha", required=True)
    final.add_argument("--expected-candidate-sha256", required=True)
    final.add_argument("--trusted-public-key-sha256", required=True)
    final.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "build":
            data, index = build_candidate(args.functions, args.source_sha)
            verify_candidate(data, args.source_sha)
            write_exclusive(args.output, data)
        elif args.command == "verify-candidate":
            data = read_regular(args.candidate)
            _, index = verify_candidate(data, args.source_sha, args.manifests_directory)
        else:
            candidate = read_regular(args.candidate)
            demand(digest(candidate) == args.expected_candidate_sha256, "PREPROMOTION_CANDIDATE_CONFLICT")
            data, index = finalize(candidate, read_regular(args.public_envelope, 65536),
                                   read_regular(args.public_trust, 16384), args.source_sha,
                                   args.trusted_public_key_sha256)
            write_exclusive(args.output, data)
        print(json.dumps({"status": "PREPARADO", "complete": False, "sourceSha": args.source_sha,
                          "releaseId": index["releaseId"], "archiveSha256": digest(data),
                          "allDeclaredPayloadsPresent": True}, sort_keys=True))
        return 0
    except (VerificationError, OSError, ValueError):
        print(json.dumps({"status": "BLOCKED", "code": "UNIFIED_BETA_ASSEMBLY_REJECTED"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
