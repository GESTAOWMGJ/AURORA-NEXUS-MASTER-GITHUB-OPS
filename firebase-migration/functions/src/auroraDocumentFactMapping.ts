/** Local, ephemeral candidates, never authorization or an installation receipt.
 * Reuses the fiscal-path and credit/debit distinctions of the existing GS10/GS06
 * parsers, without their basename fallback, decimal guessing or inferred year.
 */
export type DocumentFactMappingInput = {
  byteSha256: string;
  byteLength: number;
  extraction: {
    status: string;
    textSha256: string | null;
    coverage: { totalUnits: number; processedUnits: number };
  };
  xmlLeaves: ReadonlyArray<{
    path: readonly string[];
    namespaceURI: string;
    namespacePath: readonly string[];
    text: string;
    locator: string;
  }>;
  tables: ReadonlyArray<{
    columns: readonly string[];
    rows: ReadonlyArray<readonly string[]>;
    rowLocators: readonly string[];
  }>;
};

type InvoiceCandidate = {
  ruleId: "AURORA_NFE_TOTAL_V1";
  kind: "BILLING_INVOICE";
  amountCents: number;
  issueDate: string;
  issuedAt: string | null;
  fieldLocators: { amount: string; date: string };
};
type StatementCandidate = {
  ruleId: "AURORA_BANK_EXPLICIT_PTBR_V1";
  kind: "STATEMENT_ENTRY";
  amountCents: number;
  direction: "CREDIT" | "DEBIT";
  bookingDate: string;
  statedBalanceCents: number | null;
  fieldLocators: { amount: string; date: string; direction: string; balance: string | null };
};
export type DocumentFactCandidate = InvoiceCandidate | StatementCandidate;
type MappingStatus = "HUMAN_REVIEW_REQUIRED" | "NO_SUPPORTED_LAYOUT" | "INCOMPLETE_EXTRACTION"
  | "INVALID_FACTS" | "CONFLICTING_FACTS" | "LIMIT_EXCEEDED";
export type DocumentFactMapping = {
  schemaVersion: "aurora.document.fact-candidates.v1";
  mappingVersion: "1.0.0";
  status: MappingStatus;
  representationByteSha256: string | null;
  extractedTextSha256: string | null;
  evidenceAuthority: "AUTHENTICATED_CLIENT_OBSERVATION_NOT_PROVIDER_SIGNATURE";
  reviewRequired: true;
  canonicalPromotionAllowed: false;
  nativeReady: false;
  sourceIndependent: false;
  candidates: DocumentFactCandidate[];
  warnings: Array<"INVOICE_IS_NOT_RECEIPT" | "BANK_ENTRY_IS_NOT_REVENUE" | "UNMAPPED_TABLE_PRESENT">;
};

/** Self-contained factory: the compiled SAME code is emitted to the browser. */
export function createDocumentFactMapper() {
const FISCAL_NAMESPACE = "http://www.portalfiscal.inf.br/nfe";
const HASH = /^[a-f0-9]{64}$/;
const MAX_CANDIDATES = 128;

function mappingResult(input: DocumentFactMappingInput, status: MappingStatus,
  candidates: DocumentFactCandidate[] = [], warnings: DocumentFactMapping["warnings"] = []): DocumentFactMapping {
  return {
    schemaVersion: "aurora.document.fact-candidates.v1", mappingVersion: "1.0.0", status,
    representationByteSha256: HASH.test(input.byteSha256) ? input.byteSha256 : null,
    extractedTextSha256: typeof input.extraction.textSha256 === "string" && HASH.test(input.extraction.textSha256)
      ? input.extraction.textSha256 : null,
    evidenceAuthority: "AUTHENTICATED_CLIENT_OBSERVATION_NOT_PROVIDER_SIGNATURE",
    reviewRequired: true, canonicalPromotionAllowed: false, nativeReady: false, sourceIndependent: false,
    candidates, warnings
  };
}

/** No floating point conversion, grouping removal or unknown-as-zero fallback. */
function decimalCents(value: string, locale: "XML" | "PTBR", signed = false): number | null {
  if (typeof value !== "string" || value.length > 32) return null;
  const negative = signed && value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const valid = locale === "XML" ? /^(0|[1-9][0-9]*)\.[0-9]{2}$/.test(unsigned)
    : /^(0|[1-9][0-9]*|[1-9][0-9]{0,2}(?:\.[0-9]{3})+),[0-9]{2}$/.test(unsigned);
  if (!valid) return null;
  const digits = locale === "XML" ? unsigned.replace(".", "") : unsigned.replace(/\./g, "").replace(",", "");
  const cents = BigInt(digits) * (negative ? -1n : 1n);
  return cents >= BigInt(Number.MIN_SAFE_INTEGER) && cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
}

function fiscalDate(value: string, timestamp: boolean): { date: string; instant: string | null } | null {
  if (typeof value !== "string") return null;
  if (!timestamp) return validDate(value) ? { date: value, instant: null } : null;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.[0-9]{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !validDate(match[1]!) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) return null;
  const offset = match[5]!;
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4)) > 59
    || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0))) return null;
  return { date: match[1]!, instant: value };
}

