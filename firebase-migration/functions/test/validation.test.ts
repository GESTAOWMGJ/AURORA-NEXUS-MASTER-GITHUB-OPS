import assert from "node:assert/strict";
import test from "node:test";
import { validateEvent } from "../src/validation.ts";

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    eventType: "ENTITY_UPSERT",
    orgId: "wmgj",
    occurredAt: "2026-08-26T18:00:00.000Z",
    sourceVersion: 1787767200000,
    idempotencyKey: "idem-1",
    entityType: "invoice",
    entityKey: "invoice:1",
    actor: { type: "SYSTEM", id: "apps-script", source: "WMGJ_APPS_SCRIPT" },
    source: { system: "SHEETS", sourceId: "sheet:tab:2" },
    workflowState: "VALIDATED",
    reviewState: "NOT_REQUIRED",
    riskLevel: "LOW",
    sensitivity: "RESTRICTED",
    competence: "2026-08",
    record: { amount: 100 },
    ...overrides
  };
}

test("evento genérico permitido é validado", () => {
  const result = validateEvent(event(), 500);
  assert.equal(result.ok, true);
  assert.equal(result.event?.entityType, "invoice");
});

test("fontes MV TASY e ERP entram pelo mesmo contrato sanitizado", () => {
  for (const system of ["MV", "TASY", "ERP"]) {
    const result = validateEvent(event({
      eventType: "DOCUMENT_UPSERT",
      entityType: "sourceDocument",
      entityKey: `${system}:doc-1`,
      source: { system, sourceId: "doc-1", contentHash: "a".repeat(64), hashMethod: "content_sha256" },
      record: {
        category: "financeiro",
        confidence: 0.8,
        canonicalSnapshotVersion: 1,
        canonicalSnapshotHash: "b".repeat(64),
        extractionComplete: true,
        nativeReady: true,
        sourceIndependent: true,
        externalFetchRequired: false,
        externalAiUsed: false,
        originSystem: system,
        originConnector: "DRIVE_FOLDER",
        documentFragility: "NONE",
        missingFieldsCount: 0,
        flowStage: "FIREBASE_CANONICALIZED"
      },
      metadata: {
        nativeDataPlane: "FIRESTORE",
        sourceAccessRequiredAfterIngest: false,
        externalAiUsed: false,
        originConnector: "DRIVE_FOLDER",
        sourceRegistryVersion: "1"
      }
    }), 2000);
    assert.equal(result.ok, true, result.errors.join("; "));
  }
  assert.equal(validateEvent(event({ source: { system: "UNKNOWN", sourceId: "x" } }), 500).ok, false);
});

test("entityType desconhecido falha antes de chegar ao Firestore", () => {
  const result = validateEvent(event({ entityType: "arbitraryCollection" }), 500);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /entityType não permitido/);
});

test("ingestão genérica bloqueia dado clínico e decisão de revisão", () => {
  for (const candidate of [
    event({ sensitivity: "CLINICAL_SENSITIVE" }),
    event({ reviewState: "APPROVED" }),
    event({ reviewState: "REJECTED" })
  ]) {
    const result = validateEvent(candidate, 500);
    assert.equal(result.ok, false);
  }
});

test("rótulo INTERNAL ou RESTRICTED não contorna bloqueio clínico fail-closed", () => {
  const candidates = [
    event({ sensitivity: "INTERNAL", record: { patientName: "Pessoa Teste" } }),
    event({
      sensitivity: "RESTRICTED",
      record: { billing: { "Número do prontuário": "PR-123" } }
    }),
    event({
      sensitivity: "INTERNAL",
      metadata: { imported: [{ diagnostico: "conteúdo sintético" }] }
    }),
    event({
      sensitivity: "RESTRICTED",
      source: { system: "SHEETS", sourceId: "sheet:1", cpfPaciente: "00000000000" }
    })
  ];

  for (const candidate of candidates) {
    const result = validateEvent(candidate, 500);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /conteúdo clínico identificável/);
  }
});

test("identificadores técnicos e tipo documental não podem carregar referência clínica", () => {
  for (const candidate of [
    event({ entityKey: "patient:synthetic-123" }),
    event({ idempotencyKey: "wmgj:SHEETS:cpf=00000000000" }),
    event({ documentType: "Prontuário eletrônico" }),
    event({ record: { externalReference: "CPF: 000.000.000-00" } }),
    event({ record: { observation: "diagnóstico: conteúdo sintético" } }),
    event({ record: { nome: "Pessoa Teste" } }),
    event({ record: { email: "pessoa@example.test" } }),
    event({ record: { notes: "texto livre sem rótulo clínico" } })
  ]) {
    const result = validateEvent(candidate, 500);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /conteúdo clínico identificável/);
  }
});

