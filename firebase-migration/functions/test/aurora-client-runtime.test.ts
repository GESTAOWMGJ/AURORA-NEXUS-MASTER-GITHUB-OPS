import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { auroraProtectedShell } from '../src/auroraFrontend.ts';
import { BrowserElement as Element, fixtureDom, addHandler, type Handler } from './aurora-browser-dom.fixture.ts';

const member = { uid: 'synthetic-u1', email: 'synthetic@example.test', orgId: 'wmgj', role: 'auditor' as const, permissions: ['distribution.approve'], facilityIds: [], allFacilities: true, mfaVerified: true };
function renderedShell(ready?: string, profile: Parameters<typeof auroraProtectedShell>[0] = member) {
  const previous = process.env.AURORA_CANONICAL_PORTAL_READY;
  if (ready === undefined) delete process.env.AURORA_CANONICAL_PORTAL_READY; else process.env.AURORA_CANONICAL_PORTAL_READY = ready;
  try { return auroraProtectedShell(profile, { action: 'synthetic-action', refresh: 'synthetic-refresh', integrationKey: 'synthetic-integration', distributionApproval: 'synthetic-distribution', logout: 'synthetic-logout' }); }
  finally { if (previous === undefined) delete process.env.AURORA_CANONICAL_PORTAL_READY; else process.env.AURORA_CANONICAL_PORTAL_READY = previous; }
}
const html = renderedShell();
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const snapshot = { projection: { competence: '2026-08', generatedAt: '2026-09-28T11:00:00Z', financialCents: { invoicedCents: 12345, receivedCents: 0, glossCents: null }, operations: { overdueActions: 0, openActions: 0 }, coverage: { evidencePercent: null, reconciliationPercent: 0 }, modules: [] }, actions: [] };

const response = (status = 200, body: unknown = snapshot) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
async function fixture(first = response(), hash = '', markup = html) {
  const { elements, document, handlers: docHandlers } = fixtureDom(markup);
  elements.get('content')!.hidden = true;
  const winHandlers = new Map<string, Handler>();
  const calls: { url: string; options: any }[] = []; const redirects: string[] = []; const intervals: { fn: Handler; ms: number }[] = []; const timeouts = new Map<number, Handler>(); let timerId = 0;
  let fetcher = async (_url: string, _options: any): Promise<any> => first;
  const location = { origin: 'https://auroranexus.com.br', hostname: 'auroranexus.com.br', search: '', hash, replace: (url: string) => redirects.push(url) };
  const context = createContext({ document, window: { addEventListener: (name: string, callback: Handler) => addHandler(winHandlers, name, callback), dispatchEvent: (event: Event) => { winHandlers.get(event.type)?.(event); return true; } }, navigator: { onLine: true }, location, history: { pushState: (_state: unknown, _unused: string, value: string) => { location.hash = value; } }, matchMedia: () => ({ matches: false }), Event, Intl, Date, AbortController, crypto: { randomUUID: () => 'synthetic-idempotency-key' }, setInterval: (fn: Handler, ms: number) => intervals.push({ fn, ms }), setTimeout: (fn: Handler) => { const id = ++timerId; timeouts.set(id, fn); return id; }, clearTimeout: (id: number) => timeouts.delete(id), fetch: (url: string, options: any) => { calls.push({ url, options }); return fetcher(url, options); } });
  [...markup.matchAll(/<script>([\s\S]*?)<\/script>/gi)].forEach(match => new Script(match[1]).runInContext(context));
  await setImmediate();
  return { elements, document, calls, redirects, intervals, timeouts, docHandlers, winHandlers, context, fetchWith(fn: typeof fetcher) { fetcher = fn; }, run(code: string) { return new Script(code).runInContext(context); }, async click(id: string) { const element = elements.get(id)!; await element.handlers.get('click')!({ currentTarget: element }); }, async submit(id: string) { const element = elements.get(id)!; await element.handlers.get('submit')!({ currentTarget: element, preventDefault() {} }); } };
}

test('the actual emitted browser script parses; missing regex delimiters fail this gate', () => {
  assert.equal(scripts.length, 1);
  scripts.forEach(script => assert.doesNotThrow(() => new Script(script)));
  const appScript = scripts.find(script => script.includes('value=>!/^[A-Za-z0-9._:-]'));
  assert.ok(appScript, 'The actual operational script must retain evidence validation');
  assert.throws(() => new Script(appScript.replace('value=>!/^[A-Za-z0-9._:-]', 'value=>!^[A-Za-z0-9._:-]')), SyntaxError);
});

