'use strict';

// Optional end-to-end test. Uses only a fresh temporary browser profile and an
// HTTPS loopback fixture; never attaches to the user's browser or operator site.
// AURORA_TISS_CHROMIUM_TEST=1 enables it. Playwright/browser are test-only tools.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { createBrowserAdapter } = require('./tiss-browser.cjs');

const enabled = process.env.AURORA_TISS_CHROMIUM_TEST === '1';

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('real Chromium isolated world fills and reads back the synthetic HTTPS SADT form', { skip: !enabled, timeout: 60000 }, async t => {
  const modulePath = process.env.AURORA_TISS_PLAYWRIGHT_PATH || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
  let chromium;
  try { ({ chromium } = require(modulePath)); }
  catch { assert.fail('Opt-in Chromium test requires Playwright through AURORA_TISS_PLAYWRIGHT_PATH or the primary runtime.'); }
  const executablePath = process.env.AURORA_TISS_CHROMIUM_EXECUTABLE || chromium.executablePath();
  assert(fs.existsSync(executablePath), 'Opt-in Chromium test requires its test browser to be installed.');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-tiss-chromium-'));
  let server, context;
  t.after(async () => {
    try { if (context) await context.close(); }
    finally {
      if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
      fs.rmSync(scratch, { recursive: true, force: true });
    }
  });
  const key = path.join(scratch, 'fixture.key'), certificate = path.join(scratch, 'fixture.crt');
  const openssl = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', certificate,
    '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore', timeout: 10000 });
  assert.equal(openssl.status, 0, 'Generate the temporary synthetic HTTPS certificate.');
  let writeRequests = 0, externalRequests = 0;
  const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>AURORA TISS synthetic fixture</title>
    <form id="sadt"><label>Guia<input id="guide" type="text"></label><label>Procedimento<input id="code" type="text"></label>
    <label>Tabela<select id="table"><option value=""></option><option value="22">Procedimentos</option></select></label>
    <label>Data<input id="date" type="text"></label><label>Valor<input id="price" type="text"></label>
    <button type="submit">Synthetic submit sentinel</button></form>
    <script>window.syntheticSubmits=0;window.syntheticEvents=[];
    document.querySelector('form').addEventListener('submit',event=>{event.preventDefault();window.syntheticSubmits++;});
    for(const type of ['input','change']) document.querySelector('form').addEventListener(type,event=>window.syntheticEvents.push({type,id:event.target.id}));</script></html>`;
  server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(certificate) }, (req, res) => {
    if (req.method !== 'GET') writeRequests++;
    if (req.url !== '/billing/sadt' || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const portalOrigin = 'https://127.0.0.1:' + server.address().port, debuggingPort = await reservePort();
  context = await chromium.launchPersistentContext(path.join(scratch, 'profile'), {
    executablePath, headless: true, ignoreHTTPSErrors: true,
    args: ['--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + debuggingPort,
      '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-quic',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
  });
  t.diagnostic('Test browser: Chromium ' + context.browser().version());
  await context.route('**/*', route => {
    const url = new globalThis.URL(route.request().url());
    if (url.origin === portalOrigin) return route.continue();
    externalRequests++; return route.abort('blockedbyclient');
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(portalOrigin + '/billing/sadt', { waitUntil: 'load' });
  const adapter = createBrowserAdapter({ orgId: 'synthetic-org', config: {
    orgId: 'synthetic-org', debuggingOrigin: 'http://127.0.0.1:' + debuggingPort,
    portalOrigin, allowedPathPrefix: '/billing', fieldMap: {
      providerGuideNumber: '#guide', 'procedures.0.procedureCode': '#code', 'procedures.0.tableCode': '#table',
      requestDate: { selector: '#date', format: 'date-br' }, 'procedures.0.unitPrice': { selector: '#price', format: 'decimal-comma' }
    }
  } });
  const target = await adapter.inspect();
  const values = { providerGuideNumber: 'SYNTHETIC-123', 'procedures.0.procedureCode': '10101012', 'procedures.0.tableCode': '22',
    requestDate: '2026-10-21', 'procedures.0.unitPrice': '150.25' };
  const receipt = await adapter.fill({ fields: values, expectedTargetId: target.targetId, expectedUrl: target.url, planHash: 'a'.repeat(64) });
  assert.equal(receipt.state, 'FILLED_DRAFT'); assert.equal(receipt.changedCount, 5); assert.equal(receipt.readbackCount, 5);
  assert.equal(receipt.submissionAttemptedByAdapter, false); assert.equal(receipt.portalPersistenceVerified, false);
  assert.equal(await page.locator('#guide').inputValue(), 'SYNTHETIC-123');
  assert.equal(await page.locator('#code').inputValue(), '10101012');
  assert.equal(await page.locator('#table').inputValue(), '22');
  assert.equal(await page.locator('#date').inputValue(), '21/10/2026');
  assert.equal(await page.locator('#price').inputValue(), '150,25');
  assert.equal(await page.evaluate(() => window.syntheticSubmits), 0);
  assert.equal(await page.evaluate(() => window.syntheticEvents.length), 10);
  assert.equal(writeRequests, 0); assert.equal(externalRequests, 0);

  // A repeated same-value request produces no new input/change events.
  const repeated = await adapter.fill({ fields: values, expectedTargetId: target.targetId, expectedUrl: target.url, planHash: 'a'.repeat(64) });
  assert.equal(repeated.changedCount, 0); assert.equal(repeated.matchedCount, 5);
  assert.equal(await page.evaluate(() => window.syntheticEvents.length), 10);

  // A real existing-value conflict blocks every field before the first write.
  await page.locator('#guide').fill(''); await page.locator('#code').fill('SYNTHETIC-CONFLICT');
  const conflicting = await adapter.fill({ fields: values, expectedTargetId: target.targetId, expectedUrl: target.url, planHash: 'b'.repeat(64) });
  assert.equal(conflicting.state, 'NOT_FILLED'); assert.equal(conflicting.code, 'TISS_BROWSER_EXISTING_VALUE_CONFLICT');
  assert.equal(await page.locator('#guide').inputValue(), '');
  assert.equal(await page.evaluate(() => window.syntheticSubmits), 0); assert.equal(writeRequests, 0);
});
