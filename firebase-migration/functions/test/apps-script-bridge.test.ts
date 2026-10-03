import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { canonicalHmacV2Payload, signHmacV2, type HmacV2Headers } from "../src/security.ts";
import { validateEvent } from "../src/validation.ts";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const migrationRoot = path.resolve(testDir, "../..");

function appsScriptContext(): Record<string, unknown> {
  const context: Record<string, unknown> = {
    Logger: { log() {} },
    Utilities: {
      Charset: { UTF_8: "UTF-8" },
      DigestAlgorithm: { SHA_256: "SHA_256" },
      computeDigest(_algorithm: string, value: string | number[]) {
        const data = Array.isArray(value) ? Buffer.from(value) : Buffer.from(String(value), "utf8");
        return [...createHash("sha256").update(data).digest()];
      },
      computeHmacSha256Signature(value: string | number[], secret: string | number[]) {
        const data = Array.isArray(value) ? Buffer.from(value) : Buffer.from(value, "utf8");
        const key = Array.isArray(secret) ? Buffer.from(secret) : Buffer.from(secret, "utf8");
        return [...createHmac("sha256", key).update(data).digest()];
      },
      newBlob(value: string) {
        return { getBytes: () => [...Buffer.from(String(value), "utf8")] };
      },
      getUuid() { return "0f719f5a-0806-4b2b-a40c-717371d275ee"; }
    }
  };
  vm.createContext(context);
  for (const relative of [
    "../src/35_AURORA_FIRESTORE_BRIDGE_WMGJ.gs",
    "../src/36_AURORA_FIRESTORE_MIGRATION_WMGJ.gs",
    "../src/34_AURORA_RC11_FIRESTORE_CONTROL.gs"
  ]) {
    vm.runInContext(fs.readFileSync(path.join(migrationRoot, relative), "utf8"), context, {
      filename: relative
    });
  }
  return context;
}

function rc11EventPair(context: any) {
  const invoiceHash = createHash("sha256").update("invoice-row-2").digest("hex");
  const bankHash = createHash("sha256").update("bank-row-7").digest("hex");
  const invoice = {
    eventId: "invoice-event", idempotencyKey: `wmgj:AURORA_RC11_V2:SHEETS:spreadsheet-wmgj:06_NFS_E:2:${invoiceHash}`,
    orgId: "wmgj", entityType: "invoice", competence: "2026-05",
    entityKey: "06_NFS_E:CHAVE-NF-8",
    metadata: { rc11Sample: true, sourceSheet: "06_NFS_E", sourceRow: 2 },
    record: { invoiceNumber: "8", totalCents: 4_950_000 },
    source: {
      sourceId: "spreadsheet-wmgj:06_NFS_E:2",
      parentId: "spreadsheet-wmgj",
      contentHash: invoiceHash
    }
  };
  const invoiceEntityId = context.wmgjFirestoreHashString_(`invoice:${invoice.entityKey}`).slice(0, 48);
  const bank = {
    eventId: "bank-event", idempotencyKey: `wmgj:AURORA_RC11_V2:SHEETS:spreadsheet-wmgj:08_EXTRATOS_BRADESCO:7:${bankHash}`,
    orgId: "wmgj", entityType: "bankTransaction", competence: "2026-05",
    entityKey: "08_EXTRATOS_BRADESCO:legacy-row:7",
    metadata: { rc11Sample: true, sourceSheet: "08_EXTRATOS_BRADESCO", sourceRow: 7 },
    record: {
      transactionKind: "RECEIPT", invoiceEntityId,
      amountCents: 4_950_000, liquidatedAmountCents: 4_950_000
    },
    source: {
      sourceId: "spreadsheet-wmgj:08_EXTRATOS_BRADESCO:7",
      parentId: "spreadsheet-wmgj",
      contentHash: bankHash
    }
  };
  return { invoice, bank };
}

function rc11LiveHarness(options: {
  cfg?: Record<string, unknown>;
  existingReceipt?: string;
  send?: (invoice: any, bank: any, cfg: any, capability: any) => any;
} = {}) {
  const context = appsScriptContext() as any;
  const pair = rc11EventPair(context);
  const sampleContract = context.auroraRc11ContratoParDosEventos_(pair.invoice, pair.bank);
  const baseCfg = {
    url: "https://ingestwmgjevent-abc-uc.a.run.app",
    keyId: "key-1", secret: "a".repeat(64), orgId: "wmgj", dryRun: true, maxRows: 2,
    ...options.cfg
  };
  const requestSha = "b".repeat(40);
  const expiresAt = String(Math.floor(Date.now() / 1000) + 600);
  const expectedUrl = "https://ingestwmgjevent-abc-uc.a.run.app";
  const expectedKeyId = "key-1";
  const canonical = context.auroraRc11CanonicalAutorizacao_(
    expectedUrl, expectedKeyId, requestSha, expiresAt, sampleContract.pairBindingSha256
  );
  const authorizationHmac = createHmac("sha256", Buffer.from(String(baseCfg.secret), "hex")).update(canonical).digest("hex");
  const receiptKey = context.auroraRc11ReceiptKey_(requestSha, sampleContract.pairBindingSha256);
  const properties = new Map<string, string>();
  if (options.existingReceipt !== undefined) properties.set(receiptKey, options.existingReceipt);
  const propertyWrites: Array<{ key: string; value: string }> = [];
  const lockEvents: string[] = [];
  let sourceReads = 0;
  let pairCalls = 0;

  context.wmgjFirestoreConfig_ = () => ({ ...baseCfg });
  context.LockService = {
    getScriptLock: () => ({
      tryLock: () => { lockEvents.push("acquire"); return true; },
      releaseLock: () => { lockEvents.push("release"); }
    })
  };
  context.PropertiesService = {
    getScriptProperties: () => ({
      getProperty(name: string) { return properties.has(name) ? properties.get(name)! : null; },
      setProperty(name: string, value: string) {
        properties.set(name, value);
        propertyWrites.push({ key: name, value });
      }
    })
  };
  context.auroraRc11InvoiceEvent_ = (row: number) => {
    sourceReads += 1;
    assert.equal(row, sampleContract.invoice.sourceRow);
    return pair.invoice;
  };
  context.auroraRc11BankEvent_ = (invoiceKey: string, row: number) => {
    sourceReads += 1;
    assert.equal(invoiceKey, pair.invoice.entityKey);
    assert.equal(row, sampleContract.bank.sourceRow);
    return pair.bank;
  };
  context.wmgjFirestoreEnviarParRc11_ = (invoice: any, bank: any, cfg: any, capability: any) => {
    pairCalls += 1;
    return (options.send || (() => ({
      invoiceResult: { ok: true, accepted: true, duplicate: false, entityId: "invoice-id" },
      bankResult: { ok: true, accepted: true, duplicate: false, entityId: "bank-id" }
    })))(invoice, bank, cfg, capability);
  };

  return {
    context, pair, sampleContract, baseCfg, requestSha, expiresAt, expectedUrl, expectedKeyId,
    authorizationHmac, receiptKey, properties, propertyWrites, lockEvents,
    sourceReads: () => sourceReads,
    pairCalls: () => pairCalls,
    invoke(overrides: Partial<{
      confirmation: string; expectedUrl: string; expectedKeyId: string; requestSha: string;
      expiresAt: string; authorizationHmac: string; sampleContract: any;
    }> = {}) {
      return context.auroraRc11EnviarAmostraReal(
        overrides.confirmation ?? "ATIVAR_RC11_WMGJ_HML",
        overrides.expectedUrl ?? expectedUrl,
        overrides.expectedKeyId ?? expectedKeyId,
        overrides.requestSha ?? requestSha,
        overrides.expiresAt ?? expiresAt,
        overrides.authorizationHmac ?? authorizationHmac,
        overrides.sampleContract ?? sampleContract
      );
    },
    sign(overrides: Partial<{ expectedUrl: string; expectedKeyId: string; requestSha: string; expiresAt: string; sampleContract: any }> = {}) {
      const contract = overrides.sampleContract ?? sampleContract;
      const authCanonical = context.auroraRc11CanonicalAutorizacao_(
        overrides.expectedUrl ?? expectedUrl,
        overrides.expectedKeyId ?? expectedKeyId,
        overrides.requestSha ?? requestSha,
        overrides.expiresAt ?? expiresAt,
        contract.pairBindingSha256
      );
      return createHmac("sha256", Buffer.from(String(baseCfg.secret), "hex")).update(authCanonical).digest("hex");
    }
  };
}