test('runtime harness executes mixed-case HTML script tags before authenticated bootstrap and navigation', async () => {
  const markup = html.replaceAll('<script>', '<ScRiPt>').replaceAll('</script>', '</sCrIpT>');
  const f = await fixture(response(), '', markup);
  assert.equal(f.calls.filter(call => call.url === '/api/bootstrap').length, 1);
  assert.equal(f.elements.get('content')!.hidden, false);
  assert.equal(f.elements.get('received')!.textContent, 'R$\u00a00,00');
  const link = f.elements.get('portal-navigation')!.querySelector('a[href="#monthly-closing-summary"]')!;
  f.docHandlers.get('click')!({ target: link, preventDefault() {} });
  assert.equal(f.elements.get('monthly-closing-summary')!.closest('[data-page]')!.hidden, false);
  f.fetchWith(async () => response(401));
  await f.run('load()');
  assert.equal(f.elements.get('content')!.hidden, true);
  assert.equal(f.elements.get('received')!.textContent, '—');
});

test('the six organization navigation groups target real views and do not expose the Master view', () => {
  const { document } = fixtureDom(html);
  const links = document.getElementById('portal-navigation')!.querySelectorAll('a[href^="#"]');
  assert.equal(links.length, 6);
  for (const link of links) assert.ok(document.getElementById(link.getAttribute('href')!.slice(1))!.closest('[data-page]'));
  assert.equal(document.getElementById('ia-master'), null);
});

test('document and automation controls stay unique, permission-bound and collapsed inside settings', () => {
  for (const profile of [member, { ...member, role: 'org_admin' as const }, { ...member, role: 'org_admin' as const, mfaVerified: false }]) {
    const markup = renderedShell(undefined, profile), { document } = fixtureDom(markup);
    const settings = document.getElementById('settings')!, content = document.getElementById('content')!;
    const ingestion = document.getElementById('native-ingestion')!;
    assert.equal(ingestion.closest('[data-page]'), settings);
    assert.equal(content.contains(ingestion), true);
    assert.equal(ingestion.closest('details')!.getAttribute('open'), null);
    const mayConfigure = profile.role === 'org_admin' && profile.mfaVerified;
    for (const id of ['native-ingestion', 'native-ingestion-status']) assert.equal([...markup.matchAll(new RegExp('id="' + id + '"', 'g'))].length, 1);
    for (const id of ['native-ingestion-form', 'native-ingestion-file', 'native-ingestion-consent', 'automation-configuration-form', 'automation-key-id', 'automation-source-system', 'automation-configuration-consent', 'automation-configuration-status']) {
      assert.equal([...markup.matchAll(new RegExp('id="' + id + '"', 'g'))].length, mayConfigure ? 1 : 0);
      const control = document.getElementById(id);
      if (control) {
        assert.equal(control.closest('[data-page]'), settings);
        assert.equal(control.closest('details')!.getAttribute('open'), null);
      }
    }
  }
});

