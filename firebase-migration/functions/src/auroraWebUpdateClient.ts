// The same updater serves browser, installed PWA and web-based desktop entry.
// It never caches private responses or forces a reload over unfinished work.
export function webUpdateClient(): string {
  return `
(() => {
  if (!('serviceWorker' in navigator)) return;
  const day = 24 * 60 * 60 * 1000;
  let registration = null, nextCheck = 0, pending = false;
  async function checkUpdate() {
    if (pending || navigator.onLine === false || document.visibilityState === 'hidden' || Date.now() < nextCheck) return;
    pending = true;
    try {
      if (!registration) registration = await navigator.serviceWorker.register('/service-worker.js', {updateViaCache:'none'});
      await registration.update();
      nextCheck = Date.now() + day;
    } catch { nextCheck = Date.now() + 15 * 60 * 1000; }
    finally { pending = false; }
  }
  document.addEventListener('visibilitychange', checkUpdate);
  window.addEventListener('online', checkUpdate);
  setInterval(checkUpdate, day);
  checkUpdate();
})();
`;
}
