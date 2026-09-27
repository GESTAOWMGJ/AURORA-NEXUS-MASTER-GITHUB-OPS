(() => {
  "use strict";

  const POLL_INTERVAL_MS = 60_000;
  const REQUEST_TIMEOUT_MS = 15_000;
  const AGE_TICK_MS = 30_000;
  const DISPLAY_TIME_ZONE = "America/Sao_Paulo";
  const ORG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
  const COMPETENCE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

  const labels = {
    transport: {
      IDLE: "Aguardando",
      CONNECTING: "Conectando",
      ONLINE: "Online",
      RECONNECTING: "Reconectando",
      OFFLINE: "Offline",
      ERROR: "Falha de transporte",
    },
    freshness: {
      FRESH: "Atual",
      DELAYED: "Atrasado",
      STALE: "Desatualizado",
      UNKNOWN: "Desconhecido",
    },
    completeness: {
      COMPLETE: "Completa",
      PARTIAL: "Parcial",
      EMPTY: "Vazia",
      INVALID: "Inválida",
      UNKNOWN: "Desconhecida",
    },
    severity: {
      NOMINAL: "Nominal",
      ATTENTION: "Atenção",
      BLOCKED: "Bloqueada",
      UNKNOWN: "Desconhecida",
    },
    risk: {
      LOW: "Baixo",
      MEDIUM: "Médio",
      HIGH: "Alto",
      CRITICAL: "Crítico",
    },
  };

  const tones = {
    transport: {
      IDLE: "neutral",
      CONNECTING: "info",
      ONLINE: "success",
      RECONNECTING: "warning",
      OFFLINE: "warning",
      ERROR: "danger",
    },
    freshness: {
      FRESH: "success",
      DELAYED: "warning",
      STALE: "danger",
      UNKNOWN: "neutral",
    },
    completeness: {
      COMPLETE: "success",
      PARTIAL: "warning",
      EMPTY: "info",
      INVALID: "danger",
      UNKNOWN: "neutral",
    },
    severity: {
      NOMINAL: "success",
      ATTENTION: "warning",
      BLOCKED: "danger",
      UNKNOWN: "neutral",
    },
    risk: {
      LOW: "neutral",
      MEDIUM: "info",
      HIGH: "warning",
      CRITICAL: "danger",
    },
  };

  const pipelineDefinitions = [
    { key: "queued", label: "Em fila", tone: "warning" },
    { key: "processing", label: "Processando", tone: "info" },
    { key: "validated", label: "Validados", tone: "success" },
    { key: "pendingHumanReview", label: "Revisão humana", tone: "warning" },
    { key: "failed", label: "Falhas", tone: "danger" },
    { key: "deadLetter", label: "Dead letter", tone: "danger" },
    { key: "duplicateEvents", label: "Eventos duplicados", tone: "neutral" },
  ];

  const state = {
    scope: null,
    demo: false,
    auth: "PENDING",
    transport: "IDLE",
    error: null,
    requestInFlight: false,
    lastAttemptAt: 0,
    lastKnownByScope: new Map(),
  };

  const elements = {};

  const numberFormatter = new Intl.NumberFormat("pt-BR");
  const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  });

  function byId(id) {
    return document.getElementById(id);
  }

  function captureElements() {
    [
      "scope-form",
      "org-input",
      "competence-input",
      "refresh-button",
      "command-status",
      "environment-badge",
      "auth-badge",
      "demo-banner",
      "scope-summary",
      "transport-card",
      "transport-value",
      "transport-note",
      "freshness-card",
      "freshness-value",
      "freshness-note",
      "completeness-card",
      "completeness-value",
      "completeness-note",
      "severity-card",
      "severity-value",
      "severity-note",
      "gate-panel",
      "gate-title",
      "gate-detail",
      "dashboard-content",
      "alerts-list",
      "alerts-empty",
      "pipeline-total",
      "pipeline-bars",
      "pipeline-note",
      "billed-amount",
      "received-amount",
      "pending-amount",
      "reconciliation-difference",
      "reconciliation-row",
      "open-findings",
      "critical-findings",
      "overdue-actions",
      "evidence-gaps",
      "sources-list",
      "sources-empty",
      "footer-state",
    ].forEach((id) => {
      elements[id] = byId(id);
    });
  }

  function currentCompetence() {
    const parts = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      timeZone: DISPLAY_TIME_ZONE,
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    return year && month ? `${year}-${month}` : "2026-08";
  }

  function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    const orgCandidate = String(params.get("org") || "wmgj").trim().toLowerCase();
    const competenceCandidate = String(params.get("competence") || currentCompetence()).trim();
    const scope = {
      org: ORG_PATTERN.test(orgCandidate) ? orgCandidate : "wmgj",
      competence: COMPETENCE_PATTERN.test(competenceCandidate)
        ? competenceCandidate
        : currentCompetence(),
    };
    return { scope, demo: params.get("demo") === "1" };
  }

  function writeUrlState(scope, demo, replace = false) {
    const params = new URLSearchParams();
    params.set("org", scope.org);
    params.set("competence", scope.competence);
    if (demo) params.set("demo", "1");
    const nextUrl = `${window.location.pathname}?${params.toString()}`;
    window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
  }

  function scopeKey(scope = state.scope) {
    return scope ? `${scope.org}:${scope.competence}` : "none";
  }

  function element(tagName, className, text) {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function isObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function assertOptionalFiniteNumber(record, key) {
    const value = record[key];
    if (value === null) return;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`CONTRACT_INVALID_NUMBER:${key}`);
    }
  }

  function assertFiniteNumber(record, key) {
    if (record[key] === null || record[key] === undefined) {
      throw new Error(`CONTRACT_REQUIRED_NUMBER_MISSING:${key}`);
    }
    assertOptionalFiniteNumber(record, key);
  }

  function validateResponse(payload, expectedScope) {
    if (!isObject(payload) || !isObject(payload.snapshot) || !isObject(payload.freshness)) {
      throw new Error("CONTRACT_INVALID_ROOT");
    }
    const snapshot = payload.snapshot;
    if (snapshot.schemaVersion !== 2) throw new Error("CONTRACT_SCHEMA_VERSION_UNSUPPORTED");
    if (snapshot.orgId !== expectedScope.org) throw new Error("CONTRACT_ORG_SCOPE_MISMATCH");
    if (snapshot.competence !== expectedScope.competence) {
      throw new Error("CONTRACT_COMPETENCE_SCOPE_MISMATCH");
    }
    if (!isObject(snapshot.pipeline) || !isObject(snapshot.financial) || !isObject(snapshot.audit)) {
      throw new Error("CONTRACT_METRICS_MISSING");
    }
    if (!Array.isArray(snapshot.sources) || !Array.isArray(snapshot.alerts)) {
      throw new Error("CONTRACT_COLLECTIONS_MISSING");
    }
    [
      "total",
      "queued",
      "processing",
      "validated",
      "pendingHumanReview",
      "failed",
      "deadLetter",
      "duplicateEvents",
    ].forEach((key) => assertOptionalFiniteNumber(snapshot.pipeline, key));
    [
      "billedAmount",
      "receivedAmount",
      "pendingAmount",
      "reconciliationDifference",
    ].forEach((key) => assertOptionalFiniteNumber(snapshot.financial, key));
    ["openFindings", "criticalFindings", "overdueActions", "evidenceGaps"].forEach(
      (key) => assertOptionalFiniteNumber(snapshot.audit, key),
    );
    assertFiniteNumber(payload.freshness, "ageSeconds");
    if (snapshot.facilityId !== null && typeof snapshot.facilityId !== "string") {
      throw new Error("CONTRACT_FACILITY_ID_INVALID");
    }
    if (Number.isNaN(Date.parse(snapshot.generatedAt))) throw new Error("CONTRACT_GENERATED_AT_INVALID");
    if (snapshot.asOf !== null && Number.isNaN(Date.parse(snapshot.asOf))) {
      throw new Error("CONTRACT_AS_OF_INVALID");
    }
    if (typeof snapshot.policyVersion !== "string" || !snapshot.policyVersion.trim()) {
      throw new Error("CONTRACT_POLICY_VERSION_INVALID");
    }
    if (Number.isNaN(Date.parse(payload.freshness.generatedAt))) {
      throw new Error("CONTRACT_FRESHNESS_AT_INVALID");
    }
    return payload;
  }

  function demoResponse(scope) {
    const now = Date.now();
    const iso = (offsetSeconds) => new Date(now - offsetSeconds * 1000).toISOString();
    return {
      snapshot: {
        schemaVersion: 2,
        orgId: scope.org,
        facilityId: null,
        competence: scope.competence,
        generatedAt: iso(42),
        asOf: iso(90),
        policyVersion: "wmgj-dashboard-demo-v1",
        completeness: "PARTIAL",
        severity: "ATTENTION",
        pipeline: {
          total: 420,
          queued: 18,
          processing: 4,
          validated: 382,
          pendingHumanReview: 9,
          failed: 5,
          deadLetter: 2,
          duplicateEvents: 7,
        },
        financial: {
          billedAmount: 486300,
          receivedAmount: 412850,
          pendingAmount: 73450,
          reconciliationDifference: 1250.42,
          currency: "BRL",
        },
        audit: {
          openFindings: 14,
          criticalFindings: 2,
          overdueActions: 3,
          evidenceGaps: 5,
        },
        sources: [
          {
            source: "Google Sheets",
            completeness: "COMPLETE",
            freshness: "FRESH",
            lastSuccessAt: iso(85),
            expectedCadenceSeconds: 300,
            staleAfterSeconds: 900,
            missing: false,
            detail: "Espelho sintético da base-mestre.",
          },
          {
            source: "Gmail documental",
            completeness: "COMPLETE",
            freshness: "DELAYED",
            lastSuccessAt: iso(190),
            expectedCadenceSeconds: 120,
            staleAfterSeconds: 600,
            missing: false,
            detail: "Indexação sintética concluída.",
          },
          {
            source: "Google Drive",
            completeness: "PARTIAL",
            freshness: "STALE",
            lastSuccessAt: iso(3600),
            expectedCadenceSeconds: 300,
            staleAfterSeconds: 900,
            missing: true,
            detail: "Duas partições sintéticas ainda aguardam reconciliação.",
          },
          {
            source: "Apps Script",
            completeness: "COMPLETE",
            freshness: "FRESH",
            lastSuccessAt: iso(120),
            expectedCadenceSeconds: 300,
            staleAfterSeconds: 900,
            missing: false,
            detail: "Heartbeat sintético disponível.",
          },
          {
            source: "Cloud Firestore",
            completeness: "COMPLETE",
            freshness: "FRESH",
            lastSuccessAt: iso(42),
            expectedCadenceSeconds: 60,
            staleAfterSeconds: 300,
            missing: false,
            detail: "Projeção demonstrativa em memória.",
          },
        ],
        alerts: [
          {
            alertId: "DEMO-ALERT-001",
            severity: "CRITICAL",
            title: "Diferença de conciliação acima do esperado",
            detail: "Valor exclusivamente sintético para demonstrar o estado crítico.",
            evidenceRefs: ["DEMO-EVIDENCE-001", "DEMO-EVIDENCE-002"],
            createdAt: iso(600),
          },
          {
            alertId: "DEMO-ALERT-002",
            severity: "MEDIUM",
            title: "Fonte parcialmente reconciliada",
            detail: "O Drive sintético ainda não cobre todas as partições da competência.",
            evidenceRefs: ["DEMO-EVIDENCE-003"],
            createdAt: iso(1800),
          },
        ],
        sanitized: true,
        sensitivity: "INTERNAL",
        state: "SHADOW",
        financialCents: {
          invoicedCents: 48630000,
          receivedCents: 41285000,
          glossCents: null,
          outstandingCents: 7345000,
        },
        operations: { openActions: 14, overdueActions: 3, openFindings: 14 },
        coverage: { evidencePercent: 98.8, reconciliationPercent: 84.9 },
        sampleSizes: {
          invoices: 420,
          bankTransactions: 382,
          glosses: 5,
          actionItems: 14,
          sourceDocuments: 405,
          reconciliations: 377,
          auditFindings: 14,
        },
        dataQuality: {
          complete: true,
          sourcePresent: true,
          invalidFinancialRecords: 0,
          validFinancialRecords: 807,
        },
        modules: [
          ["M01", "Ingestão e Proveniência Documental"],
          ["M02", "Contratos, Regras e Evidências"],
          ["M03", "Ciclo de Receita e Conciliação"],
          ["M04", "Glosas, Recursos e Divergências"],
          ["M05", "SLA e Workflow"],
          ["M06", "Governança e Planos de Ação"],
          ["M07", "Indicadores e Relatórios"],
          ["M08", "Integrações e Conectores"],
          ["M09", "Segurança, LGPD e Segregação"],
          ["M10", "Trilha de Auditoria e Integridade"],
        ].map(([id, name]) => ({ id, name, status: "LEARNING" })),
        engine: { name: "aurora-projection", version: 2, mode: "SHADOW" },
        sourceLimit: 1000,
        sourceHash: "d".repeat(64),
        snapshotId: "123e4567-e89b-42d3-a456-426614174000",
      },
      freshness: {
        state: "FRESH",
        ageSeconds: 42,
        generatedAt: new Date(now).toISOString(),
      },
    };
  }

  function endpointUrl(scope) {
    const template =
      window.WMGJ_DASHBOARD_ENDPOINT ||
      document.querySelector('meta[name="wmgj-dashboard-endpoint"]')?.content ||
      "/v1/organizations/{orgId}/dashboards/operational";
    const configured = template.replace("{orgId}", encodeURIComponent(scope.org));
    const url = new URL(configured, window.location.origin);
    url.searchParams.set("competence", scope.competence);
    return url;
  }

  async function resolveAuthContext() {
    let idToken = null;
    let appCheckToken = null;
    if (typeof window.WMGJ_AUTH?.getIdToken === "function") {
      const token = await window.WMGJ_AUTH.getIdToken();
      idToken = typeof token === "string" && token.trim() ? token.trim() : null;
    } else if (typeof window.WMGJ_ID_TOKEN === "string" && window.WMGJ_ID_TOKEN.trim()) {
      idToken = window.WMGJ_ID_TOKEN.trim();
    }
    if (typeof window.WMGJ_AUTH?.getAppCheckToken === "function") {
      const token = await window.WMGJ_AUTH.getAppCheckToken();
      appCheckToken = typeof token === "string" && token.trim() ? token.trim() : null;
    } else if (
      typeof window.WMGJ_APP_CHECK_TOKEN === "string" &&
      window.WMGJ_APP_CHECK_TOKEN.trim()
    ) {
      appCheckToken = window.WMGJ_APP_CHECK_TOKEN.trim();
    }
    return { idToken, appCheckToken };
  }

  function setCommandStatus(message) {
    elements["command-status"].textContent = message;
  }

  function showGate(title, detail) {
    elements["gate-title"].textContent = title;
    elements["gate-detail"].textContent = detail;
    elements["gate-panel"].hidden = false;
    elements["dashboard-content"].hidden = true;
  }

  function showDashboard() {
    elements["gate-panel"].hidden = true;
    elements["dashboard-content"].hidden = false;
  }

  function setStatusCard(kind, value, note) {
    const normalized = value || "UNKNOWN";
    elements[`${kind}-card`].dataset.tone = tones[kind][normalized] || "neutral";
    elements[`${kind}-value`].textContent = labels[kind][normalized] || normalized;
    elements[`${kind}-note`].textContent = note;
  }

  function formatNumber(value) {
    return Number.isFinite(value) ? numberFormatter.format(value) : "— · não aferido";
  }

  function formatCurrency(value, currency = "BRL") {
    if (!Number.isFinite(value)) return "— · não aferido";
    try {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency,
      }).format(value);
    } catch {
      return `${formatNumber(value)} ${currency}`;
    }
  }

  function formatSignedCurrency(value, currency) {
    if (!Number.isFinite(value)) return "— · não aferido";
    const formatted = formatCurrency(Math.abs(value), currency);
    if (value > 0) return `+${formatted}`;
    if (value < 0) return `−${formatted}`;
    return formatted;
  }

  function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Data indisponível" : dateTimeFormatter.format(date);
  }

  function formatAge(seconds) {
    const safe = Math.max(0, Math.round(Number(seconds) || 0));
    if (safe < 60) return `${safe} s`;
    if (safe < 3600) return `${Math.floor(safe / 60)} min`;
    if (safe < 86400) return `${Math.floor(safe / 3600)} h ${Math.floor((safe % 3600) / 60)} min`;
    return `${Math.floor(safe / 86400)} d ${Math.floor((safe % 86400) / 3600)} h`;
  }

  function currentEntry() {
    return state.lastKnownByScope.get(scopeKey()) || null;
  }

  function currentFreshnessAge(entry) {
    if (!entry) return 0;
    const elapsed = Math.max(0, Math.floor((Date.now() - entry.receivedAt) / 1000));
    return entry.response.freshness.ageSeconds + elapsed;
  }

  function renderEnvironment() {
    document.body.classList.toggle("is-demo", state.demo);
    elements["demo-banner"].hidden = !state.demo;
    elements["environment-badge"].classList.toggle("is-demo", state.demo);
    elements["environment-badge"].textContent = state.demo
      ? "Demo · dados sintéticos"
      : "Homologação";
    elements["auth-badge"].textContent =
      state.auth === "DEMO"
        ? "Autenticação dispensada no demo"
        : state.auth === "AUTHENTICATED"
          ? "Tokens presentes em memória"
          : "Autenticação pendente";
  }

  function renderTrust(entry) {
    const response = entry?.response || null;
    const snapshot = response?.snapshot || null;
    const freshness = response?.freshness || null;
    const transportNote = {
      IDLE: "Nenhuma requisição autorizada",
      CONNECTING: "Solicitando snapshot agregado",
      ONLINE: `Última resposta em ${entry ? formatDateTime(entry.receivedAt) : "—"}`,
      RECONNECTING: "Mantendo a última leitura em memória",
      OFFLINE: "Sem rede; nenhuma ação será enfileirada",
      ERROR: "Falha na leitura; dados anteriores preservados",
    }[state.transport];
    setStatusCard("transport", state.transport, transportNote);

    if (freshness) {
      const suffix = state.transport === "ONLINE" ? "" : " · último servidor";
      setStatusCard(
        "freshness",
        freshness.state,
        `Idade aproximada: ${formatAge(currentFreshnessAge(entry))}${suffix}`,
      );
    } else {
      setStatusCard("freshness", "UNKNOWN", "Sem snapshot do servidor");
    }

    if (snapshot) {
      const missingSources = snapshot.sources.filter(
        (source) => source.missing || source.completeness !== "COMPLETE",
      ).length;
      const completenessNote = missingSources
        ? `${missingSources} fonte${missingSources === 1 ? "" : "s"} não completa${
            missingSources === 1 ? "" : "s"
          }`
        : `${snapshot.sources.length} fonte${snapshot.sources.length === 1 ? "" : "s"} declarada${
            snapshot.sources.length === 1 ? "" : "s"
          }`;
      setStatusCard("completeness", snapshot.completeness, completenessNote);
      setStatusCard(
        "severity",
        snapshot.severity,
        `${snapshot.alerts.length} alerta${snapshot.alerts.length === 1 ? "" : "s"} no escopo`,
      );
      const facility = snapshot.facilityId ? ` · unidade ${snapshot.facilityId}` : " · todas as unidades autorizadas";
      const asOf = snapshot.asOf ? ` · dados até ${formatDateTime(snapshot.asOf)}` : " · data de corte não aferida";
      elements["scope-summary"].textContent = `${snapshot.orgId}${facility} · competência ${snapshot.competence}${asOf} · política ${snapshot.policyVersion} · gerado em ${formatDateTime(snapshot.generatedAt)} (${DISPLAY_TIME_ZONE})`;
    } else {
      setStatusCard("completeness", "UNKNOWN", "Sem dados validados");
      setStatusCard("severity", "UNKNOWN", "Sem inferência local");
      elements["scope-summary"].textContent = `${state.scope.org} · competência ${state.scope.competence} · aguardando snapshot`;
    }
  }

  function renderPipeline(pipeline) {
    elements["pipeline-total"].textContent = formatNumber(pipeline.total);
    const knownValues = pipelineDefinitions
      .map((definition) => pipeline[definition.key])
      .filter((value) => Number.isFinite(value));
    const denominator = Math.max(
      1,
      Number.isFinite(pipeline.total) ? pipeline.total : 0,
      ...knownValues,
    );
    const rows = pipelineDefinitions.map((definition) => {
      const value = pipeline[definition.key];
      const known = Number.isFinite(value);
      const row = element("div", "metric-bar");
      row.dataset.tone = definition.tone;
      row.classList.toggle("is-unknown", !known);
      const labelRow = element("div", "metric-bar__label");
      labelRow.append(
        element("span", "", definition.label),
        element("strong", "", formatNumber(value)),
      );
      const track = element("div", "metric-bar__track");
      track.setAttribute("aria-hidden", "true");
      const fill = element("div", "metric-bar__fill");
      fill.style.setProperty(
        "--bar-width",
        known ? `${Math.min(100, (value / denominator) * 100)}%` : "0%",
      );
      track.append(fill);
      row.append(labelRow, track);
      return row;
    });
    elements["pipeline-bars"].replaceChildren(...rows);
    if (
      Number.isFinite(pipeline.validated) &&
      Number.isFinite(pipeline.total) &&
      Number.isFinite(pipeline.pendingHumanReview)
    ) {
      elements["pipeline-note"].textContent = `${formatNumber(pipeline.validated)} validados de ${formatNumber(
        pipeline.total,
      )}; ${formatNumber(pipeline.pendingHumanReview)} aguardam revisão humana. Eventos duplicados são exibidos separadamente do total.`;
    } else {
      elements["pipeline-note"].textContent = "Uma ou mais métricas do pipeline não foram aferidas. Ausência permanece distinta de zero.";
    }
  }

  function renderFinancial(financial) {
    const currency = financial.currency || "BRL";
    elements["billed-amount"].textContent = formatCurrency(financial.billedAmount, currency);
    elements["received-amount"].textContent = formatCurrency(financial.receivedAmount, currency);
    elements["pending-amount"].textContent = formatCurrency(financial.pendingAmount, currency);
    elements["reconciliation-difference"].textContent = formatSignedCurrency(
      financial.reconciliationDifference,
      currency,
    );
    elements["reconciliation-row"].dataset.tone = Number.isFinite(
      financial.reconciliationDifference,
    )
      ? financial.reconciliationDifference === 0
        ? "success"
        : "warning"
      : "neutral";
  }

  function renderAudit(audit) {
    elements["open-findings"].textContent = formatNumber(audit.openFindings);
    elements["critical-findings"].textContent = formatNumber(audit.criticalFindings);
    elements["overdue-actions"].textContent = formatNumber(audit.overdueActions);
    elements["evidence-gaps"].textContent = formatNumber(audit.evidenceGaps);
  }

  function renderAlerts(alerts) {
    const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const sorted = [...alerts].sort((left, right) => {
      const riskDifference = (order[left.severity] ?? 9) - (order[right.severity] ?? 9);
      return riskDifference || Date.parse(right.createdAt) - Date.parse(left.createdAt);
    });
    const items = sorted.map((alert) => {
      const item = element("li", "alert-item");
      item.dataset.risk = alert.severity;
      const head = element("div", "alert-item__head");
      head.append(
        element("h3", "", alert.title),
        statusPill(labels.risk[alert.severity] || alert.severity, tones.risk[alert.severity] || "neutral"),
      );
      const detail = element("p", "", alert.detail);
      const evidenceCount = Array.isArray(alert.evidenceRefs) ? alert.evidenceRefs.length : 0;
      const meta = element(
        "small",
        "",
        `${formatDateTime(alert.createdAt)} · ${evidenceCount} evidência${evidenceCount === 1 ? "" : "s"} vinculada${
          evidenceCount === 1 ? "" : "s"
        }`,
      );
      item.append(head, detail, meta);
      return item;
    });
    elements["alerts-list"].replaceChildren(...items);
    elements["alerts-empty"].hidden = items.length !== 0;
  }

  function statusPill(text, tone) {
    const pill = element("span", "state-pill", text);
    pill.dataset.tone = tone;
    return pill;
  }

  function renderSources(sources) {
    const items = sources.map((source) => {
      const item = element("li", "source-item");
      item.classList.toggle("is-missing", source.missing === true);
      const head = element("div", "source-item__head");
      const statusGroup = element("div", "source-item__states");
      statusGroup.append(
        statusPill(
          labels.completeness[source.completeness] || source.completeness,
          tones.completeness[source.completeness] || "neutral",
        ),
      );
      statusGroup.append(
        statusPill(
          labels.freshness[source.freshness] || source.freshness || "Frescor desconhecido",
          tones.freshness[source.freshness] || "neutral",
        ),
      );
      if (source.missing) statusGroup.append(statusPill("Fonte ausente", "danger"));
      head.append(element("strong", "", source.source), statusGroup);
      const detail = element("p", "", source.detail || "Sem detalhe adicional.");
      const time = element(
        "time",
        "",
        source.lastSuccessAt
          ? `Último sucesso: ${formatDateTime(source.lastSuccessAt)}`
          : "Último sucesso não aferido",
      );
      if (source.lastSuccessAt) time.dateTime = source.lastSuccessAt;
      const cadence = element(
        "small",
        "source-item__cadence",
        `Cadência esperada: ${
          Number.isFinite(source.expectedCadenceSeconds)
            ? formatAge(source.expectedCadenceSeconds)
            : "— · não aferida"
        } · limite stale: ${
          Number.isFinite(source.staleAfterSeconds)
            ? formatAge(source.staleAfterSeconds)
            : "— · não aferido"
        }`,
      );
      item.append(head, detail, time, cadence);
      return item;
    });
    elements["sources-list"].replaceChildren(...items);
    elements["sources-empty"].hidden = items.length !== 0;
  }

  function renderDashboard(entry, preserved = false) {
    const response = entry.response;
    const snapshot = response.snapshot;
    showDashboard();
    renderTrust(entry);
    renderAlerts(snapshot.alerts);
    renderPipeline(snapshot.pipeline);
    renderFinancial(snapshot.financial);
    renderAudit(snapshot.audit);
    renderSources(snapshot.sources);
    elements["footer-state"].textContent = `${snapshot.orgId} · ${snapshot.competence} · ${
      state.demo ? "dados sintéticos" : preserved ? "última leitura em memória" : "leitura autorizada"
    } · sem cache persistente`;
  }

  function renderCurrentState() {
    renderEnvironment();
    const entry = currentEntry();
    renderTrust(entry);
    elements["refresh-button"].disabled = state.requestInFlight;
    if (entry) {
      renderDashboard(entry, state.transport !== "ONLINE");
      return;
    }
    if (state.requestInFlight) {
      showGate("Carregando snapshot agregado", "A tela permanecerá vazia até receber dados autorizados e validar o contrato.");
    } else if (state.auth === "PENDING") {
      showGate(
        "Autenticação ainda não fornecida",
        "A futura camada de login deverá fornecer Firebase ID Token e App Check apenas em memória. Nenhum dado operacional será solicitado enquanto um deles estiver ausente.",
      );
    } else if (state.error) {
      showGate(
        "Leitura indisponível",
        "Não existe um snapshot anterior em memória para este escopo. Verifique transporte, autenticação e disponibilidade da API.",
      );
    }
    elements["footer-state"].textContent = `${state.scope.org} · ${state.scope.competence} · sem dados carregados · sem cache persistente`;
  }

  async function loadDashboard({ manual = false } = {}) {
    if (state.requestInFlight || !state.scope) return;
    state.requestInFlight = true;
    state.lastAttemptAt = Date.now();
    state.error = null;

    if (state.demo) {
      state.auth = "DEMO";
      state.transport = "ONLINE";
      const response = validateResponse(demoResponse(state.scope), state.scope);
      state.lastKnownByScope.set(scopeKey(), { response, receivedAt: Date.now() });
      state.requestInFlight = false;
      setCommandStatus("Modo demo atualizado com dados sintéticos. Nenhuma API foi consultada.");
      renderCurrentState();
      return;
    }

    const authContext = await resolveAuthContext();
    if (!authContext.idToken || !authContext.appCheckToken) {
      state.auth = "PENDING";
      state.transport = "IDLE";
      state.requestInFlight = false;
      setCommandStatus(
        "Firebase ID Token e App Check são obrigatórios. Nenhuma requisição de dados foi enviada.",
      );
      renderCurrentState();
      return;
    }

    state.auth = "AUTHENTICATED";
    state.transport = currentEntry() ? "RECONNECTING" : "CONNECTING";
    setCommandStatus(manual ? "Atualização manual em andamento…" : "Consultando snapshot agregado…");
    renderCurrentState();

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await window.fetch(endpointUrl(state.scope), {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${authContext.idToken}`,
          "X-Firebase-AppCheck": authContext.appCheckToken,
        },
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new Error(`DASHBOARD_HTTP_${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = validateResponse(await response.json(), state.scope);
      state.lastKnownByScope.set(scopeKey(), { response: payload, receivedAt: Date.now() });
      state.transport = "ONLINE";
      state.error = null;
      setCommandStatus(`Leitura atualizada em ${formatDateTime(new Date().toISOString())}.`);
    } catch (error) {
      state.error = error;
      if (error.status === 401 || error.status === 403) state.auth = "PENDING";
      state.transport = navigator.onLine ? "ERROR" : "OFFLINE";
      setCommandStatus(
        currentEntry()
          ? "Falha na atualização. A última leitura confiável permanece visível apenas em memória."
          : "Falha na atualização e nenhum snapshot anterior existe neste escopo.",
      );
    } finally {
      window.clearTimeout(timeout);
      state.requestInFlight = false;
      renderCurrentState();
    }
  }

  function applyUrlState({ replace = false } = {}) {
    const next = readUrlState();
    state.scope = next.scope;
    state.demo = next.demo;
    elements["org-input"].value = state.scope.org;
    elements["competence-input"].value = state.scope.competence;
    if (replace) writeUrlState(state.scope, state.demo, true);
    state.auth = state.demo ? "DEMO" : "PENDING";
    state.transport = state.demo ? "CONNECTING" : "IDLE";
    state.error = null;
    renderCurrentState();
    loadDashboard();
  }

  function bindEvents() {
    elements["scope-form"].addEventListener("submit", (event) => {
      event.preventDefault();
      if (!elements["scope-form"].reportValidity()) return;
      const nextScope = {
        org: elements["org-input"].value.trim().toLowerCase(),
        competence: elements["competence-input"].value.trim(),
      };
      if (!ORG_PATTERN.test(nextScope.org) || !COMPETENCE_PATTERN.test(nextScope.competence)) return;
      writeUrlState(nextScope, state.demo);
      applyUrlState();
    });

    elements["refresh-button"].addEventListener("click", () => loadDashboard({ manual: true }));
    window.addEventListener("popstate", () => applyUrlState());
    window.addEventListener("offline", () => {
      state.transport = "OFFLINE";
      setCommandStatus("Dispositivo offline. A última leitura permanece somente em memória.");
      renderCurrentState();
    });
    window.addEventListener("online", () => {
      state.transport = currentEntry() ? "RECONNECTING" : "CONNECTING";
      setCommandStatus("Conectividade restaurada. Validando uma nova leitura…");
      renderCurrentState();
      loadDashboard();
    });
    document.addEventListener("visibilitychange", () => {
      if (
        document.visibilityState === "visible" &&
        !state.demo &&
        Date.now() - state.lastAttemptAt >= POLL_INTERVAL_MS
      ) {
        loadDashboard();
      }
    });
  }

  function initTimers() {
    window.setInterval(() => {
      if (
        !state.demo &&
        document.visibilityState === "visible" &&
        navigator.onLine &&
        Date.now() - state.lastAttemptAt >= POLL_INTERVAL_MS
      ) {
        loadDashboard();
      }
    }, POLL_INTERVAL_MS);
    window.setInterval(() => {
      if (currentEntry()) renderTrust(currentEntry());
    }, AGE_TICK_MS);
  }

  function init() {
    captureElements();
    bindEvents();
    initTimers();
    applyUrlState({ replace: true });
  }

  init();
})();
