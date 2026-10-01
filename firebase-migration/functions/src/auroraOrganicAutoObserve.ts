import { FieldValue } from "firebase-admin/firestore";
import { CATEGORIES, KINDS, digest, type Signal } from "./auroraOrganicCore.js";
import {
  STATE_ID,
  transition,
  type Actor,
  type Command,
  type State
} from "./auroraOrganicService.js";
import type { AuroraMember } from "./auroraAccess.js";
import { auroraDb } from "./firebase.js";

export type OrganicAutoObserveResult =
  | { recorded: true; duplicate: boolean; stateVersion: number }
  | { recorded: false; code: string };

function validCandidateAction(data: Record<string, unknown>): {
  kind: Exclude<Signal["kind"], "TOOL_OUTCOME">;
  category: Signal["category"];
  sector: string;
} | null {
  if (
    data.status !== "RESOLVED"
    || data.organicCandidate !== true
    || data.source !== "AURORA_DOCUMENT_WATCHDOG"
  ) return null;

  const kind = typeof data.organicSignalKind === "string" ? data.organicSignalKind : "";
  const category = typeof data.organicCategory === "string" ? data.organicCategory : "";
  const sector = typeof data.organicSector === "string" ? data.organicSector : "";
  if (!KINDS.includes(kind as Signal["kind"]) || kind === "TOOL_OUTCOME") return null;
  if (!CATEGORIES.includes(category as Signal["category"])) return null;
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(sector)) return null;
  return {
    kind: kind as Exclude<Signal["kind"], "TOOL_OUTCOME">,
    category: category as Signal["category"],
    sector
  };
}

export async function autoObserveResolvedDocumentAction(
  orgId: string,
  actionId: string,
  member: AuroraMember
): Promise<OrganicAutoObserveResult> {
  if (member.orgId !== orgId || !member.allFacilities) return { recorded: false, code: "ACTOR_SCOPE_REJECTED" };

  const orgPath = `organizations/${orgId}`;
  const stateRef = auroraDb.doc(`${orgPath}/runtimeCheckpoints/${STATE_ID}`);
  const actionRef = auroraDb.doc(`${orgPath}/actionItems/${actionId}`);

  return auroraDb.runTransaction(async (tx) => {
    const cache = new Map<string, Record<string, unknown> | null>();
    const read = async (path: string): Promise<Record<string, unknown> | null> => {
      if (cache.has(path)) return cache.get(path)!;
      const snap = await tx.get(auroraDb.doc(path));
      const data = snap.exists ? snap.data() ?? {} : null;
      cache.set(path, data);
      return data;
    };

    const org = await read(orgPath);
    const membership = await read(`${orgPath}/members/${member.uid}`);
    const action = await read(actionRef.path);
    if (!org || org.active !== true) return { recorded: false, code: "ORGANIZATION_DISABLED" };
    if (!membership || membership.active !== true || membership.allFacilities !== true) {
      return { recorded: false, code: "ACTOR_SCOPE_REJECTED" };
    }
    if (org.organicEnabled !== true) return { recorded: false, code: "ORGANIC_DISABLED" };

    const candidate = action ? validCandidateAction(action) : null;
    if (!candidate) return { recorded: false, code: "NOT_ORGANIC_DOCUMENT_ACTION" };
    const sectors = Array.isArray(org.organicSectors) ? org.organicSectors : [];
    if (!sectors.includes(candidate.sector)) return { recorded: false, code: "SECTOR_NOT_AUTHORIZED" };

    const stateRecord = await read(stateRef.path);
    if (stateRecord && (stateRecord.orgId !== orgId || !Object.hasOwn(stateRecord, "organic"))) {
      return { recorded: false, code: "CHECKPOINT_RESERVED_ID_CONFLICT" };
    }
    const original = (stateRecord?.organic as State | null | undefined) ?? null;
    const expectedVersion = original?.version ?? 0;
    const operationId = digest([
      orgId,
      "organic-document-auto-observe",
      actionId,
      action?.revision ?? null,
      action?.watchFingerprint ?? null
    ]);
    const idemRef = auroraDb.doc(`${orgPath}/apiIdempotency/${operationId}`);
    const idem = await read(idemRef.path);
    if (idem) {
      return {
        recorded: true,
        duplicate: true,
        stateVersion: Number(idem.stateVersion ?? expectedVersion)
      };
    }

    const actor: Actor = {
      uid: member.uid,
      orgId,
      role: String(membership.role ?? member.role),
      permissions: Array.isArray(membership.permissions)
        ? membership.permissions.filter((item): item is string => typeof item === "string")
        : member.permissions,
      allFacilities: true,
      mfaVerified: member.mfaVerified
    };
    const command: Command = {
      type: "OBSERVE",
      expectedVersion,
      kind: candidate.kind,
      category: candidate.category,
      sector: candidate.sector,
      actionId
    };
    const computed = await transition(original, command, actor, org, read, operationId);

    tx.set(stateRef, {
      orgId,
      organic: computed.state,
      sanitized: true,
      sensitivity: "INTERNAL",
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    tx.create(idemRef, {
      commandHash: digest(command),
      actorUid: member.uid,
      actionId,
      source: "AURORA_DOCUMENT_WATCHDOG",
      stateVersion: computed.state.version,
      result: computed.result,
      createdAt: FieldValue.serverTimestamp()
    });
    tx.create(auroraDb.doc(`${orgPath}/auditEvents/${digest(["organic-document-observe", operationId])}`), {
      orgId,
      type: "ORGANIC_DOCUMENT_OBSERVED",
      action: "ORGANIC_DOCUMENT_OBSERVED",
      actionId,
      actorUid: member.uid,
      actorRole: actor.role,
      signalKind: candidate.kind,
      category: candidate.category,
      sector: candidate.sector,
      stateVersion: computed.state.version,
      occurredAt: FieldValue.serverTimestamp(),
      sanitized: true,
      sensitivity: "INTERNAL"
    });
    tx.update(actionRef, {
      organicSignalRecorded: true,
      organicObservedAt: FieldValue.serverTimestamp(),
      organicStateVersion: computed.state.version
    });

    return { recorded: true, duplicate: false, stateVersion: computed.state.version };
  });
}
