import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { validateEvent } from "../src/validation.ts";

function sampleEvents() {
  const context: any = vm.createContext({
    Utilities: { getUuid: () => "synthetic-rc11-event" }
  });
  vm.runInContext(readFileSync(new URL("../../../src/34_AURORA_RC11_FIRESTORE_CONTROL.gs", import.meta.url), "utf8"), context);
  context.auroraRc11BuscarLinha_ = (sheet: string) => ({
    ss: { getId: () => "synthetic-sheet" },
    map: { valor_servico: 0, credito: 0 }, raw: [49500], display: ["49.500,00"],
    headers: ["valor"], rowNumber: 2,
    record: sheet === "06_NFS_E" ? { chave_acesso: "synthetic-access" } : { dcto: "synthetic-bank" }
  });
  context.wmgjFirestoreBrlToCents_ = () => 4950000;
  context.wmgjFirestoreRowObject_ = () => ({ valor: "49.500,00" });
  context.wmgjFirestoreHashString_ = (s: string) => createHash("sha256").update(s).digest("hex");
  context.wmgjFirestoreActorId_ = () => "synthetic-actor";
  return [context.auroraRc11InvoiceEvent_(), context.auroraRc11BankEvent_()]
    .map(event => JSON.parse(JSON.stringify(event)));
}

test("actual RC1.1 builders emit invoice and receipt accepted by the backend contract", () => {
  const events = sampleEvents();
  assert.equal(events[0].record.totalCents, 4950000);
  assert.match(events[0].record.invoiceNumberHash, /^[a-f0-9]{64}$/);
  assert.equal(events[1].record.liquidatedAmountCents, 4950000);
  assert.equal(events[1].record.kind, "RECEIPT");
  for (const event of events) {
    const result = validateEvent(event, Buffer.byteLength(JSON.stringify(event)));
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(event.metadata.pipelineVersion, "AURORA_RC11_WMGJ");
  }
});

test("RC1.1 contract still rejects old extensions and clinical content", () => {
  for (const event of sampleEvents()) {
    const extended = structuredClone(event);
    extended.metadata.rc11Sample = true;
    assert.equal(validateEvent(extended, 2000).ok, false);
    const clinical = structuredClone(event);
    clinical.record.paciente = "synthetic-only";
    const result = validateEvent(clinical, 2000);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.includes("clínico")));
  }
});