test("bridge normaliza risco PT/EN para enum canônico", () => {
  const context = appsScriptContext() as any;
  assert.equal(context.wmgjFirestoreRiskLevel_("baixo"), "LOW");
  assert.equal(context.wmgjFirestoreRiskLevel_("médio"), "MEDIUM");
  assert.equal(context.wmgjFirestoreRiskLevel_("alto"), "HIGH");
  assert.equal(context.wmgjFirestoreRiskLevel_("crítico"), "CRITICAL");
  assert.equal(context.wmgjFirestoreRiskLevel_("desconhecido"), "MEDIUM");
});

test("normalizador BRL preserva zero, sinal e converte para centavos inteiros", () => {
  const context = appsScriptContext() as any;
  assert.equal(context.wmgjFirestoreBrlToCents_(1234.56, "R$ 1.234,56"), 123456);
  assert.equal(context.wmgjFirestoreBrlToCents_("1.234,56", "1.234,56"), 123456);
  assert.equal(context.wmgjFirestoreBrlToCents_("R$ 1.234,56", "R$ 1.234,56"), 123456);
  assert.equal(context.wmgjFirestoreBrlToCents_("0,00", "0,00"), 0);
  assert.equal(context.wmgjFirestoreBrlToCents_("-12,34", "-12,34"), -1234);
  assert.equal(context.wmgjFirestoreBrlToCents_("", ""), null);
});

test("normalizador BRL falha fechado em formato ambíguo, precisão ou faixa inválida", () => {
  const context = appsScriptContext() as any;
  for (const value of ["1,234.56", "12,345", "1e3", "não é valor"]) {
    assert.throws(() => context.wmgjFirestoreBrlToCents_(value, value), /MONEY_/);
  }
  assert.throws(() => context.wmgjFirestoreBrlToCents_(Number.MAX_SAFE_INTEGER, String(Number.MAX_SAFE_INTEGER)), /MONEY_/);
});

test("normalizador financeiro retorna somente campo canônico em centavos", () => {
  const context = appsScriptContext() as any;
  const headers = ["Número NF", "Valor Total", "Observação"];
  const sourceRecord = context.wmgjFirestoreRowObject_(headers, ["NF-1", "R$ 1.234,56", "texto legado"]);
  const raw = ["NF-1", 1234.56, "texto legado"];
  const display = ["NF-1", "R$ 1.234,56", "texto legado"];
  const normalized = context.wmgjFirestoreAddCanonicalMoney_(headers, raw, display, sourceRecord, {
    totalCents: ["valor_total"]
  });
  assert.equal(normalized.totalCents, 123456);
  assert.deepEqual(Object.keys(normalized), ["totalCents"]);
  assert.equal("numero_nf" in normalized, false);
  assert.equal("observacao" in normalized, false);
  assert.equal(raw[1], 1234.56);
});

test("evento exato do migrador canônico passa pela validação sem contrabandear legado", () => {
  const context = appsScriptContext() as any;
  const config = context.wmgjFirestoreMigrationMap_()["06_NFS_E"];
  const headers = [
    "Competência Assistencial",
    "Status Extração",
    "Número NF",
    "Valor Serviço",
    "Observação",
    "Environment",
    "Record Type"
  ];
  const display = [
    "2026-06",
    "VALIDADO",
    "9",
    "R$ 49.500,00",
    "diagnóstico: narrativa legada que não pode sair da origem",
    "HOMOLOGATION",
    "OPERACIONAL"
  ];
  const raw = ["2026-06", "VALIDADO", "9", 49500, display[4], "HOMOLOGATION", "OPERACIONAL"];
  const occurredAt = vm.runInContext('new Date("2026-10-02T12:00:00.000Z")', context);
  const event = context.wmgjFirestoreBuildEvent_(
    "spreadsheet-wmgj",
    "06_NFS_E",
    config,
    headers,
    raw,
    display,
    2,
    { orgId: "wmgj", dryRun: true },
    occurredAt
  );

  assert.equal(event.record.totalCents, 4_950_000);
  assert.match(event.record.invoiceNumberHash, /^[a-f0-9]{64}$/);
  assert.equal(event.record.sourceRowHash, event.source.contentHash);
  assert.equal(event.competence, "2026-06");
  for (const forbidden of ["observacao", "environment", "record_type", "valor_servico", "numero_nf"]) {
    assert.equal(forbidden in event.record, false, forbidden);
  }
  assert.doesNotMatch(JSON.stringify(event), /narrativa legada|diagn[oó]stico|HOMOLOGATION|OPERACIONAL/i);

  const validation = validateEvent(event, Buffer.byteLength(JSON.stringify(event), "utf8"));
  assert.equal(validation.ok, true, validation.errors.join("; "));
});

