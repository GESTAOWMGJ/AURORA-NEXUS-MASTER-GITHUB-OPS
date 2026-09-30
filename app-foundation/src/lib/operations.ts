import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getFirebaseServices } from "./firebase";

export type OperationalActionName =
  | "diagnosticar"
  | "processarFila"
  | "reprocessarErros"
  | "auditarCodigo"
  | "validarStatus"
  | "abrirRevisao"
  | "marcarRevisado";

export interface QueueActionInput {
  tenantId: string;
  siteId: string | null;
  commandId: string;
  action: OperationalActionName;
  reasonCode:
    | "MANUAL_DIAGNOSTIC"
    | "QUEUE_REQUEST"
    | "ELIGIBLE_RETRY"
    | "TECHNICAL_AUDIT"
    | "STATUS_VALIDATION"
    | "HUMAN_REVIEW_OPENED"
    | "HUMAN_REVIEW_DECIDED";
  targetId: string | null;
  expectedRevision: number | null;
}

export interface QueueActionResult {
  ok: boolean;
  reused: boolean;
  status: string;
  actionRequestId: string;
}

export async function queueOperationalAction(
  input: QueueActionInput,
): Promise<QueueActionResult> {
  const { functions } = getFirebaseServices();
  const callable = httpsCallable<QueueActionInput, QueueActionResult>(
    functions,
    "requestOperationalAction",
  );
  const result = await callable(input);
  return result.data;
}

export function createOperationalCommandId(): string {
  return crypto.randomUUID();
}

export async function loadOperationalSnapshot<T>(
  tenantId: string,
): Promise<T | null> {
  const { firestore } = getFirebaseServices();
  const snapshot = await getDoc(
    doc(firestore, `tenants/${tenantId}/dashboard_snapshots/current`),
  );
  return snapshot.exists() ? (snapshot.data() as T) : null;
}