function mapInvoice(input: DocumentFactMappingInput): DocumentFactMapping | null {
  const roots = ["nfeProc/NFe/infNFe", "NFe/infNFe"];
  const targets = input.xmlLeaves.flatMap((leaf, index) => {
    if (!Array.isArray(leaf.path) || !Array.isArray(leaf.namespacePath)
      || leaf.path.length !== leaf.namespacePath.length || leaf.namespaceURI !== FISCAL_NAMESPACE
      || !leaf.namespacePath.every(namespace => namespace === FISCAL_NAMESPACE)) return [];
    const path = leaf.path.join("/");
    // Structural paths alone cannot associate siblings: infNFe[1] and [2]
    // may each supply only one half of a fact. Bind the actual parser ancestry.
    const locatorParts = leaf.locator.split("/");
    if (locatorParts[0] !== "xml" || locatorParts.length !== leaf.path.length + 1
      || locatorParts.slice(1).some((part, i) => {
        const match = /^([A-Za-z_][A-Za-z0-9_.-]*(?::[A-Za-z_][A-Za-z0-9_.-]*)?)\[([1-9][0-9]{0,5})\]$/.exec(part);
        return !match || match[1]!.split(":").at(-1) !== leaf.path[i];
      })) return [];
    for (const root of roots) {
      const ancestor = locatorParts.slice(0, root.split("/").length + 1).join("/");
      if (path === `${root}/total/ICMSTot/vNF`) return [{ kind: "amount", root, ancestor, leaf, index }];
      if (path === `${root}/ide/dhEmi`) return [{ kind: "timestamp", root, ancestor, leaf, index }];
      if (path === `${root}/ide/dEmi`) return [{ kind: "date", root, ancestor, leaf, index }];
    }
    return [];
  });
  if (!targets.length) return null;
  const amounts = targets.filter(item => item.kind === "amount"), dates = targets.filter(item => item.kind !== "amount");
  if (amounts.length > 1 || dates.length > 1 || new Set(targets.map(item => item.root)).size !== 1
    || new Set(targets.map(item => item.ancestor)).size !== 1)
    return mappingResult(input, "CONFLICTING_FACTS");
  if (amounts.length !== 1 || dates.length !== 1) return mappingResult(input, "INVALID_FACTS");
  const amount = amounts[0]!, date = dates[0]!;
  const amountCents = decimalCents(amount.leaf.text, "XML"), issued = fiscalDate(date.leaf.text, date.kind === "timestamp");
  if (amountCents === null || !issued) return mappingResult(input, "INVALID_FACTS");
  if (input.tables.length) return mappingResult(input, "CONFLICTING_FACTS");
  return mappingResult(input, "HUMAN_REVIEW_REQUIRED", [{
    ruleId: "AURORA_NFE_TOTAL_V1", kind: "BILLING_INVOICE", amountCents,
    issueDate: issued.date, issuedAt: issued.instant,
    fieldLocators: { amount: `xmlLeaf:${amount.index}`, date: `xmlLeaf:${date.index}` }
  }], ["INVOICE_IS_NOT_RECEIPT"]);
}