test("migrador bancário mantém discriminador RECEIPT e contrato estrito", () => {
  const context = appsScriptContext() as any;
  const config = context.wmgjFirestoreMigrationMap_()["08_EXTRATOS_BRADESCO"];
  const headers = [
    "Competência Assistencial Relacionada",
    "Status Conciliação",
    "Subcategoria",
    "Crédito",
    "Dcto",
    "Histórico"
  ];
  const display = ["2026-06", "CONCILIADO", "RECEBIMENTO_NFS_E", "R$ 49.500,00", "DOC-9", "texto bancário legado"];
  const raw = ["2026-06", "CONCILIADO", "RECEBIMENTO_NFS_E", 49500, "DOC-9", "texto bancário legado"];
  const event = context.wmgjFirestoreBuildEvent_(
    "spreadsheet-wmgj",
    "08_EXTRATOS_BRADESCO",
    config,
    headers,
    raw,
    display,
    7,
    { orgId: "wmgj", dryRun: true },
    vm.runInContext('new Date("2026-10-02T12:00:00.000Z")', context)
  );

  assert.equal(event.competence, "2026-06");
  assert.equal(event.record.amountCents, 4_950_000);
  assert.equal(event.record.liquidatedAmountCents, 4_950_000);
  assert.equal(event.workflowState, "PENDING_EVIDENCE");
  assert.equal(event.reviewState, "PENDING");
  assert.equal(event.record.status, "SOURCE_REPORTED_RECONCILED");
  assert.equal(event.record.reconciliationStatus, "PENDING_EVIDENCE");
  assert.equal(event.record.transactionKind, "RECEIPT");
  assert.equal("historico" in event.record, false);
  assert.equal("subcategoria" in event.record, false);

  const validation = validateEvent(event, Buffer.byteLength(JSON.stringify(event), "utf8"));
  assert.equal(validation.ok, true, validation.errors.join("; "));

  const tampered = JSON.parse(JSON.stringify(event));
  tampered.record.transactionKind = "FREE_TEXT";
  const rejected = validateEvent(tampered, Buffer.byteLength(JSON.stringify(tampered), "utf8"));
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join("; "), /transactionKind deve usar enum financeiro canônico/);
});

test("backfill genérico falha fechado para as duas linhas reservadas ao RC1.1", () => {
  const context = appsScriptContext() as any;
  const mapping = context.wmgjFirestoreMigrationMap_();
  const occurredAt = vm.runInContext('new Date("2026-10-02T12:00:00.000Z")', context);
  const fixtures = [
    {
      sheet: "06_NFS_E",
      headers: ["Competência Assistencial", "Status Extração", "Número NF", "Valor Serviço", "Chave Acesso"],
      raw: ["2026-05", "VALIDADO", "8", 49500, "CHAVE-NF-8"],
      display: ["2026-05", "VALIDADO", "8", "R$ 49.500,00", "CHAVE-NF-8"],
      row: 2
    },
    {
      sheet: "08_EXTRATOS_BRADESCO",
      headers: ["Competência Assistencial Relacionada", "Status Conciliação", "Subcategoria", "Crédito", "Dcto"],
      raw: ["2026-05", "CONCILIADO", "RECEBIMENTO_NFS_E", 49500, "DOC-8"],
      display: ["2026-05", "CONCILIADO", "RECEBIMENTO_NFS_E", "R$ 49.500,00", "DOC-8"],
      row: 7
    }
  ];

  for (const fixture of fixtures) {
    assert.throws(() => context.wmgjFirestoreBuildEvent_(
      "spreadsheet-wmgj",
      fixture.sheet,
      mapping[fixture.sheet],
      fixture.headers,
      fixture.raw,
      fixture.display,
      fixture.row,
      { orgId: "wmgj", dryRun: true },
      occurredAt
    ), /RC11_RESERVED_SOURCE_ROW_REQUIRES_DEDICATED_PIPELINE/);
  }
});

test("todas as fontes documentais suportadas produzem DOCUMENT_UPSERT válido", () => {
  const context = appsScriptContext() as any;
  const mapping = context.wmgjFirestoreMigrationMap_();
  const supportedDocuments = [
    "01_CADASTRO_ARQUIVOS",
    "14_MEMORIA_BASE_DOCUMENTOS",
    "21_GMAIL_INDEXACAO_FATURAMENTO"
  ];

  for (const [index, sheetName] of supportedDocuments.entries()) {
    const event = context.wmgjFirestoreBuildEvent_(
      "spreadsheet-wmgj",
      sheetName,
      mapping[sheetName],
      ["Status Processamento", "ID Drive", "Observação"],
      ["PROCESSADO", `drive-${index + 1}`, "narrativa legada local"],
      ["PROCESSADO", `drive-${index + 1}`, "narrativa legada local"],
      index + 2,
      { orgId: "wmgj", dryRun: true },
      vm.runInContext('new Date("2026-10-02T12:00:00.000Z")', context)
    );
    assert.equal(event.eventType, "DOCUMENT_UPSERT");
    assert.equal(event.entityType, "sourceDocument");
    assert.match(event.record.documentIdHash, /^[a-f0-9]{64}$/);
    assert.equal("observacao" in event.record, false);
    const validation = validateEvent(event, Buffer.byteLength(JSON.stringify(event), "utf8"));
    assert.equal(validation.ok, true, `${sheetName}: ${validation.errors.join("; ")}`);
  }
});

