export type OverallStatus = "OK" | "ATENCAO" | "ERRO";

export type OperationalAction =
  | "diagnosticar"
  | "processarFila"
  | "reprocessarErros"
  | "auditarCodigo"
  | "validarStatus"
  | "abrirRevisao"
  | "marcarRevisado";

export interface PipelineMetrics {
  pendentes: number;
  processando: number;
  processados: number;
  duplicados: number;
  erros: number;
  revisaoHumana: number;
}

export interface OperationalAudit {
  ok: boolean;
  erros: string[];
  avisos: string[];
}

export interface OperationalStatus {
  status: OverallStatus;
  ultimaExecucao: string;
  pipeline: PipelineMetrics;
  auditoria: OperationalAudit;
  acoesDisponiveis: OperationalAction[];
}

export type ValidationStatus =
  | "PENDENTE"
  | "EM_REVISAO"
  | "BLOQUEADO"
  | "VALIDADO";

export type TaskPriority = "ALTA" | "MEDIA" | "BAIXA";

export interface ValidationTask {
  id: string;
  documentName: string;
  category: string;
  status: ValidationStatus;
  priority: TaskPriority;
  dueAt: string;
  assignee: string;
}

export type EvidenceStatus =
  | "CAPTURADA"
  | "VALIDADA"
  | "PENDENTE"
  | "BLOQUEADA";

export interface EvidenceEvent {
  id: string;
  label: string;
  status: EvidenceStatus;
  at: string;
  actor: string;
}

export type AuditResult = "SUCESSO" | "AVISO" | "BLOQUEIO" | "SOLICITADO";
export type ActorKind = "SISTEMA" | "OPERADOR" | "INTEGRACAO";

export interface AuditLog {
  id: string;
  action: string;
  result: AuditResult;
  at: string;
  actorKind: ActorKind;
}

export type ConnectorState =
  | "CONECTADO"
  | "ATENCAO"
  | "INDISPONIVEL"
  | "PLANEJADO";

export interface ConnectorStatus {
  name: string;
  state: ConnectorState;
  detail: string;
  lastCheckedAt: string;
}

export interface ActionDefinition {
  id: OperationalAction;
  label: string;
  description: string;
  confirmation: string;
  tone: "primary" | "neutral" | "warning";
}

export interface MockActionRequest {
  id: string;
  action: OperationalAction;
  label: string;
  target?: string;
  createdAt: string;
  state: "SOLICITADA";
}

export type ReadinessState =
  | "CONCLUIDO_E_VERIFICADO"
  | "PREPARADO_NAO_EXECUTADO"
  | "PENDENTE_DE_APROVACAO"
  | "BLOQUEADO";

export interface ReadinessGate {
  id: "G0" | "G1" | "G2" | "G3" | "G4";
  label: string;
  state: ReadinessState;
  evidenceCount: number;
  owner: string;
  blockingReason?: string;
}

export interface TraceabilityControl {
  requirement: string;
  risk: string;
  control: string;
  test: string;
  evidence: string;
  state: ReadinessState;
}
