import { AURORA_UPDATER_CHECK_INTERVAL_MS } from "./auroraNativeRoutines.js";

// The same updater serves browser, installed PWA and web-based desktop entry.
// It never caches private responses or forces a reload over unfinished work.
export function webUpdateClient(): string {
  return `
(() => {
  if (!('serviceWorker' in navigator)) return;
  const intervalMs = ${AURORA_UPDATER_CHECK_INTERVAL_MS};
  let registration = null, nextCheck = 0, pending = false, timer = null;
  function scheduleNextCheck() {
    clearTimeout(timer);
    timer = setTimeout(checkUpdate, Math.min(intervalMs, Math.max(0, nextCheck - Date.now())));
  }
  async function checkUpdate() {
    if (pending || navigator.onLine === false || document.visibilityState === 'hidden') return;
    if (Date.now() < nextCheck) { scheduleNextCheck(); return; }
    pending = true;
    try {
      if (!registration) registration = await navigator.serviceWorker.register('/service-worker.js', {updateViaCache:'none'});
      await registration.update();
      nextCheck = Date.now() + intervalMs;
    } catch { nextCheck = Date.now() + 15 * 60 * 1000; }
    finally {
      pending = false;
      scheduleNextCheck();
    }
  }
  document.addEventListener('visibilitychange', checkUpdate);
  window.addEventListener('online', checkUpdate);
  checkUpdate();
})();
`;
}
