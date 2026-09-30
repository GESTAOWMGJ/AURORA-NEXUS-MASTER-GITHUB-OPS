import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  actionDefinitions,
  auditLogs,
  connectorStatuses,
  evidenceEvents,
  operationalStatus,
  readinessGates,
  traceabilityControls,
  validationTasks,
} from "./demo-data";
import type {
  ActionDefinition,
  AuditLog,
  AuditResult,
  ConnectorState,
  EvidenceStatus,
  MockActionRequest,
  OperationalAction,
  OverallStatus,
  PipelineMetrics,
  ReadinessState,
  TaskPriority,
  ValidationStatus,
} from "./types";
import "./styles.css";

type IconName =
  | "activity"
  | "alert"
  | "arrow"
  | "check"
  | "clock"
  | "copy"
  | "database"
  | "file"
  | "grid"
  | "inbox"
  | "layers"
  | "link"
  | "lock"
  | "pulse"
  | "review"
  | "search"
  | "shield"
  | "spark"
  | "terminal"
  | "x";

const iconPaths: Record<IconName, ReactNode> = {
  activity: <><path d="M3 12h4l2.2-5 4.2 10 2.1-5H21" /></>,
  alert: <><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4.5" /><path d="M12 17h.01" /></>,
  arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  copy: <><rect x="8" y="8" width="11" height="11" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  database: <><ellipse cx="12" cy="5.5" rx="7.5" ry="3" /><path d="M4.5 5.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /><path d="M4.5 11.5v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /></>,
  file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h4" /><path d="M9 13h6M9 17h6" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  inbox: <><path d="M4 5h16l2 10v4H2v-4L4 5Z" /><path d="M2 15h5l2 3h6l2-3h5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" /></>,
  link: <><path d="M9 15 7.5 16.5a3.5 3.5 0 0 1-5-5L6 8a3.5 3.5 0 0 1 5 0" /><path d="m15 9 1.5-1.5a3.5 3.5 0 0 1 5 5L18 16a3.5 3.5 0 0 1-5 0" /><path d="m8 12 8 0" /></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /><path d="M12 14v3" /></>,
  pulse: <><path d="M4 5v14h16" /><path d="m7 15 3-4 3 2 4-6" /></>,
  review: <><path d="M4 4h11v16H4z" /><path d="M8 8h3M8 12h3" /><circle cx="17" cy="15" r="4" /><path d="m20 18 2 2" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m16 16 5 5" /></>,
  shield: <><path d="M12 3 4.5 6v5.5c0 4.5 3 7.7 7.5 9.5 4.5-1.8 7.5-5 7.5-9.5V6L12 3Z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
  spark: <><path d="m12 2 1.4 5.1L18 9l-4.6 1.9L12 16l-1.4-5.1L6 9l4.6-1.9L12 2Z" /><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>,
  x: <><path d="m6 6 12 12M18 6 6 18" /></>,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">
        {iconPaths[name]}
      </g>
    </svg>
  );
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  timeZoneName: "short",
});

const shortDateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

function formatShortDate(value: string) {
  return shortDateFormatter.format(new Date(value));
}

const statusLabels: Record<ValidationStatus, string> = {
  PENDENTE: "Pendente",
  EM_REVISAO: "Em revisão",
  BLOQUEADO: "Bloqueado",
  VALIDADO: "Validado",
};

const evidenceLabels: Record<EvidenceStatus, string> = {
  CAPTURADA: "Capturada",
  VALIDADA: "Validada",
  PENDENTE: "Pendente",
  BLOQUEADA: "Bloqueada",
};

const connectorLabels: Record<ConnectorState, string> = {
  CONECTADO: "Conectado",
  ATENCAO: "Atenção",
  INDISPONIVEL: "Indisponível",
  PLANEJADO: "Planejado",
};

const resultLabels: Record<AuditResult, string> = {
  SUCESSO: "Sucesso",
  AVISO: "Aviso",
  BLOQUEIO: "Bloqueio",
  SOLICITADO: "Solicitado",
};

const readinessLabels: Record<ReadinessState, string> = {
  CONCLUIDO_E_VERIFICADO: "Concluído e verificado",
  PREPARADO_NAO_EXECUTADO: "Preparado, não executado",
  PENDENTE_DE_APROVACAO: "Pendente de aprovação",
  BLOQUEADO: "Bloqueado",
};