test("status de liquidação valida somente entidades financeiras compatíveis", () => {
  const context = appsScriptContext() as any;
  for (const status of ["LIQUIDADO", "LIQUIDATED", " conciliado ", "RECONCILED", "MATCHED"]) {
    assert.deepEqual(
      { ...context.wmgjFirestoreWorkflowFromLegacy_(status, "bankTransaction") },
      { state: "VALIDATED", review: "NOT_REQUIRED", risk: "LOW" }
    );
  }
  assert.equal(context.wmgjFirestoreWorkflowFromLegacy_("PENDENTE_CONCILIADO", "bankTransaction").state, "PENDING_HUMAN_REVIEW");
  assert.equal(context.wmgjFirestoreWorkflowFromLegacy_("LIQUIDADO", "invoice").state, "RECEIVED");
});

test("bridge usa a revisão temporal da fonte antes do horário de envio", () => {
  const context = appsScriptContext() as any;
  const source = vm.runInContext('new Date("2026-08-25T10:00:00.123Z")', context);
  const sent = vm.runInContext('new Date("2026-08-26T18:00:00.000Z")', context);
  assert.equal(context.wmgjFirestoreSourceVersion_(source, sent), source.getTime());
  assert.equal(context.wmgjFirestoreSourceVersion_(null, sent), sent.getTime());
});

test("entityKey de planilha é estável e não contém rowHash", () => {
  const context = appsScriptContext() as any;
  const record = { numero_nf: "123", competencia: "2026-08", status: "PENDENTE" };
  const first = context.wmgjFirestoreEntityKey_("06_NFS_E", record, 2, "a".repeat(64));
  const second = context.wmgjFirestoreEntityKey_("06_NFS_E", record, 2, "b".repeat(64));
  assert.equal(first, second);
  assert.equal(first, "06_NFS_E:legacy-row:2");
  assert.equal(
    context.wmgjFirestoreEntityKey_("06_NFS_E", { chave_acesso: "NFE-UNICA" }, 2),
    "06_NFS_E:NFE-UNICA"
  );
  assert.equal(
    context.wmgjFirestoreEntityKey_("SEM_CHAVE", {}, 9),
    "SEM_CHAVE:legacy-row:9"
  );
});

test("primeiro backfill identifica cabeçalhos clínicos para quarentena fail-closed", () => {
  const context = appsScriptContext() as any;
  assert.deepEqual(
    [...context.wmgjFirestoreClinicalHeaders_([
      "Competência",
      "Nome do paciente",
      "CPF",
      "Diagnóstico",
      "Número do prontuário"
    ])],
    ["cpf", "diagnostico", "nome_do_paciente", "numero_do_prontuario"]
  );
  assert.deepEqual(
    [...context.wmgjFirestoreClinicalHeaders_(["Competência", "CNPJ", "Médico prestador"])],
    []
  );
});

test("mapa de backfill habilita somente coleções consumidas pela projeção atual", () => {
  const context = appsScriptContext() as any;
  const mapping = context.wmgjFirestoreMigrationMap_();
  const supported = Object.entries(mapping)
    .filter(([, config]: any) => config.supported === true)
    .map(([sheetName]) => sheetName)
    .sort();
  assert.deepEqual(supported, [
    "01_CADASTRO_ARQUIVOS",
    "06_NFS_E",
    "08_EXTRATOS_BRADESCO",
    "14_MEMORIA_BASE_DOCUMENTOS",
    "21_GMAIL_INDEXACAO_FATURAMENTO"
  ]);
  for (const config of Object.values(mapping) as any[]) {
    assert.ok(
      config.supported === true || (
        config.supported === false
        && config.quarantineReason === "ENTITY_NOT_PROJECTED_BY_CURRENT_ENGINE"
      )
    );
  }
});

test("mapeamentos fora da projeção atual ficam em quarentena sem leitura ou envio", () => {
  const context = appsScriptContext() as any;
  const calls: string[] = [];
  context.wmgjFirestoreEnviarEvento_ = () => {
    calls.push("send");
    throw new Error("UNSUPPORTED_SOURCE_MUST_NOT_BE_SENT");
  };
  context.wmgjFirestoreLog_ = (event: string) => calls.push(event);
  context.PropertiesService = {
    getScriptProperties() {
      calls.push("properties");
      return { getProperty() { return null; }, setProperty() { calls.push("checkpoint"); } };
    }
  };
  const sheet = {
    getLastRow() { return 3; },
    getLastColumn() { calls.push("width"); return 2; },
    getRange() { calls.push("rows"); throw new Error("UNSUPPORTED_SOURCE_MUST_NOT_BE_READ"); }
  };
  const spreadsheet = {
    getId() { return "sheet-wmgj"; },
    getSheetByName() { return sheet; }
  };
  const config = context.wmgjFirestoreMigrationMap_()["05_FINANCEIRO_MENSAL"];

  const result = context.wmgjFirestoreMigrarAba_(
    spreadsheet,
    "05_FINANCEIRO_MENSAL",
    config,
    10,
    { orgId: "wmgj", dryRun: false }
  );

  assert.equal(result.ok, false);
  assert.equal(result.quarantined, true);
  assert.equal(result.unsupported, true);
  assert.equal(result.reason, "ENTITY_NOT_PROJECTED_BY_CURRENT_ENGINE");
  assert.equal(result.sent, 0);
  assert.equal(result.checkpointAdvanced, false);
  assert.deepEqual(calls, ["MIGRATION_QUARANTINE"]);
});

