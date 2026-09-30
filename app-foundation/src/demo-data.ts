import type {
  ActionDefinition,
  AuditLog,
  ConnectorStatus,
  EvidenceEvent,
  OperationalStatus,
  ReadinessGate,
  TraceabilityControl,
  ValidationTask,
} from "./types";

export const operationalStatus: OperationalStatus = {
  status: "ATENCAO",
  ultimaExecucao: "2026-08-26T14:42:18.000Z",
  pipeline: {
    pendentes: 18,
    processando: 4,
    processados: 286,
    duplicados: 3,
    erros: 2,
    revisaoHumana: 7,
  },
  auditoria: {
    ok: true,
    erros: [],
    avisos: [
      "Há documentos aguardando validação humana.",
      "Dois itens permanecem retidos para nova tentativa controlada.",
    ],
  },
  acoesDisponiveis: [
    "diagnosticar",
    "processarFila",
    "reprocessarErros",
    "auditarCodigo",
    "validarStatus",
    "abrirRevisao",
    "marcarRevisado",
  ],
};

export const validationTasks: ValidationTask[] = [
  {
    id: "VAL-0418",
    documentName: "Lote financeiro 08/2026 · item 014",
    category: "Conciliação financeira",
    status: "PENDENTE",
    priority: "ALTA",
    dueAt: "2026-08-26T18:00:00.000Z",
    assignee: "Núcleo de auditoria",
  },
  {
    id: "VAL-0417",
    documentName: "Lote fiscal 08/2026 · item 009",
    category: "Documento fiscal",
    status: "EM_REVISAO",
    priority: "ALTA",
    dueAt: "2026-08-27T15:00:00.000Z",
    assignee: "Validação financeira",
  },
  {
    id: "VAL-0412",
    documentName: "Lote contratual 03/2026 · item 002",
    category: "Conformidade contratual",
    status: "BLOQUEADO",
    priority: "MEDIA",
    dueAt: "2026-08-28T16:00:00.000Z",
    assignee: "Governança documental",
  },
  {
    id: "VAL-0406",
    documentName: "Lote de produção 08/2026 · item 021",
    category: "Produção assistencial",
    status: "PENDENTE",
    priority: "MEDIA",
    dueAt: "2026-08-29T17:00:00.000Z",
    assignee: "Núcleo de auditoria",
  },
  {
    id: "VAL-0399",
    documentName: "Lote de qualidade 07/2026 · item 006",
    category: "Indicadores de qualidade",
    status: "VALIDADO",
    priority: "BAIXA",
    dueAt: "2026-08-25T18:00:00.000Z",
    assignee: "Governança assistencial",
  },
];

export const evidenceEvents: EvidenceEvent[] = [
  {
    id: "EVT-904",
    label: "Documento recebido e identificado",
    status: "CAPTURADA",
    at: "2026-08-26T14:36:00.000Z",
    actor: "Ingestão documental",
  },
  {
    id: "EVT-905",
    label: "Conteúdo extraído e classificado",
    status: "VALIDADA",
    at: "2026-08-26T14:37:42.000Z",
    actor: "Pipeline automatizado",
  },
  {
    id: "EVT-906",
    label: "Conciliação com a memória-base",
    status: "VALIDADA",
    at: "2026-08-26T14:39:15.000Z",
    actor: "Motor de conciliação",
  },
  {
    id: "EVT-907",
    label: "Revisão humana obrigatória",
    status: "PENDENTE",
    at: "2026-08-26T14:40:02.000Z",
    actor: "Fila de validação",
  },
];

export const auditLogs: AuditLog[] = [
  {
    id: "LOG-7821",
    action: "Leitura do estado operacional consolidado",
    result: "SUCESSO",
    at: "2026-08-26T14:42:18.000Z",
    actorKind: "SISTEMA",
  },
  {
    id: "LOG-7819",
    action: "Item direcionado à revisão humana",
    result: "AVISO",
    at: "2026-08-26T14:40:03.000Z",
    actorKind: "SISTEMA",
  },
  {
    id: "LOG-7816",
    action: "Validação do contrato operacional",
    result: "SUCESSO",
    at: "2026-08-26T14:35:27.000Z",
    actorKind: "INTEGRACAO",
  },
  {
    id: "LOG-7812",
    action: "Processamento retido por regra de segurança",
    result: "BLOQUEIO",
    at: "2026-08-26T14:31:54.000Z",
    actorKind: "SISTEMA",
  },
];

