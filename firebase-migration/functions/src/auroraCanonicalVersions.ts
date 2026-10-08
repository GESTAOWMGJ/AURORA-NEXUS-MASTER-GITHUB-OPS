import { Timestamp } from "firebase-admin/firestore";
import { sha256Hex } from "./security.js";

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    if (value instanceof Timestamp) return value.toDate().toISOString();
    const record = value as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
      if (!["createdAt", "updatedAt", "serverAt", "importedAt"].includes(key)) {
        acc[key] = stableValue(record[key]);
      }
      return acc;
    }, {});
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function isPlainDocumentMap(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reproduz a semântica relevante de set(..., { merge: true }) para o material
 * coberto pelo hash. Mapas são mesclados recursivamente; arrays e escalares
 * substituem o valor anterior. Sentinelas temporais não entram neste patch e
 * são removidas por stableValue antes do hash.
 */
export function mergedDocumentForAudit(
  previous: Record<string, unknown> | null,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = previous ? { ...previous } : {};

  for (const [key, value] of Object.entries(patch)) {
    const current = merged[key];
    if (isPlainDocumentMap(value) && Object.keys(value).length === 0) {
      // Firestore trata um mapa vazio explícito como substituição do mapa,
      // mesmo com merge=true.
      merged[key] = {};
    } else {
      merged[key] = isPlainDocumentMap(current) && isPlainDocumentMap(value)
        ? mergedDocumentForAudit(current, value)
        : value;
    }
  }

  return merged;
}

export function persistedDocumentHash(
  previous: Record<string, unknown> | null,
  patch: Record<string, unknown>
): string {
  return sha256Hex(stableJson(mergedDocumentForAudit(previous, patch)));
}

export function immutableEntityVersionId(
  entityType: string,
  entityKey: string,
  revision: number
): string {
  return sha256Hex(`v1:${entityType}:${entityKey}:revision:${revision}`).slice(0, 48);
}

export function canonicalEntityRevision(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return null;
  return value;
}

export function nextCanonicalEntityRevision(value: unknown): number | null {
  const current = canonicalEntityRevision(value);
  if (current === null || current >= Number.MAX_SAFE_INTEGER) return null;
  return current + 1;
}