test("migrador quarentena aba clínica sem ler linhas nem avançar checkpoint", () => {
  const context = appsScriptContext() as any;
  const calls: Array<{ row: number; rows: number }> = [];
  const logs: Array<{ event: string; status: string; payload: any }> = [];
  context.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty() { return null; },
        setProperty() { throw new Error("CHECKPOINT_NAO_DEVE_AVANCAR"); }
      };
    }
  };
  context.wmgjFirestoreLog_ = (event: string, status: string, payload: any) => {
    logs.push({ event, status, payload });
  };
  const sheet = {
    getLastRow() { return 3; },
    getLastColumn() { return 2; },
    getRange(row: number, _column: number, rows: number) {
      calls.push({ row, rows });
      if (row === 1 && rows === 1) {
        return { getDisplayValues() { return [["Competência", "CPF paciente"]]; } };
      }
      throw new Error("LINHAS_CLINICAS_NAO_DEVEM_SER_LIDAS");
    }
  };
  const spreadsheet = {
    getId() { return "sheet-clinical"; },
    getSheetByName() { return sheet; }
  };

  const result = context.wmgjFirestoreMigrarAba_(
    spreadsheet,
    "ABA_CLINICA",
    { supported: true, entityType: "sourceDocument", sensitivity: "RESTRICTED" },
    10,
    { orgId: "wmgj", dryRun: false }
  );

  assert.equal(result.ok, false);
  assert.equal(result.quarantined, true);
  assert.equal(result.checkpointAdvanced, false);
  assert.deepEqual(calls, [{ row: 1, rows: 1 }]);
  assert.equal(logs[0]?.event, "MIGRATION_QUARANTINE");
  assert.equal(logs[0]?.status, "ERRO");
  assert.deepEqual([...logs[0]?.payload.blockedHeaders], ["cpf_paciente"]);
});

test("eventos exatos RC1.1 passam no contrato e preservam o tipo RECEIPT", () => {
  const context = appsScriptContext() as any;
  context.auroraRc11BuscarLinha_ = (sheetName: string) => {
    if (sheetName === "06_NFS_E") {
      const headers = ["Competência Assistencial", "Número NF", "Status Extração", "Valor Serviço", "Chave Acesso"];
      return {
        ss: { getId() { return "spreadsheet-wmgj"; } },
        headers,
        map: { competencia_assistencial: 0, numero_nf: 1, status_extracao: 2, valor_servico: 3, chave_acesso: 4 },
        display: ["2026-05", "8", "VALIDADO", "R$ 49.500,00", "CHAVE-NF-8"],
        raw: ["2026-05", "8", "VALIDADO", 49500, "CHAVE-NF-8"],
        rowNumber: 2,
        record: {
          competencia_assistencial: "2026-05",
          numero_nf: "8",
          status_extracao: "VALIDADO",
          valor_servico: "R$ 49.500,00",
          chave_acesso: "CHAVE-NF-8"
        }
      };
    }
    if (sheetName === "08_EXTRATOS_BRADESCO") {
      const headers = ["Competência Assistencial Relacionada", "Subcategoria", "Status Conciliação", "Crédito", "Dcto"];
      return {
        ss: { getId() { return "spreadsheet-wmgj"; } },
        headers,
        map: { competencia_assistencial_relacionada: 0, subcategoria: 1, status_conciliacao: 2, credito: 3, dcto: 4 },
        display: ["2026-05", "RECEBIMENTO_NFS_E", "CONCILIADO", "R$ 49.500,00", "DOC-8"],
        raw: ["2026-05", "RECEBIMENTO_NFS_E", "CONCILIADO", 49500, "DOC-8"],
        rowNumber: 7,
        record: {
          competencia_assistencial_relacionada: "2026-05",
          subcategoria: "RECEBIMENTO_NFS_E",
          status_conciliacao: "CONCILIADO",
          credito: "R$ 49.500,00",
          dcto: "DOC-8"
        }
      };
    }
    throw new Error(`UNEXPECTED_SHEET:${sheetName}`);
  };

  const invoice = context.auroraRc11InvoiceEvent_();
  const bank = context.auroraRc11BankEvent_(invoice.entityKey);
  const expectedInvoiceId = createHash("sha256").update(`invoice:${invoice.entityKey}`).digest("hex").slice(0, 48);
  assert.equal(bank.record.transactionKind, "RECEIPT");
  assert.equal(bank.record.invoiceEntityId, expectedInvoiceId);
  assert.equal(invoice.sourceVersion, 2);
  assert.equal(bank.sourceVersion, 2);
  assert.match(invoice.idempotencyKey, /AURORA_RC11_V2/);
  assert.match(bank.idempotencyKey, /AURORA_RC11_V2/);
  assert.equal(bank.entityKey, "08_EXTRATOS_BRADESCO:legacy-row:7");
  for (const candidate of [invoice, bank]) {
    const result = validateEvent(candidate, Buffer.byteLength(JSON.stringify(candidate), "utf8"));
    assert.equal(result.ok, true, `${candidate.entityType}: ${result.errors.join("; ")}`);
  }

  const unlinked = JSON.parse(JSON.stringify(bank));
  delete unlinked.record.invoiceEntityId;
  const rejected = validateEvent(unlinked, Buffer.byteLength(JSON.stringify(unlinked), "utf8"));
  assert.equal(rejected.ok, false);
  assert.match(rejected.errors.join("; "), /recebimento conciliado exige invoiceEntityId válido/);
});

test("binding RC1.1 tem paridade canônica e rejeita qualquer evidência adulterada", () => {
  const context = appsScriptContext() as any;
  const pair = rc11EventPair(context);
  const contract = context.auroraRc11ContratoParDosEventos_(pair.invoice, pair.bank);
  const canonical = [
    "AURORA_RC11_PAIR_V1", "1", "wmgj", "2026-05", "8", "2",
    contract.sourceParentSha256,
    "06_NFS_E", String(contract.invoice.sourceRow), contract.invoice.contentHash,
    contract.invoiceIdempotencySha256, "4950000",
    "08_EXTRATOS_BRADESCO", String(contract.bank.sourceRow), contract.bank.contentHash,
    contract.bankIdempotencySha256, "4950000"
  ].join("\n");
  assert.equal(context.auroraRc11CanonicalVinculoPar_(contract), canonical);
  assert.equal(contract.pairBindingSha256, createHash("sha256").update(canonical).digest("hex"));
  assert.equal(context.auroraRc11ValidarContratoPar_(contract), contract);

  for (const mutate of [
    (candidate: any) => { candidate.invoice.contentHash = "0".repeat(64); },
    (candidate: any) => { candidate.bank.sourceRow += 1; },
    (candidate: any) => { candidate.invoiceIdempotencySha256 = "1".repeat(64); }
  ]) {
    const tampered = JSON.parse(JSON.stringify(contract));
    mutate(tampered);
    assert.throws(() => context.auroraRc11ValidarContratoPar_(tampered), /RC11_PAIR_BINDING_INVALIDO/);
  }
  const expanded = { ...JSON.parse(JSON.stringify(contract)), unexpected: true };
  assert.throws(() => context.auroraRc11ValidarContratoPar_(expanded), /RC11_CONTRATO_PAR_FECHADO_INVALIDO/);
});

