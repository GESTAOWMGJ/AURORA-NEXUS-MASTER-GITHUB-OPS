import fs from "node:fs";

const path = new URL("../policy/cmek-hml-baseline-v1.json", import.meta.url);
const p = JSON.parse(fs.readFileSync(path, "utf8"));

const fail = (m) => { console.error("CMEK_HML_BASELINE_INVALID:", m); process.exit(1); };

if (p.id !== "AURORA-SEC-002-CMEK-HML") fail("id");
if (p.status !== "PREPARED_NOT_APPLIED") fail("status must remain plan-only in repo");
if (p.projectId !== "wmgj-hml-jfn-20260927") fail("project");
if (p.databaseId !== "aurora-hml-cmek") fail("database");
if (p.location !== "southamerica-east1") fail("location");
if (p.firestoreCmekFeatureAccessRequired !== true) fail("CMEK feature access gate");
if (p.firestoreCmekFeatureAccessState !== "MUST_BE_CONFIRMED_BEFORE_APPLY") fail("CMEK feature access state");
if (p.sameLocationKmsRequired !== true) fail("KMS location binding");
if (p.serviceAgentRole !== "roles/cloudkms.cryptoKeyEncrypterDecrypter") fail("service agent role");
if (p.type !== "firestore-native") fail("type");
if (p.edition !== "standard") fail("edition");
if (p.keyRing !== "aurora-hml-firestore") fail("keyRing");
if (p.cryptoKey !== "aurora-firestore-cmek") fail("cryptoKey");
if (p.rotationDays !== 90) fail("rotation");
if (p.deleteProtection !== true || p.pitr !== true) fail("db protection");
if (p.backup?.recurrence !== "daily" || p.backup?.retention !== "14d") fail("backup");
if (p.productionMutation !== false) fail("production mutation must be false");
if (p.clinicalSensitiveEnabled !== false) fail("clinical must be false");
if (p.realDataAllowed !== false) fail("real data must be false");
if (p.destructiveOperationsAllowed !== false) fail("destructive operations");
if (p.keyDestructionAllowed !== false) fail("key destruction");
if (p.keyFailureTest?.action !== "TEMPORARY_DISABLE_ENABLE_ONLY") fail("failure test");
if (p.keyFailureTest?.destroyForbidden !== true) fail("destroy forbidden");
if (p.applyConfirmation !== "APPLY_AURORA_CMEK_HML") fail("apply confirmation");
if (p.restoreConfirmation !== "RESTORE_AURORA_CMEK_HML") fail("restore confirmation");

console.log("AURORA_CMEK_HML_BASELINE_OK");
