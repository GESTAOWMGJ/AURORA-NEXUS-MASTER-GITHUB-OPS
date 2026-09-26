/* Aurora Nexus / Finance Signal 2.0. Presentation only: no network, tokens or storage. */
(() => {
  "use strict";
  const comparisonDefinitions = [
    { id: "billed-amount", label: "Faturamento", color: "var(--revenue)" },
    { id: "received-amount", label: "Recebido", color: "var(--success-ink)" },
    { id: "pending-amount", label: "A receber", color: "var(--warning-ink)" },
  ];
  let previousComparison = "";
  const missing = (value) => !value || value.startsWith("—") || /não aferido/i.test(value);
  // Parse only the pt-BR BRL output of the existing renderer, never arbitrary numeric text.
  function brlValue(text) {
    const clean = text.trim().replace(/[\u00a0\u202f]/g, " ");
    if (!/^[+−-]?R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}$/.test(clean) &&
        !/^[+−-]?R\$\s*\d+,\d{2}$/.test(clean)) return null;
    const number = Number(clean.replace("R$", "").replace(/\s|\./g, "").replace(",", ".").replace("−", "-"));
    return Number.isFinite(number) && number >= 0 ? number : null;
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function renderComparison() {
    const host = document.getElementById("finance-comparison");
    if (!host) return;
    const values = comparisonDefinitions.map((definition) => {
      const text = document.getElementById(definition.id)?.textContent?.trim() || "";
      return { ...definition, text, value: brlValue(text) };
    });
    const fingerprint = JSON.stringify(values.map(({text}) => text));
    if (fingerprint === previousComparison) return;
    previousComparison = fingerprint;
    const maximum = Math.max(0, ...values.map(({value}) => value ?? 0));
    const rows = values.map((entry) => {
      const known = entry.value !== null;
      const row = node("div", "comparison-row" + (known ? "" : " is-unknown"));
      row.style.setProperty("--bar-color", known ? entry.color : "var(--neutral-ink)");
      const label = node("span", "comparison-label");
      const key = node("span", "color-key");
      key.setAttribute("aria-hidden", "true");
      label.append(key, document.createTextNode(entry.label));
      const amount = node("strong", "", known ? entry.text : "Não comparável");
      const track = node("div", "comparison-track");
      track.setAttribute("aria-hidden", "true");
      const fill = node("div", "comparison-fill");
      fill.style.setProperty("--bar-width", known && maximum > 0 ? `${entry.value / maximum * 100}%` : "0%");
      track.append(fill);
      row.append(label, amount, track);
      return row;
    });
    host.replaceChildren(...rows);
    const unit = document.getElementById("comparison-unit");
    if (unit) unit.textContent = values.every(({value}) => value !== null)
      ? "Valores em reais" : "Ausência, sinal negativo ou moeda não comparável";
  }
  function refreshSignals() {
    document.querySelectorAll(".money-card, #audit-metrics > div").forEach((card) => {
      const value = card.querySelector("dd")?.textContent?.trim() || "";
      card.classList.toggle("is-unmeasured", missing(value));
      card.classList.toggle("is-negative-amount", /^[−-]R\$/.test(value));
      if (card.closest("#audit-metrics")) card.classList.toggle("is-clear-count", !missing(value) && /^0$/.test(value));
    });
    const alerts = document.getElementById("alerts-section");
    if (alerts) {
      const signal = alerts.querySelector('[data-risk="CRITICAL"]') ? "CRITICAL"
        : alerts.querySelector('[data-risk="HIGH"]') ? "HIGH" : "NONE";
      alerts.dataset.signal = signal;
      const hasReading = document.getElementById("dashboard-content")?.hidden === false;
      const count = hasReading ? String(alerts.querySelectorAll(".alert-item").length) : "—";
      ["alert-count", "nav-alert-count"].forEach((id) => {
        const badge = document.getElementById(id);
        if (badge) { badge.textContent = count; badge.dataset.signal = signal; }
      });
    }
    const reading = document.getElementById("reading-state");
    if (reading) {
      const freshness = document.getElementById("freshness-value")?.textContent || "Não aferida";
      const coverage = document.getElementById("completeness-value")?.textContent || "Desconhecida";
      const transport = document.getElementById("transport-value")?.textContent || "Aguardando";
      const toneOrder = ["neutral", "success", "info", "warning", "danger"];
      const observed = ["transport-card", "freshness-card", "completeness-card"].map((id) => document.getElementById(id)?.dataset.tone || "neutral");
      const tone = observed.includes("neutral") && observed.every(t => ["neutral","success","info"].includes(t))
        ? "neutral" : observed.reduce((a,b) => toneOrder.indexOf(a) >= toneOrder.indexOf(b) ? a : b, "neutral");
      reading.dataset.tone = tone;
      reading.textContent = `${transport} · ${freshness} · cobertura ${coverage.toLowerCase()}`;
    }
    renderComparison();
    refreshScope();
  }
  function refreshScope() {
    const org = document.getElementById("org-input")?.value?.trim() || "";
    const competence = document.getElementById("competence-input")?.value || "";
    const target = document.getElementById("active-scope");
    if (!target) return;
    // The summary displays the input scope only, not an invented data freshness claim.
    if (!org || !/^\d{4}-(0[1-9]|1[0-2])$/.test(competence)) {
      target.textContent = "Aguardando escopo"; return;
    }
    const months = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    target.textContent = `${org.toUpperCase()} · ${months[Number(competence.slice(5)) - 1]} / ${competence.slice(0,4)}`;
  }
  const observer = new MutationObserver(refreshSignals);
  ["financial-metrics", "audit-metrics", "alerts-list", "transport-card", "freshness-card", "completeness-card"].forEach((id) => {
    const target = document.getElementById(id);
    if (target) observer.observe(target, {childList:true, subtree:true, characterData:true});
  });
  const content = document.getElementById("dashboard-content");
  if (content) observer.observe(content, {attributes:true, attributeFilter:["hidden"]});
  const narrowViewport = window.matchMedia("(max-width:950px)");
  narrowViewport.addEventListener("change", () => {
    if (!narrowViewport.matches) return;
    document.body.classList.remove("is-focus");
    const toggle = document.getElementById("focus-toggle");
    toggle?.setAttribute("aria-pressed", "false");
    const label = toggle?.querySelector("span");
    if (label) label.textContent = "Modo foco";
  });
  document.getElementById("focus-toggle")?.addEventListener("click", (event) => {
    const active = document.body.classList.toggle("is-focus");
    event.currentTarget.setAttribute("aria-pressed", String(active));
    event.currentTarget.querySelector("span").textContent = active ? "Sair do foco" : "Modo foco";
  });
  const details = document.getElementById("scope-controls");
  const filters = document.getElementById("filters-toggle");
  filters?.addEventListener("click", () => {
    if (!details) return;
    details.open = !details.open;
    if (details.open) document.getElementById("org-input")?.focus();
  });
  details?.addEventListener("toggle", () => filters?.setAttribute("aria-expanded", String(details.open)));
  document.getElementById("scope-form")?.addEventListener("submit", () => { refreshScope(); });
  const links = Array.from(document.querySelectorAll(".section-nav a"));
  links.forEach((link) => link.addEventListener("click", () => {
    links.forEach((item) => item.removeAttribute("aria-current"));
    link.setAttribute("aria-current", "location");
  }));
  // Refresh has no financial side effects here; the original controller owns all data work.
  refreshSignals();
})();
