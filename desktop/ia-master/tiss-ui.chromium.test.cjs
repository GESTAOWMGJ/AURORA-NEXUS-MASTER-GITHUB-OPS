'use strict';

// Opt-in acceptance test for the packaged master and the real Chromium UI.
// Inputs, identity, browser profile and account are exclusively synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const enabled = process.env.AURORA_TISS_CHROMIUM_TEST === '1';

test('packaged TISS UI pairs, analyzes XML, preserves ISO accents and clears session data', { skip: !enabled, timeout: 60000 }, async t => {
  assert(process.env.AURORA_TEST_BUILD, 'The UI test requires AURORA_TEST_BUILD.');
  const build = fs.realpathSync(process.env.AURORA_TEST_BUILD);
  const { createMaster } = require(path.join(build, 'server.cjs'));
  const modulePath = process.env.AURORA_TISS_PLAYWRIGHT_PATH || (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
    ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES, 'playwright') : 'playwright');
  let chromium;
  try { ({ chromium } = require(modulePath)); }
  catch { assert.fail('Opt-in UI test requires the test-only Playwright runtime.'); }
  const executablePath = process.env.AURORA_TISS_CHROMIUM_EXECUTABLE || chromium.executablePath();
  const pythonExecutable = process.env.AURORA_TISS_TEST_PYTHON;
  assert(pythonExecutable && path.isAbsolute(pythonExecutable), 'AURORA_TISS_TEST_PYTHON must name the test Python executable.');
  assert(fs.existsSync(executablePath), 'Install the test-only Chromium executable before enabling this test.');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-tiss-ui-'));
  const stateDir = path.join(temporary, 'state');
  let app, context;
  t.after(async () => {
    try { if (context) await context.close(); }
    finally {
      if (app?.server.listening) { app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); }
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
  const controlToken = crypto.randomBytes(32).toString('base64url'), orgId = 'synthetic-ui';
  let clockOffset = 0;
  app = createMaster({ stateDir, orgId, controlToken, port: 0,
    now: () => Date.now() + clockOffset,
    readModelState: async () => 'UNAVAILABLE', infer: async () => { throw Error('AI must not be called by XML billing'); },
    tissConfig: { schemaVersion: 'aurora.tiss.config.v1', orgId, pythonExecutable }
  });
  await app.listen();
  const origin = 'http://127.0.0.1:' + app.server.address().port;
  const ticketResponse = await fetch(origin + '/api/pair-ticket', {
    method: 'POST', headers: { Authorization: 'Bearer ' + controlToken, 'Content-Type': 'application/json', 'X-Aurora-Local': '1' }, body: '{}'
  });
  assert.equal(ticketResponse.status, 200);
  const { ticket } = await ticketResponse.json();
  context = await chromium.launchPersistentContext(path.join(temporary, 'profile'), {
    executablePath, headless: true, viewport: { width: 1400, height: 1000 },
    args: ['--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-quic',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']
  });
  let externalRequests = 0;
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests++; return route.abort('blockedbyclient');
  });
  const page = context.pages()[0] || await context.newPage(), pageErrors = [];
  await page.clock.install({ time: Date.now() });
  page.on('pageerror', error => pageErrors.push(error.message));
  const tissPost = (route, body) => page.evaluate(async ({ route, body }) => {
    const response = await fetch('/api/tiss/' + route, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Aurora-Local': '1' }, body: JSON.stringify(body) });
    return { status: response.status, value: await response.json() };
  }, { route, body });

  await page.goto(origin + '/#ticket=' + ticket, { waitUntil: 'load' });
  await page.locator('#workspace').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.getElementById('tiss-notice').textContent.includes('Motor pronto'));
  assert.equal(page.url(), origin + '/');
  assert.equal(await page.locator('#tiss-heading').textContent(), 'Faturamento TISS / SP-SADT');

  const fixtureAnalysisResponse = page.waitForResponse(response => response.url() === origin + '/api/tiss/analyze' && response.status() === 200);
  await page.locator('#tiss-example').click();
  const fixtureAnalysis = await (await fixtureAnalysisResponse).json();
  await page.locator('#tiss-analysis-panel').waitFor({ state: 'visible' });
  assert.equal(fixtureAnalysis.analysis.summary.totalCents, 10700);
  assert.equal(fixtureAnalysis.dataMode, 'PACKAGED_SYNTHETIC_FIXTURE');
  assert.match(await page.locator('#tiss-summary').textContent(), /107,00/);
  assert.match(await page.locator('#tiss-items').textContent(), /100,50/);
  assert.match(await page.locator('#tiss-items').textContent(), /Outras despesas/);
  assert.match(await page.locator('#tiss-items').textContent(), /6,50/);
  const issues = await page.locator('#tiss-issues').textContent();
  assert.match(issues, /XSD oficial pendente/); assert.match(issues, /Catálogo TUSS/); assert.match(issues, /contrato aplicável/);
  if (process.env.AURORA_TISS_UI_SCREENSHOT) {
    const screenshot = process.env.AURORA_TISS_UI_SCREENSHOT;
    assert(path.isAbsolute(screenshot), 'Screenshot test destination must be explicit.');
    await page.locator('#tiss-panel').screenshot({ path: screenshot });
  }

  const clearResponse = page.waitForResponse(response => response.url() === origin + '/api/tiss/clear');
  await page.locator('#tiss-clear').click();
  assert.equal((await clearResponse).status(), 200);
  await page.locator('#tiss-analysis-panel').waitFor({ state: 'hidden' });
  for (const id of ['tiss-summary', 'tiss-items', 'tiss-issues', 'tiss-plan-output', 'tiss-guides']) assert.equal(await page.locator('#' + id).textContent(), '');
  const cleared = await tissPost('plan', { analysisId: fixtureAnalysis.analysisId, guideIndex: 0 });
  assert.equal(cleared.status, 409); assert.equal(cleared.value.code, 'TISS_REIMPORT_REQUIRED');

  const latinDescription = 'PROCEDIMENTO SINTÉTICO COM AÇÃO E ÓRGÃO';
  const latinXml = fs.readFileSync(path.join(build, 'tiss-fixtures/sadt-valid.xml'), 'utf8')
    .replace('encoding="UTF-8"', 'encoding="ISO-8859-1"')
    .replace('PROCEDIMENTO SINTETICO SEM PACIENTE REAL', latinDescription);
  await page.locator('#tiss-file').setInputFiles({ name: 'tiss-iso-synthetic.xml', mimeType: 'application/xml', buffer: Buffer.from(latinXml, 'latin1') });
  await page.waitForFunction(() => !document.getElementById('tiss-analyze').disabled);
  const latinResponse = page.waitForResponse(response => response.url() === origin + '/api/tiss/analyze' && response.status() === 200);
  await page.locator('#tiss-analyze').click();
  const latinAnalysis = await (await latinResponse).json();
  await page.locator('#tiss-analysis-panel').waitFor({ state: 'visible' });
  assert.equal(latinAnalysis.analysis.guides[0].procedures[0].description, latinDescription);
  assert.match(await page.locator('#tiss-items').textContent(), /SINTÉTICO COM AÇÃO E ÓRGÃO/);
  assert.equal(await page.locator('#tiss-plan').isDisabled(), true);
  assert.equal(latinAnalysis.realPortalEnabled, false);

  // Advance the browser's real scheduled callback and the master's injected
  // clock, keeping the production 15-minute TTL unchanged. No long sleep.
  assert(Number.isFinite(Date.parse(latinAnalysis.expiresAt)));
  const expiryAdvance = 15 * 60 * 1000 + 1000;
  clockOffset += expiryAdvance;
  await page.clock.fastForward(expiryAdvance);
  await page.locator('#tiss-analysis-panel').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#tiss-notice').textContent(), /A análise expirou/);
  for (const id of ['tiss-summary', 'tiss-items', 'tiss-issues', 'tiss-plan-output', 'tiss-guides']) assert.equal(await page.locator('#' + id).textContent(), '');
  for (const id of ['tiss-analyze', 'tiss-plan', 'tiss-inspect', 'tiss-fill']) assert.equal(await page.locator('#' + id).isDisabled(), true);
  assert.equal(await page.locator('#tiss-file').inputValue(), '');
  const expired = await tissPost('plan', { analysisId: latinAnalysis.analysisId, guideIndex: 0 });
  assert.equal(expired.status, 409); assert.equal(expired.value.code, 'TISS_REIMPORT_REQUIRED');

  // Reimport after expiry confirms the UI can resume and obtains a new timer.
  await page.locator('#tiss-file').setInputFiles({ name: 'tiss-iso-synthetic.xml', mimeType: 'application/xml', buffer: Buffer.from(latinXml, 'latin1') });
  await page.waitForFunction(() => !document.getElementById('tiss-analyze').disabled);
  const reimportResponse = page.waitForResponse(response => response.url() === origin + '/api/tiss/analyze' && response.status() === 200);
  await page.locator('#tiss-analyze').click();
  const reimported = await (await reimportResponse).json();
  assert.equal(reimported.reused, false);
  await page.locator('#tiss-analysis-panel').waitFor({ state: 'visible' });
  assert.match(await page.locator('#tiss-items').textContent(), /SINTÉTICO COM AÇÃO E ÓRGÃO/);

  const cookies = await context.cookies(origin), sessionCookie = cookies.find(cookie => cookie.name === 'aurora_local');
  assert(sessionCookie?.httpOnly);
  const logoutResponse = page.waitForResponse(response => response.url() === origin + '/api/logout');
  await page.locator('#logout').click(); assert.equal((await logoutResponse).status(), 200);
  await page.locator('#workspace').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#tiss-items').textContent(), '');
  assert.equal(await page.locator('#tiss-summary').textContent(), '');
  const logoutNotice = await page.locator('#tiss-notice').textContent();
  await page.clock.fastForward(expiryAdvance);
  assert.equal(await page.locator('#tiss-notice').textContent(), logoutNotice, 'Logout cancels the old expiry callback.');
  assert.equal(await page.locator('#tiss-items').textContent(), '');
  const revoked = await fetch(origin + '/api/tiss/status', { headers: { Cookie: 'aurora_local=' + sessionCookie.value } });
  assert.equal(revoked.status, 401);
  const audit = fs.readFileSync(path.join(stateDir, 'audit.jsonl'), 'utf8');
  assert.equal(audit.includes(latinDescription), false); assert.equal(audit.includes('CARTEIRA-SINTETICA'), false);
  assert.equal(audit.includes('<ans:'), false);
  assert.deepEqual(pageErrors, []); assert.equal(externalRequests, 0); assert.equal(app.metrics.localModelCalls, 0);
  t.diagnostic('Real Chromium UI: ' + context.browser().version() + '; XML totals 10700 cents; ISO-8859-1 preserved; expiry/reimport/clear/logout verified.');
});