const priorityLabels: Record<TaskPriority, string> = {
  ALTA: "Alta",
  MEDIA: "Média",
  BAIXA: "Baixa",
};

const overallStatusPresentation: Record<OverallStatus, {
  kicker: string;
  title: string;
  description: string;
}> = {
  OK: {
    kicker: "Operação nominal",
    title: "Operação íntegra e supervisionada",
    description: "O pipeline respondeu aos controles previstos e não há bloqueios críticos na leitura operacional atual.",
  },
  ATENCAO: {
    kicker: "Supervisão necessária",
    title: "Operação em atenção controlada",
    description: "O pipeline está ativo, com itens retidos para decisão humana. Nenhum bloqueio crítico foi identificado na leitura atual.",
  },
  ERRO: {
    kicker: "Bloqueio operacional",
    title: "Operação interrompida com segurança",
    description: "A leitura atual identificou um bloqueio crítico. O motor permanece protegido até nova validação autorizada.",
  },
};

const metricCards: Array<{
  key: keyof PipelineMetrics;
  label: string;
  helper: string;
  icon: IconName;
  tone: "teal" | "blue" | "green" | "gold" | "violet" | "red";
}> = [
  { key: "pendentes", label: "Pendentes", helper: "Aguardam o pipeline", icon: "inbox", tone: "gold" },
  { key: "processando", label: "Processando", helper: "Em execução controlada", icon: "activity", tone: "blue" },
  { key: "processados", label: "Processados", helper: "No ciclo atual", icon: "check", tone: "green" },
  { key: "revisaoHumana", label: "Revisão humana", helper: "Exigem decisão", icon: "review", tone: "violet" },
  { key: "duplicados", label: "Duplicados", helper: "Retidos sem gravação", icon: "copy", tone: "teal" },
  { key: "erros", label: "Erros", helper: "Elegíveis para triagem", icon: "alert", tone: "red" },
];

const navigation = [
  { href: "#visao-geral", label: "Visão geral", icon: "grid" as IconName },
  { href: "#validacao", label: "Validação", icon: "review" as IconName },
  { href: "#readiness", label: "Clinical readiness", icon: "shield" as IconName },
  { href: "#evidencias", label: "Evidências", icon: "layers" as IconName },
  { href: "#conectores", label: "Conectores", icon: "link" as IconName },
  { href: "#logs", label: "Logs", icon: "terminal" as IconName },
];

function SectionHeading({
  eyebrow,
  title,
  description,
  icon,
  id,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  icon?: IconName;
  id?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 id={id}>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {icon && <span className="section-heading__icon"><Icon name={icon} size={22} /></span>}
    </div>
  );
}

function StatePill({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "warning" | "danger" | "info" | "neutral";
}) {
  return <span className={`state-pill state-pill--${tone}`}><span className="state-pill__dot" />{children}</span>;
}

function validationTone(status: ValidationStatus) {
  if (status === "VALIDADO") return "success" as const;
  if (status === "BLOQUEADO") return "danger" as const;
  if (status === "EM_REVISAO") return "info" as const;
  return "warning" as const;
}

function evidenceTone(status: EvidenceStatus) {
  if (status === "VALIDADA" || status === "CAPTURADA") return "success" as const;
  if (status === "BLOQUEADA") return "danger" as const;
  return "warning" as const;
}

function connectorTone(status: ConnectorState) {
  if (status === "CONECTADO") return "success" as const;
  if (status === "INDISPONIVEL") return "danger" as const;
  if (status === "ATENCAO") return "warning" as const;
  return "neutral" as const;
}

function resultTone(result: AuditResult) {
  if (result === "SUCESSO") return "success" as const;
  if (result === "BLOQUEIO") return "danger" as const;
  if (result === "AVISO") return "warning" as const;
  return "info" as const;
}

function priorityTone(priority: TaskPriority) {
  if (priority === "ALTA") return "danger" as const;
  if (priority === "MEDIA") return "warning" as const;
  return "neutral" as const;
}

function readinessTone(state: ReadinessState) {
  if (state === "CONCLUIDO_E_VERIFICADO") return "success" as const;
  if (state === "BLOQUEADO") return "danger" as const;
  if (state === "PREPARADO_NAO_EXECUTADO") return "info" as const;
  return "warning" as const;
}