test("inspetor RC1.1 lê somente as duas linhas explícitas e fecha hashes/cardinalidade", () => {
  const context = appsScriptContext() as any;
  const accesses: Array<{ sheet: string; row: number; rows: number }> = [];
  const fixtures: Record<string, { row: number; headers: string[]; display: string[]; raw: unknown[] }> = {
    "06_NFS_E": {
      row: 2,
      headers: ["Competência Assistencial", "Número NF", "Status Extração", "Valor Serviço", "Chave Acesso"],
      display: ["2026-05", "8", "VALIDADO", "R$ 49.500,00", "CHAVE-NF-8"],
      raw: ["2026-05", "8", "VALIDADO", 49500, "CHAVE-NF-8"]
    },
    "08_EXTRATOS_BRADESCO": {
      row: 7,
      headers: ["Competência Assistencial Relacionada", "Subcategoria", "Status Conciliação", "Crédito", "Dcto"],
      display: ["2026-05", "RECEBIMENTO_NFS_E", "CONCILIADO", "R$ 49.500,00", "DOC-8"],
      raw: ["2026-05", "RECEBIMENTO_NFS_E", "CONCILIADO", 49500, "DOC-8"]
    }
  };
  const spreadsheet = {
    getId: () => "spreadsheet-wmgj",
    getSheetByName(sheetName: string) {
      const fixture = fixtures[sheetName];
      return {
        getLastRow: () => fixture.row,
        getLastColumn: () => fixture.headers.length,
        getRange(row: number, _column: number, rows: number) {
          accesses.push({ sheet: sheetName, row, rows });
          if (row === 1 && rows === 1) return { getDisplayValues: () => [fixture.headers] };
          assert.equal(row, fixture.row);
          assert.equal(rows, 1);
          return {
            getDisplayValues: () => [fixture.display],
            getValues: () => [fixture.raw]
          };
        }
      };
    }
  };
  context.getPlanilha = () => spreadsheet;
  const inspected = context.auroraRc11InspecionarParCandidato(2, 7);
  const contract = inspected.sampleContract;
  assert.equal(inspected.ok, true);
  assert.deepEqual(accesses, [
    { sheet: "06_NFS_E", row: 1, rows: 1 },
    { sheet: "06_NFS_E", row: 2, rows: 1 },
    { sheet: "08_EXTRATOS_BRADESCO", row: 1, rows: 1 },
    { sheet: "08_EXTRATOS_BRADESCO", row: 7, rows: 1 }
  ]);
  assert.deepEqual(Object.keys(contract).sort(), [
    "bank", "bankIdempotencySha256", "expectedPairCount", "invoice", "invoiceIdempotencySha256",
    "invoiceNumber", "pairBindingSha256", "pairContractVersion", "pairEvidenceAttested", "sourceParentSha256"
  ].sort());
  assert.deepEqual(Object.keys(contract.invoice).sort(), ["contentHash", "sourceRow"]);
  assert.deepEqual(Object.keys(contract.bank).sort(), ["contentHash", "sourceRow"]);
  assert.match(contract.invoice.contentHash, /^[a-f0-9]{64}$/);
  assert.match(contract.bank.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(contract.expectedPairCount, 2);
  assert.equal(contract.pairEvidenceAttested, true);
});

test("autorização RC1.1 inválida expira fechada sem ler fonte nem enviar", () => {
  const cases = [
    { name: "hmac", override: (h: any) => ({ authorizationHmac: "0".repeat(64) }), error: /RC11_AUTORIZACAO_HMAC_INVALIDO/ },
    { name: "sha", override: (h: any) => ({ requestSha: "x".repeat(40) }), error: /RC11_REQUEST_SHA_INVALIDO/ },
    {
      name: "expired",
      override: (h: any) => {
        const expiresAt = String(Math.floor(Date.now() / 1000) - 1);
        return { expiresAt, authorizationHmac: h.sign({ expiresAt }) };
      },
      error: /RC11_AUTORIZACAO_EXPIRADA/
    },
    {
      name: "ttl",
      override: (h: any) => {
        const expiresAt = String(Math.floor(Date.now() / 1000) + 1_000);
        return { expiresAt, authorizationHmac: h.sign({ expiresAt }) };
      },
      error: /RC11_AUTORIZACAO_TTL_INVALIDO/
    }
  ];
  for (const item of cases) {
    const harness = rc11LiveHarness();
    assert.throws(() => harness.invoke(item.override(harness)), item.error, item.name);
    assert.equal(harness.sourceReads(), 0, item.name);
    assert.equal(harness.pairCalls(), 0, item.name);
    assert.equal(harness.propertyWrites.length, 0, item.name);
    assert.deepEqual(harness.lockEvents, ["acquire", "release"], item.name);
  }
});

test("contrato autorizado com hash de fonte divergente não cria receipt nem envia", () => {
  const harness = rc11LiveHarness();
  const mismatched = JSON.parse(JSON.stringify(harness.sampleContract));
  mismatched.invoice.contentHash = "0".repeat(64);
  mismatched.pairBindingSha256 = harness.context.wmgjFirestoreHashString_(
    harness.context.auroraRc11CanonicalVinculoPar_(mismatched)
  );
  const authorizationHmac = harness.sign({ sampleContract: mismatched });
  assert.throws(
    () => harness.invoke({ sampleContract: mismatched, authorizationHmac }),
    /RC11_EVIDENCIA_FONTE_DIVERGENTE/
  );
  assert.equal(harness.sourceReads(), 2);
  assert.equal(harness.pairCalls(), 0);
  assert.equal(harness.propertyWrites.length, 0);
  assert.deepEqual(harness.lockEvents, ["acquire", "release"]);
});

test("RC1.1 bloqueia divergência de key/url/dry-run antes de fonte, receipt ou POST", () => {
  const cases = [
    { cfg: { keyId: "other-key" }, error: /RC11_KEY_ID_DIVERGENTE/ },
    { cfg: { url: "https://ingestwmgjevent-other-uc.a.run.app" }, error: /RC11_INGEST_URL_DIVERGENTE/ },
    { cfg: { dryRun: false }, error: /RC11_GLOBAL_DRY_RUN_OBRIGATORIO/ },
    { cfg: { secret: "not-a-canonical-secret" }, error: /RC11_CONFIG_INCOMPLETA/ }
  ];
  for (const item of cases) {
    const harness = rc11LiveHarness({ cfg: item.cfg });
    assert.throws(() => harness.invoke(), item.error);
    assert.equal(harness.sourceReads(), 0);
    assert.equal(harness.pairCalls(), 0);
    assert.equal(harness.propertyWrites.length, 0);
    assert.deepEqual(harness.lockEvents, ["acquire", "release"]);
  }
});

test("one-shot RC1.1 faz um envio privado do par, não relê fonte e consome receipt", () => {
  const observed: string[] = [];
  const harness = rc11LiveHarness({
    send(invoice, bank, cfg, capability) {
      assert.equal(capability, harness.context.WMGJ_FIRESTORE_RC11_EPHEMERAL_CAPABILITY_);
      assert.equal(cfg.dryRun, false);
      assert.equal(cfg.ephemeralWrite, true);
      assert.equal(cfg.maxRows, 2);
      observed.push(invoice.entityType, bank.entityType);
      return {
        invoiceResult: { ok: true, accepted: true, duplicate: false, entityId: "invoice-id" },
        bankResult: { ok: true, accepted: false, duplicate: true, entityId: "bank-id" }
      };
    }
  });
  const result = harness.invoke();
  assert.deepEqual(observed, ["invoice", "bankTransaction"]);
  assert.equal(harness.pairCalls(), 1);
  assert.equal(harness.sourceReads(), 2);
  assert.deepEqual(harness.lockEvents, ["acquire", "release"]);
  assert.deepEqual(harness.propertyWrites.map(({ value }) => JSON.parse(value).state), ["IN_PROGRESS", "CONSUMED"]);
  assert.equal(JSON.parse(harness.properties.get(harness.receiptKey)!).state, "CONSUMED");
  assert.equal(harness.propertyWrites.some(({ key }) => key === "WMGJ_FIRESTORE_DRY_RUN"), false);
  assert.equal(result.sent, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(result.receiptState, "CONSUMED");
  assert.equal(result.globalDryRun, true);
  assert.equal(result.atomic, false);
  assert.equal(result.expected.pairBindingSha256, harness.sampleContract.pairBindingSha256);
});

test("falha no primeiro ou segundo POST libera lock e torna receipt não reutilizável", () => {
  for (const failAt of [1, 2]) {
    let sends = 0;
    const harness = rc11LiveHarness({
      send() {
        sends += 1;
        if (failAt === 1) throw new Error("POST_1_FAILED");
        sends += 1;
        throw new Error("POST_2_FAILED");
      }
    });
    assert.throws(() => harness.invoke(), new RegExp(`POST_${failAt}_FAILED`));
    assert.equal(sends, failAt);
    assert.equal(harness.sourceReads(), 2);
    assert.deepEqual(harness.lockEvents, ["acquire", "release"]);
    assert.deepEqual(
      harness.propertyWrites.map(({ value }) => JSON.parse(value).state),
      ["IN_PROGRESS", "FAILED_REQUIRES_NEW_REQUEST"]
    );
    assert.equal(JSON.parse(harness.properties.get(harness.receiptKey)!).state, "FAILED_REQUIRES_NEW_REQUEST");
  }
});

test("qualquer receipt RC1.1 existente bloqueia replay sem reler fonte ou enviar", () => {
  for (const existingReceipt of ["", "malformed", JSON.stringify({ state: "FAILED_REQUIRES_NEW_REQUEST" })]) {
    const harness = rc11LiveHarness({ existingReceipt });
    assert.throws(() => harness.invoke(), /RC11_REPLAY_BLOQUEADO/);
    assert.equal(harness.sourceReads(), 0);
    assert.equal(harness.pairCalls(), 0);
    assert.equal(harness.propertyWrites.length, 0);
    assert.deepEqual(harness.lockEvents, ["acquire", "release"]);
  }
});

test("sender genérico respeita o dry-run global e não abre conexão HTTP", () => {
  const context = appsScriptContext() as any;
  let fetches = 0;
  context.PropertiesService = {
    getScriptProperties: () => ({
      getProperty(name: string) {
        const values: Record<string, string> = {
          WMGJ_FIRESTORE_INGEST_URL: "https://ingestwmgjevent-abc-uc.a.run.app",
          WMGJ_FIRESTORE_HMAC_KEY_ID: "key-1",
          WMGJ_FIRESTORE_HMAC_SECRET: "a".repeat(64),
          WMGJ_FIRESTORE_ORG_ID: "wmgj",
          WMGJ_FIRESTORE_DRY_RUN: "true"
        };
        return values[name] || null;
      }
    })
  };
  context.UrlFetchApp = { fetch: () => { fetches += 1; throw new Error("HTTP_MUST_NOT_RUN"); } };
  const result = context.wmgjFirestoreEnviarEvento_({
    eventId: "event-1",
    entityType: "invoice",
    entityKey: "invoice-1",
    idempotencyKey: "idem-1",
    orgId: "wmgj",
    record: { totalCents: 1 },
    source: { sourceId: "source-1", contentHash: "a".repeat(64) }
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.accepted, false);
  assert.equal(fetches, 0);
});

test("RC1.1 rejeita cardinalidade ambígua, capacidade inválida e par incompleto antes de HTTP", () => {
  const context = appsScriptContext() as any;
  const sheet = {
    getLastRow() { return 3; },
    getLastColumn() { return 1; },
    getRange(row: number) {
      if (row === 1) return { getDisplayValues() { return [["Código"]]; } };
      return {
        getDisplayValues() { return [["A"], ["B"]]; },
        getValues() { return [["A"], ["B"]]; }
      };
    }
  };
  context.getPlanilha = () => ({ getSheetByName: () => sheet });
  context.wmgjFirestoreClinicalHeaders_ = () => [];
  assert.throws(() => context.auroraRc11BuscarLinha_("06_NFS_E", () => true), /RC11_MULTIPLAS_LINHAS_ENCONTRADAS/);
  const pair = rc11EventPair(context);
  const cfg = {
    url: "https://ingestwmgjevent-abc-uc.a.run.app",
    keyId: "key-1", secret: "a".repeat(64), orgId: "wmgj",
    dryRun: false, ephemeralWrite: true, maxRows: 2
  };
  assert.throws(
    () => context.wmgjFirestoreEnviarParRc11_(pair.invoice, pair.bank, cfg, {}),
    /RC11_CAPACIDADE_EFEMERA_INVALIDA/
  );
  let fetches = 0;
  context.UrlFetchApp = { fetch: () => { fetches += 1; throw new Error("HTTP_MUST_NOT_RUN"); } };
  const incompleteBank = JSON.parse(JSON.stringify(pair.bank));
  delete incompleteBank.idempotencyKey;
  assert.throws(
    () => context.wmgjFirestoreEnviarParRc11_(
      pair.invoice, incompleteBank, cfg, context.WMGJ_FIRESTORE_RC11_EPHEMERAL_CAPABILITY_
    ),
    /EVENTO_FIRESTORE_INVALIDO/
  );
  assert.equal(fetches, 0);
});

test("canonical HMAC v2 do Apps Script é idêntico ao servidor", () => {
  const context = appsScriptContext() as any;
  const body = JSON.stringify({ orgId: "wmgj", idempotencyKey: "idem-1" });
  const secret = "a1".repeat(32);
  const headers: HmacV2Headers = {
    signatureVersion: "v2",
    timestamp: "1787767200",
    nonce: "0f719f5a-0806-4b2b-a40c-717371d275ee",
    keyId: "apps-script-2026-08",
    orgId: "wmgj",
    idempotencyKey: "idem-1",
    signature: "",
    method: "POST",
    contentType: "application/json"
  };
  const bridge = context.wmgjFirestoreCanonicalHmacV2_(body, headers);
  const server = canonicalHmacV2Payload(Buffer.from(body, "utf8"), headers);
  assert.equal(bridge, server);
  assert.equal(
    context.wmgjFirestoreHmacHex_(bridge, secret),
    signHmacV2(Buffer.from(body, "utf8"), headers, secret)
  );
  for (const invalidSecret of ["a".repeat(63), "g".repeat(64), "literal-secret-without-canonical-hex"]) {
    assert.throws(() => context.wmgjFirestoreHmacHex_(bridge, invalidSecret), /HMAC_SECRET_INVALIDO/);
  }
});

test("bridge só aceita resposta 2xx com confirmação inequívoca", () => {
  const context = appsScriptContext() as any;
  assert.equal(context.wmgjFirestoreRespostaAceita_({
    ok: true,
    accepted: true,
    duplicate: false,
    eventId: "event-1",
    entityId: "entity-1"
  }), true);
  assert.equal(context.wmgjFirestoreRespostaAceita_({ ok: true, accepted: true }), false);
  assert.equal(context.wmgjFirestoreRespostaAceita_({
    ok: true,
    accepted: true,
    duplicate: true,
    eventId: "event-1",
    entityId: "entity-1"
  }), false);
});

test("snapshot documental nativo persiste fatos suficientes sem narrativa da origem", () => {
  const context = appsScriptContext() as any;
  const snapshot = context.wmgjFirestoreNativeSnapshot_({
    categoria: "financeiro",
    confianca: 0.82,
    competencia: "2026-09",
    valor_total: 1234.56,
    atendimentos: 8,
    metodo_extracao: "google_docs_text",
    origem_classificacao: "aurora_native_rules_v2"
  }, {
    sourceSystem: "TASY",
    originConnector: "DRIVE_FOLDER"
  });
  assert.equal(snapshot.originSystem, "TASY");
  assert.equal(snapshot.sourceIndependent, true);
  assert.equal(snapshot.nativeReady, true);
  assert.equal(snapshot.externalFetchRequired, false);
  assert.equal(snapshot.externalAiUsed, false);
  assert.equal(snapshot.amountCents, 123456);
  assert.equal(snapshot.documentFragility, "NONE");
  assert.match(snapshot.canonicalSnapshotHash, /^[a-f0-9]{64}$/);
  assert.equal("texto" in snapshot, false);
  assert.equal("narrative" in snapshot, false);
});

test("financial snapshot with missing amount remains source-dependent", () => {
  const context = appsScriptContext() as any;
  const snapshot = context.wmgjFirestoreNativeSnapshot_({
    categoria: "financeiro",
    confianca: 0.82,
    competencia: "2026-09",
    valor_total: null,
    metodo_extracao: "google_docs_text",
    origem_classificacao: "aurora_native_rules_v2"
  }, { sourceSystem: "TASY" });
  assert.equal(snapshot.amountCents, undefined);
  assert.equal(snapshot.missingFieldsCount, 1);
  assert.equal(snapshot.nativeReady, false);
  assert.equal(snapshot.sourceIndependent, false);
  assert.equal(snapshot.externalFetchRequired, true);
  assert.equal(snapshot.documentFragility, "MISSING_CANONICAL_FIELDS");
});

test("snapshot documental marca extração degradada como dependente da origem", () => {
  const context = appsScriptContext() as any;
  const snapshot = context.wmgjFirestoreNativeSnapshot_({
    categoria: "relatorio",
    confianca: 0.78,
    metodo_extracao: "metadata_fallback",
    origem_classificacao: "aurora_native_rules_v2"
  }, { sourceSystem: "MV" });
  assert.equal(snapshot.originSystem, "MV");
  assert.equal(snapshot.sourceIndependent, false);
  assert.equal(snapshot.externalFetchRequired, true);
  assert.equal(snapshot.nativeReady, false);
  assert.equal(snapshot.documentFragility, "DEGRADED_EXTRACTION");
});

test("actor do Apps Script é pseudonimizado antes do evento", () => {
  const context = appsScriptContext() as any;
  context.Session = {
    getEffectiveUser() {
      return { getEmail() { return "Auditor@Example.com"; } };
    }
  };
  const actorId = context.wmgjFirestoreActorId_();
  assert.match(actorId, /^apps-script:[a-f0-9]{32}$/);
  assert.doesNotMatch(actorId, /auditor|example/i);
});
