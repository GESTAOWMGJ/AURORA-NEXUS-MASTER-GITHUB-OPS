import { createHash } from "node:crypto";
import { validEvidenceRef } from "./auroraEvidence.js";

export const INVOICE_ADVANCE_METHOD = Object.freeze({
  id: "AURORA-FIN-ADVANCE-001", version: "1.0.0", implementationVersion: "1.0.0",
  policySha256: "690cbef0b732a060e5b63575268e67280a7b352dbb7d07797491d0facc1da349"
});
type Row = Record<string, unknown>;
type Sources = { invoices: Row[]; bankTransactions: Row[]; sourceDocuments: Row[]; reconciliations: Row[] };
const object = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const cents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const reviewed = (r: Row): boolean => ["VALIDATED", "CLOSED"].includes(String(r.workflowState))
  && r.revoked !== true && !["REVOKED", "SUPERSEDED", "CANCELLED"].includes(String(r.status));
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    if ("toDate" in v && typeof (v as {toDate?: unknown}).toDate === "function") return (v as {toDate(): Date}).toDate().toISOString();
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
  }
  return v;
}
const digest = (v: unknown): string => createHash("sha256").update(JSON.stringify(canonical(v))).digest("hex");
const id = (r: Row): unknown => r._documentId;
function index(rows: Row[]): Map<unknown, Row> {
  const map = new Map<unknown, Row>();
  for (const r of rows) {
    if (!validEvidenceRef(id(r))) continue;
    const before = map.get(id(r));
    // Conflicting identities are never resolved by iteration order.
    map.set(id(r), before && digest(before) !== digest(r) ? { _documentId: id(r), conflict: true } : r);
  }
  return map;
}

