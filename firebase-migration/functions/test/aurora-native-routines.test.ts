import assert from "node:assert/strict";
import test from "node:test";
import { AURORA_NATIVE_ROUTINES, nativeRoutineSummary } from "../src/auroraNativeRoutines.ts";

test("modus operandi WMGJ está representado como registro nativo multi-tenant", () => {
  const ids = new Set(AURORA_NATIVE_ROUTINES.map((item) => item.id));
  for (const id of ["AURORA-RUNTIME-WATCHDOG","AURORA-PROJECTION-ENGINE","AURORA-DOCUMENT-WATCHDOG","AURORA-FIN-SOC-001","AURORA-REV-SAN-001","AURORA-TECH-AUDIT-WEEKLY"]) {
    assert.ok(ids.has(id), id);
  }
  assert.ok(AURORA_NATIVE_ROUTINES.every((item) => item.sourceMutation === false));
});

test("rotinas legadas ficam espelhadas até migração e nunca são fingidas como nativas ativas", () => {
  const legacy = AURORA_NATIVE_ROUTINES.filter((item) => item.state === "LEGACY_MIRRORED");
  assert.ok(legacy.length >= 2);
  assert.ok(legacy.every((item) => item.id.startsWith("WMGJ-LEGACY-")));
});

test("aprendizado orgânico promove capacidade, não dados entre clientes", () => {
  const summary = nativeRoutineSummary() as any;
  assert.equal(summary.organicPromotion.tenantRawDataTransfer, false);
  assert.equal(summary.organicPromotion.validatedOutcomeRequired, true);
  assert.equal(summary.organicPromotion.humanReviewRequired, true);
  assert.equal(summary.organicPromotion.tenantAgnosticAbstractionRequired, true);
});
