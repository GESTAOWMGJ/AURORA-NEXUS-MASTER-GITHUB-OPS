/* Presentation only. Never reads credentials, fetches data, or unhides protected content. */
(() => {
  "use strict";
  function refreshSignals() {
    document.querySelectorAll(".money-card, #audit-metrics > div").forEach((card) => {
      const value = card.querySelector("dd")?.textContent?.trim() || "";
      const missing = !value || value.startsWith("—") || value.includes("não aferido");
      card.classList.toggle("is-unmeasured", missing);
      if (card.closest("#audit-metrics")) {
        card.classList.toggle("is-clear-count", !missing && /^0$/.test(value));
      }
    });
    const alerts = document.getElementById("alerts-section");
    if (alerts) {
      const critical = alerts.querySelector('[data-risk="CRITICAL"]');
      const high = alerts.querySelector('[data-risk="HIGH"]');
      alerts.dataset.signal = critical ? "CRITICAL" : high ? "HIGH" : "NONE";
    }
  }
  const observer = new MutationObserver(refreshSignals);
  ["financial-metrics", "audit-metrics", "alerts-list"].forEach((id) => {
    const node = document.getElementById(id);
    if (node) observer.observe(node, { childList: true, subtree: true, characterData: true });
  });
  refreshSignals();
})();
