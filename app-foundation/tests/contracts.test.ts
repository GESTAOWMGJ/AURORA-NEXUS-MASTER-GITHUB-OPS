import { describe, expect, it } from "vitest";
import {
  classificationOutputSchema,
  operationalActionSchema,
  sanitizedClassificationInputSchema,
} from "../functions/src/contracts.ts";
import { canonicalJson, sha256 } from "../functions/src/crypto.ts";
import {
  assertSiteScope,
  hasSecondFactor,
} from "../functions/src/security.ts";

describe("contratos de domínio", () => {
  it("aceita uma solicitação operacional idempotente", () => {
    const result = operationalActionSchema.parse({
      tenantId: "wmgj-demo",
      siteId: null,
      commandId: "cb8a72df-c9b1-4e0f-a6ab-d0a58d398d5d",
      action: "diagnosticar",
      reasonCode: "MANUAL_DIAGNOSTIC",
      targetId: null,
      expectedRevision: null,
    });

    expect(result.action).toBe("diagnosticar");
  });

  it("rejeita código de motivo incompatível com a ação", () => {
    const result = operationalActionSchema.safeParse({
      tenantId: "wmgj-demo",
      siteId: null,
      commandId: "4a771765-3b65-4591-b2ea-c344762c6556",
      action: "processarFila",
      reasonCode: "TECHNICAL_AUDIT",
      targetId: null,
      expectedRevision: null,
    });

    expect(result.success).toBe(false);
  });

  it("exige alvo e revisão para ações de validação", () => {
    const missingTarget = operationalActionSchema.safeParse({
      tenantId: "wmgj-demo",
      siteId: "site-alpha",
      commandId: "73767031-3e46-4d8c-96b8-e307871a6f65",
      action: "marcarRevisado",
      reasonCode: "HUMAN_REVIEW_DECIDED",
      targetId: null,
      expectedRevision: null,
    });
    const validTarget = operationalActionSchema.safeParse({
      tenantId: "wmgj-demo",
      siteId: "site-alpha",
      commandId: "38af0e52-b992-49a0-8fbe-1d90013d594e",
      action: "marcarRevisado",
      reasonCode: "HUMAN_REVIEW_DECIDED",
      targetId: "task-001",
      expectedRevision: 4,
    });

    expect(missingTarget.success).toBe(false);
    expect(validTarget.success).toBe(true);
  });

  it("rejeita OCR ou identificador extra no payload enviado à IA", () => {
    const result = sanitizedClassificationInputSchema.safeParse({
      sourceKind: "DRIVE",
      mimeType: "application/pdf",
      evidenceKindHint: "financeiro",
      amountPresent: true,
      competencePresent: true,
      contractReferencePresent: false,
      signals: ["invoice"],
      rawText: "conteúdo que não pode sair da zona protegida",
    });

    expect(result.success).toBe(false);
  });

  it("rejeita texto livre nos campos enviados à IA", () => {
    const result = sanitizedClassificationInputSchema.safeParse({
      sourceKind: "DRIVE",
      mimeType: "application/pdf",
      evidenceKindHint: "descrição livre não autorizada",
      amountPresent: false,
      competencePresent: false,
      contractReferencePresent: false,
      signals: ["unknown"],
    });

    expect(result.success).toBe(false);
  });

  it("valida a saída estruturada e exige revisão para baixa confiança", () => {
    const output = classificationOutputSchema.parse({
      category: "financeiro",
      confidence: 0.52,
      reviewRequired: true,
      reasonCodes: ["LOW_CONFIDENCE"],
    });

    expect(output.reviewRequired).toBe(true);
    expect(
      classificationOutputSchema.safeParse({
        category: "financeiro",
        confidence: 0.52,
        reviewRequired: false,
        reasonCodes: ["LOW_CONFIDENCE"],
      }).success,
    ).toBe(false);
  });

  it("produz hash estável para objetos com chaves em ordem diferente", () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(sha256(left)).toBe(sha256(right));
  });

  it("nega escopo tenant-wide a membro limitado por unidade", () => {
    const member = {
      status: "ACTIVE",
      allSites: false,
      siteIds: ["site-alpha"],
    };

    expect(() => assertSiteScope(member, null)).toThrow("SITE_SCOPE_REQUIRED");
    expect(() => assertSiteScope(member, "site-beta")).toThrow(
      "SITE_SCOPE_DENIED",
    );
    expect(() => assertSiteScope(member, "site-alpha")).not.toThrow();
  });

  it("reconhece segundo fator no token Firebase", () => {
    expect(
      hasSecondFactor({
        firebase: { sign_in_second_factor: "totp" },
      } as never),
    ).toBe(true);
    expect(hasSecondFactor({ firebase: {} } as never)).toBe(false);
  });
});