test('real navigation keeps technical controls away from Today and Finance without writing or changing financial values', async () => {
  const markup = renderedShell(undefined, { ...member, role: 'org_admin' });
  const f = await fixture(response(), '', markup);
  const visible = () => f.document.querySelectorAll('[data-page]').filter(node => !node.hidden).map(node => node.dataset.page);
  const menu = f.elements.get('portal-navigation')!, settings = f.elements.get('settings')!;
  const ingestion = f.elements.get('native-ingestion')!, automation = f.elements.get('automation-configuration-form')!;
  const initialCalls = f.calls.length, invoiced = f.elements.get('invoiced')!.textContent;
  assert.deepEqual(visible(), ['overview']);
  assert.equal(settings.hidden, true);
  assert.equal(f.elements.get('overview')!.children[0], f.elements.get('financial-focus'));
  const navigate = (link: Element) => {
    let prevented = false;
    f.docHandlers.get('click')!({ target: link.children[0] || link, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
  };
  navigate(menu.querySelector('a[href="#monthly-closing-summary"]')!);
  assert.deepEqual(visible(), ['finance']);
  assert.equal(settings.hidden, true);
  navigate(menu.querySelector('a[href="#overview"]')!);
  navigate(f.elements.get('overview')!.querySelector('a[href="#settings"]')!);
  assert.deepEqual(visible(), ['settings']);
  assert.equal(f.run('location.hash'), '#settings');
  assert.equal(f.elements.get('page-title')!.textContent, 'Sua operação, conectada.');
  assert.equal(menu.querySelectorAll('a[href^="#"]').filter(link => link.getAttribute('aria-current') === 'page').length, 1);
  assert.equal(ingestion.closest('details')!.getAttribute('open'), null);
  assert.equal(automation.closest('details')!.getAttribute('open'), null);
  f.run("location.hash='#native-ingestion'"); f.winHandlers.get('hashchange')!();
  assert.deepEqual(visible(), ['settings']);
  assert.equal(ingestion.closest('details')!.getAttribute('open'), '');
  assert.equal(f.document.activeElement, ingestion.querySelector('h2'));
  assert.equal(automation.closest('details')!.getAttribute('open'), null);
  navigate(menu.querySelector('a[href="#monthly-closing-summary"]')!);
  assert.deepEqual(visible(), ['finance']);
  assert.equal(settings.hidden, true);
  assert.equal(f.elements.get('invoiced')!.textContent, invoiced);
  assert.equal(f.calls.length, initialCalls);
  assert.equal(f.calls.every(call => !call.options?.method || call.options.method === 'GET'), true);
});

test('financial focus retains descriptive associations, period and SHADOW qualifications through real navigation, including unknown amounts', async () => {
  const scenarios = [
    { body: { ...snapshot, mode: 'SHADOW', financialStatus: { competence: '2031-11', amounts: { overduePayablesCents: 15001 } } }, value: 'R$\u00a0150,01', period: 'Competência 11/2031' },
    { body: { ...snapshot, mode: 'SHADOW', projection: { ...snapshot.projection, financialCents: {} }, financialStatus: { competence: 'unconfirmed', amounts: {} } }, value: 'Veja o resumo', period: 'Competência não confirmada' }
  ];
  for (const scenario of scenarios) {
    const f = await fixture(response(200, scenario.body));
    const panel = f.elements.get('financial-focus')!, next = f.elements.get('focus-next')!;
    const explanation = f.elements.get('focus-explanation')!, period = f.elements.get('focus-period')!;
    const describedText = (element: Element) => (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => {
      const referenced = f.document.getElementById(id);
      assert.ok(referenced, 'Description resolves to an existing emitted node: ' + id);
      assert.equal(panel.contains(referenced), true);
      return referenced.textContent;
    }).join(' ');
    const assertReading = () => {
      assert.equal(f.elements.get('content')!.hidden, false);
      assert.equal(f.elements.get('overview')!.hidden, false);
      assert.equal(panel.getAttribute('aria-labelledby'), 'focus-title');
      assert.ok(f.document.getElementById(panel.getAttribute('aria-labelledby')!)!.textContent);
      assert.equal(f.elements.get('focus-value')!.textContent, scenario.value);
      assert.equal(period.textContent, scenario.period);
      assert.match(explanation.textContent, /Valores do recorte\. Complete as fontes antes de decidir\./);
      assert.match(explanation.textContent, /Modo SHADOW: leitura observacional; não libera distribuição ou movimentação financeira\./);
      assert.equal(describedText(panel), explanation.textContent);
      assert.equal(describedText(next), explanation.textContent + ' ' + scenario.period);
      assert.ok(panel.children.indexOf(f.elements.get('focus-value')!.parentElement!) < panel.children.indexOf(explanation));
    };
    assertReading();
    if (scenario.value === 'Veja o resumo') {
      assert.equal(f.elements.get('invoiced')!.textContent, 'Sem fonte');
      assert.equal(f.elements.get('received')!.textContent, 'Sem fonte');
    }
    const initialCalls = f.calls.length;
    f.docHandlers.get('click')!({ target: next, preventDefault() {} });
    assert.equal(f.elements.get('monthly-closing-summary')!.closest('[data-page]')!.hidden, false);
    assert.equal(f.elements.get('overview')!.hidden, true);
    const back = f.elements.get('portal-navigation')!.querySelector('a[href="#overview"]')!;
    f.docHandlers.get('click')!({ target: back, preventDefault() {} });
    assertReading();
    assert.equal(f.calls.length, initialCalls);
  }
});

test('bootstrap renders only returned values and distinguishes absent data from zero', async () => {
  const f = await fixture(response(200, { projection: { financialCents: { receivedCents: 0 }, operations: {} }, actions: [] }));
  assert.equal(f.elements.get('overdue')!.textContent, 'Sem fonte');
  assert.equal(f.elements.get('openActions')!.textContent, 'Sem fonte para ações abertas');
  assert.equal(f.elements.get('invoiced')!.textContent, 'Sem fonte');
  assert.match(f.elements.get('received')!.textContent, /0,00/);
  assert.equal(f.elements.get('content')!.hidden, false);
  assert.equal(f.calls[0].options.cache, 'no-store');
  assert.equal(f.calls[0].options.credentials, 'same-origin');
});

test('periodic updates are authenticated GET-only and preserve manual engine execution', async () => {
  const f = await fixture();
  assert.equal(f.intervals.length, 1); assert.equal(f.intervals[0].ms, 60000);
  await f.intervals[0].fn();
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.url === '/api/bootstrap' && !call.options.method));
  assert.equal(f.elements.get('overdue')!.textContent, '0');
});