test("política clínica preserva campos operacionais e métricas agregadas", () => {
  const result = validateEvent(event({
    record: {
      amountCents: 123_45,
      authorizationRef: "authorization:synthetic-1",
      diagnosisRate: 0.04,
      hospitalAccountId: "hospital-account:synthetic-1",
      patientCount: 12,
      professionalId: "professional:synthetic-1",
      providerId: "provider:synthetic-1",
      reconciliationStatus: "PENDING"
    },
    metadata: {
      clinicalSensitiveEnabled: false,
      fileNameWithheld: true,
      sourceContext: "pipeline-v3"
    }
  }), 500);

  assert.equal(result.ok, true, result.errors.join("; "));
});

test("amostra RC1.1 financeira permanece dentro do contrato positivo", () => {
  const common = {
    source: {
      system: "SHEETS",
      sourceId: "sheet:tab:2",
      parentId: "sheet-id",
      contentHash: "a".repeat(64),
      hashMethod: "row_sha256"
    },
    metadata: {
      sourceSheet: "06_NFS_E",
      sourceRow: 2,
      nonDestructive: true
    },
    competence: "2026-05"
  };

  const invoice = validateEvent(event({
    ...common,
    entityType: "invoice",
    entityKey: "06_NFS_E:nfe-hash-ref",
    documentType: "06_NFS_E",
    record: {
      totalCents: 4_950_000,
      reconciliationStatus: "RECONCILED_SOURCE_EVIDENCE"
    }
  }), 1000);

  const bank = validateEvent(event({
    ...common,
    entityType: "bankTransaction",
    entityKey: "08_EXTRATOS_BRADESCO:doc-ref",
    documentType: "08_EXTRATOS_BRADESCO",
    record: {
      status: "RECONCILED",
      amountCents: 4_950_000,
      liquidatedAmountCents: 4_950_000
    },
    metadata: {
      sourceSheet: "08_EXTRATOS_BRADESCO",
      sourceRow: 2,
      nonDestructive: true
    }
  }), 1000);

  assert.equal(invoice.ok, true, invoice.errors.join("; "));
  assert.equal(bank.ok, true, bank.errors.join("; "));
});

test("contrato positivo bloqueia PHI renomeada para campos genéricos", () => {
  const result = validateEvent(event({
    sensitivity: "INTERNAL",
    record: {
      titular: "Maria",
      documento: "00000000000",
      laudo: "hipertensão"
    }
  }), 500);

  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /campo fora do contrato não clínico/);
});

test("contrato positivo também rejeita extensões desconhecidas em source e metadata", () => {
  for (const candidate of [
    event({ source: { system: "SHEETS", sourceId: "sheet:1", titular: "Maria" } }),
    event({ metadata: { migrationVersion: "v1", laudo: "texto" } })
  ]) {
    const result = validateEvent(candidate, 500);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /campo fora do contrato não clínico/);
  }
});

test("entidades clínicas não pertencem à allowlist do endpoint genérico", () => {
  for (const entityType of ["patient", "clinicalEvidence", "encounter", "medicalRecord"]) {
    const result = validateEvent(event({ entityType }), 500);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /entityType não permitido/);
  }
});

test("ingestão genérica bloqueia fechamento crítico", () => {
  for (const entityType of ["monthlyClosing", "reconciliation", "hospitalAccount"]) {
    const result = validateEvent(event({ entityType, workflowState: "CLOSED" }), 500);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(" "), /fechamento crítico/);
  }
  assert.equal(validateEvent(event({ entityType: "sourceDocument", workflowState: "CLOSED" }), 500).ok, true);
});

test("eventType e entityType devem formar par canônico", () => {
  assert.equal(
    validateEvent(event({ eventType: "DOCUMENT_UPSERT", entityType: "invoice" }), 500).ok,
    false
  );
  assert.equal(
    validateEvent(event({ eventType: "AI_RUN_RECORDED", entityType: "aiRun" }), 500).ok,
    true
  );
  assert.equal(
    validateEvent(event({ eventType: "ENTITY_UPSERT", entityType: "aiRun" }), 500).ok,
    false
  );
});

test("runtime exige timestamp ISO e rejeita arrays aninhados", () => {
  assert.equal(validateEvent(event({ occurredAt: "08/26/2026 18:00" }), 500).ok, false);
  assert.equal(
    validateEvent(event({ record: { unsupported: [["nested"]] } }), 500).ok,
    false
  );
});