/** Read-only application inside the existing canonical projection. No I/O or ledger writes. */
export function evaluateInvoiceAdvances(source: Sources, orgId?: string, competence?: string): Row {
  const candidates = source.reconciliations.filter(r => r.methodId === INVOICE_ADVANCE_METHOD.id);
  const issues = new Set<string>();
  const invoices = index(source.invoices), banks = index(source.bankTransactions), documents = index(source.sourceDocuments);
  const reconciliationIndex = index(candidates);
  const obligations = new Map<string, Row>(), events = new Map<string, string>(), fiscal = new Map<string, string>();
  const allocations = new Map<string, number>();
  const require = (condition: unknown, code: string): void => { if (!condition) throw Error(code); };
  function scoped(map: Map<unknown, Row>, key: unknown): Row {
    const row = map.get(key);
    require(validEvidenceRef(key) && row && !row.conflict, "SOURCE_IDENTITY_UNPROVEN");
    require(row!.orgId === orgId, "TENANT_SCOPE_REJECTED");
    require(reviewed(row!), "SOURCE_REVIEW_REQUIRED");
    return row!;
  }
  function evidence(value: unknown, reconciliation: Row): Row {
    const pin = object(value), row = scoped(documents, pin.id);
    require(typeof pin.sourceVersion === "string" && pin.sourceVersion.length > 0
      && pin.sourceVersion === row.sourceVersion && /^[a-f0-9]{64}$/.test(String(pin.canonicalSnapshotHash))
      && pin.canonicalSnapshotHash === row.canonicalSnapshotHash, "STALE_DOCUMENT_PIN");
    require(Array.isArray(reconciliation.evidenceRefs) && reconciliation.evidenceRefs.includes(pin.id), "DOCUMENT_NOT_LINKED");
    return row;
  }
  if (candidates.length && (!orgId || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(orgId)
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competence ?? ""))) issues.add("AUTHENTICATED_SCOPE_REQUIRED");
  // Validate all obligations, including other periods, before period selection:
  // an allocation cannot be spent again in a different service month.
  for (const r of candidates) {
    try {
      require(!issues.has("AUTHENTICATED_SCOPE_REQUIRED"), "AUTHENTICATED_SCOPE_REQUIRED");
      require(r.orgId === orgId, "TENANT_SCOPE_REJECTED");
      require(reviewed(r) && validEvidenceRef(id(r)) && !reconciliationIndex.get(id(r))?.conflict, "RECONCILIATION_REVIEW_REQUIRED");
      const a = object(r.advance), economic = object(a.economic), ledger = object(a.ledger);
      require(a.schemaVersion === 1 && validEvidenceRef(a.obligationId) && validEvidenceRef(economic.eventId)
        && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(economic.competence)) && r.competence === economic.competence,
      "METHOD_SCHEMA_REQUIRED");
      const invoice = scoped(invoices, a.invoiceId), identity = object(a.invoiceIdentity);
      require(invoice.kind === "EXPENSE" && ["issuerId", "recipientId", "invoiceKey"].every(k =>
        validEvidenceRef(identity[k]) && identity[k] === invoice[k]), "FISCAL_IDENTITY_UNPROVEN");
      require(cents(invoice.grossAmountCents) && cents(invoice.withheldAmountCents) && cents(invoice.netAmountCents)
        && invoice.grossAmountCents - invoice.withheldAmountCents === invoice.netAmountCents, "FISCAL_AMOUNTS_UNPROVEN");
      const economicDoc = evidence(economic.evidence, r);
      require(economicDoc.economicEventId === economic.eventId && economicDoc.serviceCompetence === economic.competence
        && economicDoc.issuerId === identity.issuerId && economicDoc.recipientId === identity.recipientId
        && cents(economic.amountCents) && economic.amountCents === economicDoc.economicAmountCents,
      "ECONOMIC_RECOGNITION_UNPROVEN");
      const ledgerDoc = evidence(ledger.evidence, r);
      require(ledgerDoc.invoiceId === a.invoiceId && ledgerDoc.economicEventId === economic.eventId
        && ledgerDoc.ledgerPostingDate === ledger.postingDate && date(ledger.postingDate) && date(invoice.issueDate), "LEDGER_LINK_UNPROVEN");
      require(Array.isArray(a.payments) && a.payments.length <= 1000, "PAYMENT_LINKS_REQUIRED");
      const payments: Row[] = [], local = new Map<string, Row>();
      for (const value of a.payments as unknown[]) {
        const p = object(value), bank = scoped(banks, p.bankTransactionId);
        require(bank.kind === "DEBIT" && typeof bank.amountCents === "number" && Number.isSafeInteger(bank.amountCents)
          && bank.amountCents < 0 && ["RECONCILED", "LIQUIDATED", "MATCHED"].includes(String(bank.status))
          && cents(p.amountCents) && p.amountCents > 0 && p.amountCents <= -bank.amountCents, "BANK_PAYMENT_UNPROVEN");
        require(date(bank.postingDate) && (bank.historyDate === null || date(bank.historyDate)), "BANK_DATES_UNPROVEN");
        const link = evidence(p.evidence, r);
        require(link.invoiceId === a.invoiceId && link.economicEventId === economic.eventId
          && link.bankTransactionId === p.bankTransactionId && link.allocatedCents === p.amountCents, "ALLOCATION_NOT_LINKED");
        const key = String(p.bankTransactionId), previous = local.get(key);
        require(!previous || digest(previous) === digest(p), "ALLOCATION_CONFLICT");
        if (!previous) {
          local.set(key, p);
          payments.push({ ...p, postingDate: bank.postingDate, historyDate: bank.historyDate });
        }
      }
      payments.sort((a, b) => String(a.bankTransactionId).localeCompare(String(b.bankTransactionId)));
      const cash = payments.reduce((sum, p) => sum + Number(p.amountCents), 0);
      require(Number.isSafeInteger(cash) && cash <= Number(invoice.netAmountCents), "PAYMENT_OVERALLOCATION");
      const result: Row = { obligationId: a.obligationId, economicEventId: economic.eventId, invoiceId: a.invoiceId,
        invoiceIdentity: identity, serviceCompetence: economic.competence, recognizedCostCents: economic.amountCents,
        issueDate: invoice.issueDate, ledgerPostingDate: ledger.postingDate, economicEvidence: economic.evidence,
        ledgerEvidence: ledger.evidence, payments, allocatedCashCents: cash, unallocatedInvoiceCents: Number(invoice.netAmountCents) - cash };
      const key = String(a.obligationId), existing = obligations.get(key);
      require(!existing || digest(existing) === digest(result), "OBLIGATION_CONFLICT");
      const eventKey = String(economic.eventId), fiscalKey = digest(identity);
      require(!events.has(eventKey) || events.get(eventKey) === key, "ECONOMIC_EVENT_DUPLICATED");
      require(!fiscal.has(fiscalKey) || fiscal.get(fiscalKey) === key, "FISCAL_IDENTITY_DUPLICATED");
      if (!existing) {
        for (const p of payments) {
          const bankKey = String(p.bankTransactionId), next = (allocations.get(bankKey) ?? 0) + Number(p.amountCents);
          require(Number.isSafeInteger(next) && next <= -Number(banks.get(bankKey)!.amountCents), "BANK_OVERALLOCATION");
          allocations.set(bankKey, next);
        }
        obligations.set(key, result); events.set(eventKey, key); fiscal.set(fiscalKey, key);
      }
    } catch (error) { issues.add(error instanceof Error ? error.message : "EVALUATION_FAILED"); }
  }
  // Later debits explicitly assigned to this method remain pending until linked.
  for (const bank of source.bankTransactions.filter(r => r.methodId === INVOICE_ADVANCE_METHOD.id)) {
    if (bank.orgId !== orgId) issues.add("TENANT_SCOPE_REJECTED");
    else if (bank.kind !== "DEBIT" || typeof bank.amountCents !== "number" || !Number.isSafeInteger(bank.amountCents)
      || bank.amountCents >= 0 || allocations.get(String(id(bank))) !== -bank.amountCents) issues.add("UNALLOCATED_PAYMENT");
  }
  const rows = [...obligations.values()].filter(r => r.serviceCompetence === competence)
    .sort((a, b) => String(a.obligationId).localeCompare(String(b.obligationId)));
  const total = rows.reduce((sum, r) => sum + Number(r.recognizedCostCents), 0);
  if (!Number.isSafeInteger(total)) issues.add("AMOUNT_OVERFLOW");
  const status = issues.size ? "PENDING_EVIDENCE" : !candidates.length ? "NO_INPUT" : "EVALUATED_READ_ONLY";
  const result = { method: INVOICE_ADVANCE_METHOD, orgId: orgId ?? null, competence: competence ?? null, status,
    issueCodes: [...issues].sort(), recognizedCostCents: status === "EVALUATED_READ_ONLY" && rows.length ? total : null,
    // This is a method-specific subset, never a complete monthly result.
    totalCostsCents: null, netResultCents: null, sourceMutation: false, financialEffect: false, externalSend: false,
    obligations: issues.size ? [] : rows,
    inputHash: digest({ orgId, competence, records: Object.entries(source).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, records]) => [name, records.map(r => digest(r)).sort()]) }),
    evidenceHash: digest(source.sourceDocuments.map(r => digest(r)).sort()) };
  return { ...result, receiptHash: digest(result) };
}