test('polling pauses when hidden, offline, editing, resolving or mutating', async () => {
  const f = await fixture();
  f.document.visibilityState = 'hidden'; await f.intervals[0].fn();
  f.document.visibilityState = 'visible'; f.run('navigator.onLine=false'); await f.intervals[0].fn();
  f.run('navigator.onLine=true'); const field = new Element('', 'input'); new Element('', 'form').appendChild(field); f.document.activeElement = field; await f.intervals[0].fn();
  f.document.activeElement = null; f.run('selectedResolution={id:"synthetic"}'); await f.intervals[0].fn();
  f.run('selectedResolution=null;mutationsInFlight=1'); await f.intervals[0].fn();
  assert.equal(f.calls.length, 1);
});

test('network errors become visible and never present stale values as current', async () => {
  const f = await fixture(); f.fetchWith(async () => { throw new Error('network unavailable'); });
  await f.run('load()');
  assert.equal(f.elements.get('notice')!.hidden, false);
  assert.equal(f.elements.get('content')!.hidden, true);
  assert.match(f.elements.get('notice')!.textContent, /valores anteriores/);
  f.fetchWith(async () => response()); await f.run('load()');
  assert.equal(f.elements.get('content')!.hidden, false);
  assert.equal(f.elements.get('notice')!.hidden, true);
});

for (const status of [401, 403]) test('authorization ' + status + ' removes private view and stops automatic reads', async () => {
  const f = await fixture(); f.fetchWith(async () => response(status)); await f.run('load()');
  assert.equal(f.elements.get('content')!.hidden, true);
  assert.equal(f.elements.get('notice')!.hidden, false);
  assert.equal(f.elements.get('invoiced')!.textContent, '—');
  assert.equal(f.elements.get('session-identity')!.textContent, '');
  assert.equal(f.elements.get('actions')!.children.length, 0);
  assert.equal(f.elements.get('refresh')!.disabled, true);
  const count = f.calls.length; await f.intervals[0].fn(); assert.equal(f.calls.length, count);
  assert.equal(f.redirects.length, status === 401 ? 1 : 0);
});

test('late bootstrap response cannot restore private data after logout', async () => {
  const f = await fixture(); let complete!: (value: unknown) => void;
  f.fetchWith(async url => url === '/api/bootstrap' ? new Promise(resolve => { complete = resolve; }) : response());
  const pending = f.run('load()'); await f.click('logout'); complete(response()); await pending;
  assert.equal(f.elements.get('content')!.hidden, true);
  assert.equal(f.elements.get('invoiced')!.textContent, '—');
  assert.deepEqual(f.redirects, ['/portal']);
});

test('failed logout does not claim server session termination and can be retried', async () => {
  const f = await fixture(); f.fetchWith(async () => response(500)); await f.click('logout');
  assert.equal(f.redirects.length, 0); assert.equal(f.elements.get('content')!.hidden, true);
  assert.match(f.elements.get('notice')!.textContent, /servidor não foi confirmado/);
  assert.equal(f.elements.get('logout')!.disabled, false);
  f.fetchWith(async () => response()); await f.click('logout'); assert.deepEqual(f.redirects, ['/portal']);
});