export const connectorStatuses: ConnectorStatus[] = [
  {
    name: "Google Workspace",
    state: "CONECTADO",
    detail: "Canal documental disponível para leitura controlada.",
    lastCheckedAt: "2026-08-26T14:41:30.000Z",
  },
  {
    name: "Apps Script",
    state: "CONECTADO",
    detail: "Motor operacional respondendo ao contrato de status.",
    lastCheckedAt: "2026-08-26T14:42:18.000Z",
  },
  {
    name: "Airtable",
    state: "ATENCAO",
    detail: "Mapeamento preparado; gravação permanece desativada no MVP.",
    lastCheckedAt: "2026-08-26T14:39:48.000Z",
  },
  {
    name: "Notion",
    state: "ATENCAO",
    detail: "Base de governança visível; sincronização não habilitada.",
    lastCheckedAt: "2026-08-26T14:38:12.000Z",
  },
  {
    name: "Cloud Firestore",
    state: "ATENCAO",
    detail: "Fundação local concluída; homologação e deploy ainda não executados.",
    lastCheckedAt: "2026-08-26T16:15:00.000Z",
  },
];

export const actionDefinitions: ActionDefinition[] = [
  {
    id: "diagnosticar",
    label: "Solicitar diagnóstico",
    description: "Gera uma solicitação para verificar o motor e atualizar o estado.",
    confirmation: "Confirmar a solicitação de diagnóstico operacional?",
    tone: "primary",
  },
  {
    id: "processarFila",
    label: "Solicitar lote",
    description: "Enfileira um pedido de processamento controlado do próximo lote.",
    confirmation: "Confirmar o pedido de processamento do próximo lote?",
    tone: "primary",
  },
  {
    id: "reprocessarErros",
    label: "Solicitar nova tentativa",
    description: "Pede nova tentativa somente para itens elegíveis e retidos.",
    confirmation: "Confirmar a solicitação de nova tentativa dos itens elegíveis?",
    tone: "warning",
  },
  {
    id: "auditarCodigo",
    label: "Solicitar auditoria",
    description: "Registra um pedido de verificação de duplicidades e limites.",
    confirmation: "Confirmar a solicitação de auditoria técnica?",
    tone: "neutral",
  },
  {
    id: "validarStatus",
    label: "Validar contrato",
    description: "Solicita a validação do contrato de estado, sem alterar a origem.",
    confirmation: "Confirmar a solicitação de validação do contrato operacional?",
    tone: "neutral",
  },
  {
    id: "abrirRevisao",
    label: "Abrir revisão",
    description: "Registra a abertura controlada de um item para análise humana.",
    confirmation: "Confirmar a solicitação de abertura deste item para revisão?",
    tone: "neutral",
  },
  {
    id: "marcarRevisado",
    label: "Solicitar conclusão",
    description: "Pede o encerramento do item, condicionado às validações do núcleo.",
    confirmation: "Confirmar o pedido de conclusão desta revisão?",
    tone: "primary",
  },
];

export const readinessGates: ReadinessGate[] = [
  {
    id: "G0",
    label: "Baseline e preservação",
    state: "CONCLUIDO_E_VERIFICADO",
    evidenceCount: 4,
    owner: "Engenharia",
  },
  {
    id: "G1",
    label: "Controles críticos",
    state: "PREPARADO_NAO_EXECUTADO",
    evidenceCount: 2,
    owner: "Back-end + segurança",
  },
  {
    id: "G2",
    label: "Fronteira clínica",
    state: "PREPARADO_NAO_EXECUTADO",
    evidenceCount: 2,
    owner: "Responsável clínico",
  },
  {
    id: "G3",
    label: "CI, contratos e algoritmo",
    state: "PENDENTE_DE_APROVACAO",
    evidenceCount: 1,
    owner: "Revisores independentes",
    blockingReason: "Nova execução de CI e aprovações formais ainda necessárias.",
  },
  {
    id: "G4",
    label: "Migração em dry-run",
    state: "PENDENTE_DE_APROVACAO",
    evidenceCount: 1,
    owner: "Produção + migração",
    blockingReason: "Somente fixtures sintéticas; nenhuma fonte real autorizada.",
  },
];

export const traceabilityControls: TraceabilityControl[] = [
  {
    requirement: "CR-001",
    risk: "Liberação clínica acidental",
    control: "Feature flag desligada e fail-closed",
    test: "API não expõe rota clínica mutável",
    evidence: "api/tests/test_readiness.py",
    state: "CONCLUIDO_E_VERIFICADO",
  },
  {
    requirement: "PRV-002",
    risk: "Uso de dado real em teste",
    control: "Origem sintética determinística",
    test: "Contrato exige SYNTHETIC_DETERMINISTIC",
    evidence: "GET /v1/readiness",
    state: "CONCLUIDO_E_VERIFICADO",
  },
  {
    requirement: "DEP-003",
    risk: "Deploy ou migração involuntária",
    control: "Workflow manual com duplo bloqueio",
    test: "dry_run=true e variáveis desabilitadas",
    evidence: ".github/workflows/deploy-production.yml",
    state: "PREPARADO_NAO_EXECUTADO",
  },
  {
    requirement: "VAL-004",
    risk: "Confundir teste técnico com validação clínica",
    control: "Gate clínico independente",
    test: "Aprovação médica permanece obrigatória",
    evidence: "docs/governance/required-approvals.md",
    state: "PENDENTE_DE_APROVACAO",
  },
];