function App() {
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatus, setTaskStatus] = useState<ValidationStatus | "TODOS">("TODOS");
  const [pendingAction, setPendingAction] = useState<{
    definition: ActionDefinition;
    target?: string;
  } | null>(null);
  const [latestRequest, setLatestRequest] = useState<MockActionRequest | null>(null);
  const [localLogs, setLocalLogs] = useState<AuditLog[]>([]);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLocaleLowerCase("pt-BR");
    return validationTasks.filter((task) => {
      const matchesStatus = taskStatus === "TODOS" || task.status === taskStatus;
      const haystack = `${task.id} ${task.documentName} ${task.category}`.toLocaleLowerCase("pt-BR");
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [taskSearch, taskStatus]);

  const displayedLogs = useMemo(() => [...localLogs, ...auditLogs].slice(0, 6), [localLogs]);
  const totalPipeline = Object.values(operationalStatus.pipeline).reduce((sum, value) => sum + value, 0);
  const completionRate = Math.round(
    (operationalStatus.pipeline.processados / Math.max(totalPipeline, 1)) * 100,
  );
  const statusPresentation = overallStatusPresentation[operationalStatus.status];

  useEffect(() => {
    if (!pendingAction) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeConfirmation();
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ) ?? [],
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleEscape);
    cancelButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [pendingAction]);

  function openConfirmation(definition: ActionDefinition, target?: string) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPendingAction({ definition, target });
  }

  function closeConfirmation() {
    setPendingAction(null);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }

  function findAction(action: OperationalAction) {
    return actionDefinitions.find((definition) => definition.id === action);
  }

  function requestTaskAction(action: "abrirRevisao" | "marcarRevisado", target: string) {
    const definition = findAction(action);
    if (definition) openConfirmation(definition, target);
  }

  function submitMockRequest() {
    if (!pendingAction) return;
    const createdAt = new Date().toISOString();
    const requestId = `REQ-DEMO-${Date.now().toString(36).toUpperCase()}`;
    const request: MockActionRequest = {
      id: requestId,
      action: pendingAction.definition.id,
      label: pendingAction.definition.label,
      target: pendingAction.target,
      createdAt,
      state: "SOLICITADA",
    };
    const log: AuditLog = {
      id: `LOG-DEMO-${Date.now().toString(36).toUpperCase()}`,
      action: pendingAction.target
        ? `${pendingAction.definition.label} · ${pendingAction.target}`
        : pendingAction.definition.label,
      result: "SOLICITADO",
      at: createdAt,
      actorKind: "OPERADOR",
    };
    setLatestRequest(request);
    setLocalLogs((current) => [log, ...current]);
    closeConfirmation();
  }

  const primaryActions = actionDefinitions.filter(
    (definition) => definition.id !== "abrirRevisao" && definition.id !== "marcarRevisado",
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo-principal">Ir para o conteúdo principal</a>

      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">W</span>
          <div>
            <strong>WMGJ</strong>
            <span>Governança operacional</span>
          </div>
        </div>

        <nav className="sidebar__nav">
          {navigation.map((item, index) => (
            <a className={index === 0 ? "is-current" : ""} href={item.href} key={item.href}>
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
            </a>
          ))}
        </nav>

        <div className="sidebar__trust">
          <span className="sidebar__trust-icon"><Icon name="shield" size={20} /></span>
          <div>
            <strong>Ambiente protegido</strong>
            <span>Dados demonstrativos · sem PII/PHI</span>
          </div>
        </div>
      </aside>

      <main id="conteudo-principal" className="main-content" tabIndex={-1}>
        <header className="topbar">
          <div>
            <span className="eyebrow">Centro de controle</span>
            <h1>Operação sob evidência</h1>
          </div>
          <div className="topbar__meta">
            <span className="read-mode"><Icon name="lock" size={15} /> Modo leitura</span>
            <span className="demo-badge">Demonstração</span>
          </div>
        </header>

        <div className="dashboard-content">
          <section className={`status-overview status-overview--${operationalStatus.status.toLocaleLowerCase("pt-BR")}`} id="visao-geral" aria-labelledby="status-title">
            <div className="status-overview__main">
              <span className="status-kicker"><span /> {statusPresentation.kicker}</span>
              <h2 id="status-title">{statusPresentation.title}</h2>
              <p>{statusPresentation.description}</p>
              <div className="status-overview__time">
                <Icon name="clock" size={17} />
                Última execução validada: <strong>{formatDateTime(operationalStatus.ultimaExecucao)}</strong>
              </div>
            </div>

            <div className="status-overview__score" aria-label={`${completionRate}% do volume consolidado processado`}>
              <div className="score-ring" style={{ "--score": `${completionRate * 3.6}deg` } as React.CSSProperties}>
                <span><strong>{completionRate}%</strong><small>processado</small></span>
              </div>
              <div>
                <span className="score-label">Integridade da auditoria</span>
                <strong className="audit-state">
                  <Icon name={operationalStatus.auditoria.ok ? "shield" : "alert"} size={17} />
                  {operationalStatus.auditoria.ok ? "Aprovada" : "Bloqueada"}
                </strong>
              </div>
            </div>
          </section>

          <div className="read-section-label" aria-label="Seção somente para leitura">
            <Icon name="grid" size={16} /> Leitura operacional
          </div>

          <section className="metrics-grid" aria-label="Métricas da fila">
            {metricCards.map((metric) => (
              <article className={`metric-card metric-card--${metric.tone}`} key={metric.key}>
                <div className="metric-card__head">
                  <span className="metric-card__icon"><Icon name={metric.icon} size={20} /></span>
                  <span className="metric-card__trend">Ciclo atual</span>
                </div>
                <strong>{numberFormatter.format(operationalStatus.pipeline[metric.key])}</strong>
                <span className="metric-card__label">{metric.label}</span>
                <small>{metric.helper}</small>
              </article>
            ))}
          </section>

          <section className="panel actions-panel" aria-labelledby="acoes-title">
            <div className="actions-panel__intro">
              <SectionHeading
                eyebrow="Ação controlada"
                title="Solicitações operacionais"
                description="Cada comando abaixo cria apenas um pedido rastreável. O motor operacional continua responsável por autorizar ou recusar a execução."
                icon="shield"
                id="acoes-title"
              />
              <div className="guardrail-note">
                <Icon name="lock" size={17} />
                <span><strong>Sem execução direta.</strong> Confirmação e registro são obrigatórios.</span>
              </div>
            </div>

            <div className="action-grid">
              {primaryActions.map((definition) => {
                const isAvailable = operationalStatus.acoesDisponiveis.includes(definition.id);
                return (
                  <button
                    className={`action-card action-card--${definition.tone}`}
                    disabled={!isAvailable}
                    key={definition.id}
                    onClick={() => openConfirmation(definition)}
                    type="button"
                  >
                    <span className="action-card__icon">
                      <Icon
                        name={definition.id === "diagnosticar" ? "pulse" : definition.id === "processarFila" ? "layers" : definition.id === "reprocessarErros" ? "alert" : definition.id === "auditarCodigo" ? "shield" : "file"}
                        size={20}
                      />
                    </span>
                    <span className="action-card__copy">
                      <strong>{definition.label}</strong>
                      <small>{definition.description}</small>
                    </span>
                    <Icon name="arrow" size={17} />
                  </button>
                );
              })}
            </div>

            {latestRequest && (
              <div className="request-receipt" role="status" aria-live="polite">
                <span className="request-receipt__icon"><Icon name="check" size={18} /></span>
                <div>
                  <span>Solicitação demonstrativa registrada</span>
                  <strong>{latestRequest.id}</strong>
                </div>
                <span className="request-receipt__state">Sem execução</span>
              </div>
            )}
          </section>

          <section className="panel validation-panel" id="validacao" aria-labelledby="validacao-title">
            <div className="panel__topline">
              <SectionHeading
                eyebrow="Decisão humana"
                title="Fila de validação"
                description="Itens anonimizados que exigem conferência antes do fechamento por evidência."
                icon="review"
                id="validacao-title"
              />
              <div className="table-filters" role="search">
                <label className="search-field">
                  <span className="visually-hidden">Buscar na fila</span>
                  <Icon name="search" size={17} />
                  <input
                    onChange={(event) => setTaskSearch(event.target.value)}
                    placeholder="Buscar ID, lote ou categoria"
                    type="search"
                    value={taskSearch}
                  />
                </label>
                <label className="select-field">
                  <span className="visually-hidden">Filtrar por status</span>
                  <select
                    onChange={(event) => setTaskStatus(event.target.value as ValidationStatus | "TODOS")}
                    value={taskStatus}
                  >
                    <option value="TODOS">Todos os status</option>
                    <option value="PENDENTE">Pendentes</option>
                    <option value="EM_REVISAO">Em revisão</option>
                    <option value="BLOQUEADO">Bloqueados</option>
                    <option value="VALIDADO">Validados</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <caption className="visually-hidden">Fila de tarefas para validação humana</caption>
                <thead>
                  <tr>
                    <th scope="col">Documento</th>
                    <th scope="col">Categoria</th>
                    <th scope="col">Prioridade</th>
                    <th scope="col">Prazo</th>
                    <th scope="col">Responsável</th>
                    <th scope="col">Status</th>
                    <th scope="col"><span className="visually-hidden">Ação</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((task) => {
                    const closeReview = task.status === "EM_REVISAO";
                    return (
                      <tr key={task.id}>
                        <td>
                          <span className="document-cell__id">{task.id}</span>
                          <strong>{task.documentName}</strong>
                        </td>
                        <td>{task.category}</td>
                        <td><StatePill tone={priorityTone(task.priority)}>{priorityLabels[task.priority]}</StatePill></td>
                        <td><time dateTime={task.dueAt}>{formatShortDate(task.dueAt)}</time></td>
                        <td>{task.assignee}</td>
                        <td><StatePill tone={validationTone(task.status)}>{statusLabels[task.status]}</StatePill></td>
                        <td className="table-action">
                          <button
                            aria-label={`${closeReview ? "Solicitar conclusão" : "Abrir revisão"} de ${task.id}`}
                            className="text-button"
                            onClick={() => requestTaskAction(closeReview ? "marcarRevisado" : "abrirRevisao", task.id)}
                            type="button"
                          >
                            {closeReview ? "Solicitar conclusão" : "Abrir revisão"}
                            <Icon name="arrow" size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredTasks.length === 0 && (
                <div className="empty-state" role="status">
                  <Icon name="search" size={24} />
                  <strong>Nenhum item encontrado</strong>
                  <span>Ajuste a busca ou o filtro de status.</span>
                </div>
              )}
            </div>
          </section>

          <section className="panel readiness-panel" id="readiness" aria-labelledby="readiness-title">
            <div className="panel__topline">
              <SectionHeading
                eyebrow="Clinical-readiness"
                title="Prontidão sem ativação clínica"
                description="Evidência técnica do PR draft. Uso clínico, comunicação ao paciente, deploy e migração real permanecem bloqueados."
                icon="shield"
                id="readiness-title"
              />
              <div className="clinical-lock"><Icon name="lock" size={16} /> Clinical use: OFF</div>
            </div>

            <ol className="gate-grid" aria-label="Gates de prontidão G0 a G4">
              {readinessGates.map((gate) => (
                <li className={`gate-card gate-card--${readinessTone(gate.state)}`} key={gate.id}>
                  <div className="gate-card__head">
                    <strong>{gate.id}</strong>
                    <StatePill tone={readinessTone(gate.state)}>{readinessLabels[gate.state]}</StatePill>
                  </div>
                  <h3>{gate.label}</h3>
                  <p>{gate.owner}</p>
                  <span>{gate.evidenceCount} evidência{gate.evidenceCount === 1 ? "" : "s"}</span>
                  {gate.blockingReason && <small>{gate.blockingReason}</small>}
                </li>
              ))}
            </ol>

            <div className="traceability-table table-wrap">
              <table>
                <caption>Rastreabilidade de requisito, risco, controle, teste e evidência</caption>
                <thead>
                  <tr>
                    <th scope="col">Requisito</th>
                    <th scope="col">Risco</th>
                    <th scope="col">Controle</th>
                    <th scope="col">Teste</th>
                    <th scope="col">Evidência</th>
                    <th scope="col">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {traceabilityControls.map((item) => (
                    <tr key={item.requirement}>
                      <td><code>{item.requirement}</code></td>
                      <td>{item.risk}</td>
                      <td>{item.control}</td>
                      <td>{item.test}</td>
                      <td><code>{item.evidence}</code></td>
                      <td><StatePill tone={readinessTone(item.state)}>{readinessLabels[item.state]}</StatePill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="two-column-grid">
            <section className="panel" id="evidencias" aria-labelledby="evidencias-title">
              <SectionHeading
                eyebrow="Rastreabilidade"
                title="Linha de evidência"
                description="Último encadeamento registrado, sem conteúdo identificável."
                icon="layers"
                id="evidencias-title"
              />
              <ol className="evidence-timeline" aria-label="Eventos da linha de evidência">
                {evidenceEvents.map((event) => (
                  <li className={`evidence-event evidence-event--${event.status.toLocaleLowerCase("pt-BR")}`} key={event.id}>
                    <span className="evidence-event__marker"><Icon name={event.status === "PENDENTE" ? "clock" : event.status === "BLOQUEADA" ? "x" : "check"} size={14} /></span>
                    <div className="evidence-event__content">
                      <div>
                        <strong>{event.label}</strong>
                        <StatePill tone={evidenceTone(event.status)}>{evidenceLabels[event.status]}</StatePill>
                      </div>
                      <p>{event.actor}</p>
                      <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel" id="conectores" aria-labelledby="conectores-title">
              <SectionHeading
                eyebrow="Integrações"
                title="Saúde dos conectores"
                description="Leitura demonstrativa da disponibilidade e do escopo atual."
                icon="link"
                id="conectores-title"
              />
              <div className="connector-list">
                {connectorStatuses.map((connector) => (
                  <article className="connector-item" key={connector.name}>
                    <span className="connector-item__mark"><Icon name={connector.name === "Cloud Firestore" ? "database" : "link"} size={18} /></span>
                    <div>
                      <div className="connector-item__title">
                        <strong>{connector.name}</strong>
                        <StatePill tone={connectorTone(connector.state)}>{connectorLabels[connector.state]}</StatePill>
                      </div>
                      <p>{connector.detail}</p>
                      <time dateTime={connector.lastCheckedAt}>Leitura: {formatShortDate(connector.lastCheckedAt)}</time>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <section className="panel log-panel" id="logs" aria-labelledby="logs-title">
            <div className="panel__topline">
              <SectionHeading
                eyebrow="Auditoria técnica"
                title="Logs recentes"
                description="Eventos higienizados: sem conteúdo documental, credenciais ou identificadores pessoais."
                icon="terminal"
                id="logs-title"
              />
              <span className="sanitized-label"><Icon name="shield" size={15} /> Conteúdo sanitizado</span>
            </div>
            <div className="log-list" role="list" aria-label="Logs recentes sanitizados">
              {displayedLogs.map((log) => (
                <div className="log-row" key={log.id} role="listitem">
                  <code>{log.id}</code>
                  <time dateTime={log.at}>{formatDateTime(log.at)}</time>
                  <span className="log-row__action">{log.action}</span>
                  <span className="actor-kind">{log.actorKind}</span>
                  <StatePill tone={resultTone(log.result)}>{resultLabels[log.result]}</StatePill>
                </div>
              ))}
            </div>
          </section>

          <footer className="dashboard-footer">
            <span>WMGJ · Governança operacional orientada por evidência</span>
            <span><Icon name="lock" size={14} /> MVP local · sem integração ativa</span>
          </footer>
        </div>
      </main>

      {pendingAction && (
        <div
          aria-labelledby="confirmation-title"
          aria-describedby="confirmation-description"
          aria-modal="true"
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeConfirmation();
          }}
          role="dialog"
        >
          <div className="confirmation-dialog" ref={dialogRef}>
            <div className="confirmation-dialog__icon"><Icon name="shield" size={24} /></div>
            <span className="eyebrow">Confirmação obrigatória</span>
            <h2 id="confirmation-title">{pendingAction.definition.label}</h2>
            <p id="confirmation-description">{pendingAction.definition.confirmation}</p>
            {pendingAction.target && (
              <div className="confirmation-target"><span>Alvo anonimizado</span><strong>{pendingAction.target}</strong></div>
            )}
            <div className="confirmation-safety">
              <Icon name="lock" size={17} />
              Este MVP registrará somente uma solicitação demonstrativa. Nenhum documento, fila ou integração será alterado.
            </div>
            <div className="confirmation-dialog__actions">
              <button className="button button--ghost" onClick={closeConfirmation} ref={cancelButtonRef} type="button">Cancelar</button>
              <button className="button button--primary" onClick={submitMockRequest} type="button">
                Confirmar solicitação <Icon name="arrow" size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