test('timeout aborts the read and reports unconfirmed freshness', async () => {
  const f = await fixture();
  f.fetchWith(async (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')))));
  const pending = f.run('load()'); assert.equal(f.timeouts.size, 1);
  [...f.timeouts.values()][0](); await pending;
  assert.equal(f.elements.get('content')!.hidden, true);
  assert.equal(f.elements.get('notice')!.hidden, false);
  assert.equal(f.timeouts.size, 0);
});

test('manager can create a structured action directly in the app', async () => {
  const f = await fixture();
  f.elements.get('review-target-type')!.value = 'managementInput';
  f.elements.get('review-title')!.value = 'Atualizar faturamento e relatório atual';
  f.elements.get('review-details')!.value = 'Conferir pendências e registrar evidência no fluxo do app.';
  f.elements.get('review-reason')!.value = 'MANUAL_REVIEW';
  f.elements.get('review-risk')!.value = 'HIGH';
  f.elements.get('review-due')!.value = '2026-10-02';
  await f.submit('create-review');
  const write = f.calls.find(call => call.url === '/api/actions' && call.options.method === 'POST');
  assert.ok(write);
  const body = JSON.parse(write.options.body);
  assert.equal(body.targetType, 'managementInput');
  assert.match(body.targetId, /^mgmt-/);
  assert.equal(body.title, 'Atualizar faturamento e relatório atual');
  assert.equal(body.riskLevel, 'HIGH');
  assert.equal(write.options.headers['X-Aurora-CSRF'], 'synthetic-action');
});

test('invalid evidence identifiers do not trigger a write; valid identifiers do', async () => {
  const f = await fixture();
  f.run('selectedResolution={id:"synthetic-action",revision:1,riskLevel:"LOW"}');
  f.elements.get('resolve-code')!.value = 'EVIDENCE_CONFIRMED';
  f.elements.get('resolve-evidence')!.value = '../invalid'; await f.submit('resolve-review');
  assert.equal(f.calls.length, 1);
  f.elements.get('resolve-evidence')!.value = 'synthetic-doc-1, synthetic-doc-2'; await f.submit('resolve-review');
  const write = f.calls.find(call => call.url === '/api/actions'); assert.ok(write);
  assert.equal(write.options.method, 'POST');
  assert.equal(write.options.headers['X-Aurora-CSRF'], 'synthetic-action');
  assert.deepEqual(JSON.parse(write.options.body).evidenceRefs, ['synthetic-doc-1', 'synthetic-doc-2']);
});

test('newer bootstrap wins when an older request finishes later', async () => {
  const f = await fixture(); let complete!: (value: unknown) => void;
  f.fetchWith(async () => new Promise(resolve => { complete = resolve; })); const old = f.run('load()');
  f.fetchWith(async () => response(200, { ...snapshot, projection: { ...snapshot.projection, operations: { overdueActions: 9, openActions: 9 } } }));
  await f.run('load()'); complete(response()); await old;
  assert.equal(f.elements.get('overdue')!.textContent, '9');
});


test('simplified monthly closing renders evidence-preserving values and blocks approval without gate', async () => {
  const f = await fixture(response(200, {
    ...snapshot,
    financialStatus: {
      competence: '2026-09',
      snapshotHash: 'a'.repeat(64),
      sourceComplete: true,
      distributionGateState: 'PENDING',
      canApproveDistribution: false,
      amounts: {
        overduePayablesCents: 120000,
        upcomingPayablesCents: 350000,
        expectedRevenueCents: 5000000,
        cashBalanceCents: 3600000,
        revenueToCashGapCents: 1400000,
        currentDueCents: 120000,
        nextDueCents: 180000,
        receivableUntilCurrentDueCents: null,
        receivableUntilNextDueCents: 900000,
        totalReceivableCents: 1200000,
        distributableCents: null
      },
      dueDates: { currentDueDate: '2026-10-03', nextDueDate: '2026-10-10' },
      decision: null
    }
  }));
  assert.match(f.elements.get('closing-overdue-payables')!.textContent, /1\.200,00/);
  assert.match(f.elements.get('closing-cash-balance')!.textContent, /36\.000,00/);
  assert.equal(f.elements.get('closing-receivable-current')!.textContent, 'Sem fonte');
  assert.equal(f.elements.get('distribution-approve')!.disabled, true);
  assert.match(f.elements.get('distribution-decision-status')!.textContent, /Aguardando/);
});

test('manager distribution approval posts a decision only and never a payment command', async () => {
  const f = await fixture(response(200, {
    ...snapshot,
    financialStatus: {
      competence: '2026-08',
      snapshotHash: 'b'.repeat(64),
      sourceComplete: true,
      distributionGateState: 'ELIGIBLE',
      canApproveDistribution: true,
      amounts: { distributableCents: 2500000 },
      dueDates: {},
      decision: null
    }
  }));
  f.elements.get('distribution-reason')!.value = 'Fechamento revisado e aprovado pelo gestor.';
  await f.click('distribution-approve');
  const write = f.calls.find(call => call.url === '/api/distribution-approval');
  assert.ok(write);
  assert.equal(write.options.method, 'POST');
  assert.equal(write.options.headers['X-Aurora-CSRF'], 'synthetic-distribution');
  const body = JSON.parse(write.options.body);
  assert.equal(body.decision, 'APPROVE');
  assert.equal(body.snapshotHash, 'b'.repeat(64));
  assert.equal(body.expectedRevision, 0);
  assert.ok(!('payment' in body));
  assert.ok(!('transfer' in body));
});


test('canonical redirect guard preserves route context only for the known HML hosts', () => {
  const guardedScripts = [...renderedShell('true').matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const guards = guardedScripts.filter(script => script.includes('location.hostname'));
  assert.equal(guards.length, 1);
  for (const hostname of ['wmgj-hml-jfn-20260927.web.app', 'WMGJ-HML-JFN-20260927.FIREBASEAPP.COM', 'auroranexus.com.br', 'unrelated.invalid']) {
    const redirects: string[] = [];
    const location = { hostname, search: '?returnTo=%2Fsetup', hash: '#pending', replace: (url: string) => redirects.push(url) };
    new Script(guards[0]).runInContext(createContext({ location }));
    const isHml = hostname.toLowerCase().startsWith('wmgj-hml-jfn-20260927.');
    assert.deepEqual(redirects, isHml ? ['https://auroranexus.com.br/portal?returnTo=%2Fsetup#pending'] : []);
  }
});

test('deep anchors select one parent view and move focus without dropping financial or action context', async () => {
  const f = await fixture(response(), '#monthly-closing-summary');
  const visible = () => f.document.querySelectorAll('[data-page]').filter(node => !node.hidden).map(node => node.dataset.page);
  assert.deepEqual(visible(), ['finance']);
  assert.equal(f.elements.get('invoiced')!.textContent.includes('123,45'), true);
  f.run("revealAuroraSection('#create-review-card', true)");
  assert.deepEqual(visible(), ['actions']);
  const card = f.elements.get('create-review-card')!;
  assert.equal(card.closest('details')!.getAttribute('open'), '');
  assert.equal(f.document.activeElement, card.querySelector('h2'));
  assert.equal(f.document.activeElement!.tabIndex, -1);
  assert.equal((f.document.activeElement!.lastFocus as { preventScroll: boolean }).preventScroll, true);
  f.run("revealAuroraSection('#unrecognized', true)");
  assert.deepEqual(visible(), ['overview']);
  assert.equal(f.calls.length, 1);
});

test('mobile menu closes on navigation and Escape restores focus to the menu button', async () => {
  const f = await fixture(); const menu = f.elements.get('portal-navigation')!, button = f.elements.get('menu-toggle')!;
  await f.click('menu-toggle'); assert.equal(button.getAttribute('aria-expanded'), 'true');
  const link = menu.querySelectorAll('a[href^="#"]')[1]; let prevented = false;
  f.docHandlers.get('click')!({ target: link.children[0], preventDefault() { prevented = true; } });
  assert.equal(prevented, true); assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(menu.classList.contains('menu-open'), false);
  assert.equal(f.run('location.hash'), '#monthly-closing-summary');
  assert.equal(menu.querySelectorAll('a[href^="#"]').filter(item => item.getAttribute('aria-current') === 'page').length, 1);
  await f.click('menu-toggle'); f.docHandlers.get('keydown')!({ key: 'Escape' });
  assert.equal(button.getAttribute('aria-expanded'), 'false'); assert.equal(f.document.activeElement, button);
});