function header(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function mapStatements(input: DocumentFactMappingInput): DocumentFactMapping {
  const candidates: StatementCandidate[] = [];
  let unmappedTable = false;
  for (let tableIndex = 0; tableIndex < input.tables.length; tableIndex++) {
    const table = input.tables[tableIndex]!, columns = table.columns.map(header);
    const recognized = ["DATA", "TIPO", "VALOR"].every(name => columns.includes(name));
    if (!recognized) { unmappedTable = true; continue; }
    if (new Set(columns).size !== columns.length) return mappingResult(input, "CONFLICTING_FACTS");
    if (columns.some(name => !["DATA", "TIPO", "VALOR", "SALDO", "HISTORICO"].includes(name))) {
      unmappedTable = true; continue;
    }
    if (table.rows.length + candidates.length > MAX_CANDIDATES) return mappingResult(input, "LIMIT_EXCEEDED");
    const dateColumn = columns.indexOf("DATA"), directionColumn = columns.indexOf("TIPO"),
      amountColumn = columns.indexOf("VALOR"), balanceColumn = columns.indexOf("SALDO");
    for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
      const row = table.rows[rowIndex]!;
      if (row.length !== columns.length) return mappingResult(input, "INVALID_FACTS");
      const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(row[dateColumn]!);
      const bookingDate = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : "";
      const direction = header(row[directionColumn]!);
      const amountCents = decimalCents(row[amountColumn]!, "PTBR");
      const statedBalanceCents = balanceColumn < 0 || row[balanceColumn] === "" ? null : decimalCents(row[balanceColumn]!, "PTBR", true);
      if (!validDate(bookingDate) || !["CREDITO", "DEBITO"].includes(direction) || amountCents === null
        || (balanceColumn >= 0 && row[balanceColumn] !== "" && statedBalanceCents === null)) return mappingResult(input, "INVALID_FACTS");
      const locator = (column: number): string => `table:${tableIndex}:row:${rowIndex}:column:${column}`;
      candidates.push({ ruleId: "AURORA_BANK_EXPLICIT_PTBR_V1", kind: "STATEMENT_ENTRY", amountCents,
        direction: direction === "CREDITO" ? "CREDIT" : "DEBIT", bookingDate, statedBalanceCents,
        fieldLocators: { amount: locator(amountColumn), date: locator(dateColumn), direction: locator(directionColumn),
          balance: balanceColumn < 0 || row[balanceColumn] === "" ? null : locator(balanceColumn) }
      });
    }
  }
  if (!candidates.length) return mappingResult(input, "NO_SUPPORTED_LAYOUT");
  return mappingResult(input, "HUMAN_REVIEW_REQUIRED", candidates,
    unmappedTable ? ["BANK_ENTRY_IS_NOT_REVENUE", "UNMAPPED_TABLE_PRESENT"] : ["BANK_ENTRY_IS_NOT_REVENUE"]);
}

/** Input must be the actual in-memory extractor result. Its digests bind the
 * preview, not authenticity or completeness of financial facts. No raw text,
 * fiscal identifier, account, description or filename leaves this mapper.
 */
function mapDocumentFactCandidates(input: DocumentFactMappingInput): DocumentFactMapping {
  if (input.extraction.status !== "COMPLETE") return mappingResult(input, "INCOMPLETE_EXTRACTION");
  const coverage = input.extraction.coverage;
  if (!HASH.test(input.byteSha256) || typeof input.extraction.textSha256 !== "string" || !HASH.test(input.extraction.textSha256)
    || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 1048576
    || !Number.isSafeInteger(coverage.totalUnits) || coverage.totalUnits < 1 || coverage.totalUnits > 10000
    || coverage.processedUnits !== coverage.totalUnits) return mappingResult(input, "INCOMPLETE_EXTRACTION");
  if (input.xmlLeaves.length > 100000 || input.tables.length > 128) return mappingResult(input, "LIMIT_EXCEEDED");
  return mapInvoice(input) ?? mapStatements(input);
}
return { mapDocumentFactCandidates };
}

export const mapDocumentFactCandidates = createDocumentFactMapper().mapDocumentFactCandidates;

export function documentFactMapperClientSource(): string {
  // Identity shim for name-preserving test transpilers; production tsc needs none.
  return `const documentFactMapper=(()=>{const __name=(value)=>value;return (${createDocumentFactMapper.toString()})();})();`;
}
