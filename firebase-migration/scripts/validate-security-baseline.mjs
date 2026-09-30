import fs from "node:fs";

const path = new URL("../policy/security-baseline-v1.json", import.meta.url);
const policy = JSON.parse(fs.readFileSync(path, "utf8"));

const fail = (message) => {
  console.error(`SECURITY_BASELINE_INVALID: ${message}`);
  process.exit(1);
};

if (policy.id !== "AURORA-SEC-001") fail("unexpected id");
if (policy.version !== "1.0.0") fail("unexpected version");
if (policy.transport?.minimumTls !== "1.2") fail("TLS minimum must be 1.2");
if (policy.transport?.preferredTls !== "1.3") fail("TLS preferred must be 1.3");
if (policy.integrity?.hmacMinimumSecretBits < 256) fail("HMAC secret floor must be >=256 bits");
if (!policy.integrity?.constantTimeMacComparison) fail("constant-time MAC comparison is required");

const forbidden = new Set(policy.integrity?.forbidden || []);
for (const required of ["MD5","SHA-1_FOR_SECURITY","DES","3DES","RC4","AES-ECB"]) {
  if (!forbidden.has(required)) fail(`missing forbidden algorithm ${required}`);
}

if (policy.applicationLayerEncryption?.algorithm !== "AES-256-GCM") fail("field encryption must be AES-256-GCM");
if (policy.applicationLayerEncryption?.dekBits !== 256) fail("DEK must be 256 bits");
if (policy.applicationLayerEncryption?.nonceBits !== 96) fail("GCM nonce must be 96 bits");
if (policy.applicationLayerEncryption?.keyWrapping !== "CLOUD_KMS_KEK") fail("DEK wrapping must use Cloud KMS");
if (policy.atRest?.existingGoogleEncryptedDatabaseConvertibleToCmek !== false) fail("existing Firestore must not be treated as CMEK-convertible");
if (policy.atRest?.destructiveRecreateAuthorized !== false) fail("baseline must not authorize destructive DB recreation");
if (policy.keyManagement?.persistentServiceAccountJsonAllowed !== false) fail("persistent service-account JSON must be forbidden");
if (!policy.sdlc?.unresolvedHighCriticalVulnerabilityBlocksRelease) fail("high/critical vulnerabilities must block release");

const sensitive = new Set(policy.applicationLayerEncryption?.requiredFor || []);
if (!sensitive.has("CLINICAL_SENSITIVE")) fail("clinical-sensitive encryption requirement missing");

const gates = new Set(policy.databaseGates || []);
for (const gate of ["PITR","READY_BACKUP","RESTORE_TEST_BEFORE_CUTOVER","SECURITY_RULES_TESTED","TENANT_ISOLATION_TESTED","CRYPTOGRAPHY_VERIFIED"]) {
  if (!gates.has(gate)) fail(`database gate missing: ${gate}`);
}

if ((policy.requiredMarketDocuments || []).length < 20) fail("market-readiness evidence pack is incomplete");

console.log("AURORA_SECURITY_BASELINE_OK");
