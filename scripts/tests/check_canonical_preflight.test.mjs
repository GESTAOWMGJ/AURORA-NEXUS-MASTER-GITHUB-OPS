import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {
  CANONICAL_ORIGIN, MAX_RESPONSE_BYTES, CanonicalPreflightError,
  checkCanonicalPreflight, hasUsableLoginForm, requestCanonical,
} from '../../firebase-migration/scripts/check-canonical-preflight.mjs';

const project = 'wmgj-hml-jfn-20260927';
const form = '<form id="login-form"><input name="email" type="email"><input name="password" type="password"><button id="submit" type="submit">Entrar</button></form>';
const htmlHeaders = {'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store',
  'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff'};
const json = (status, value) => ({status, headers: {'content-type': 'application/json'}, body: JSON.stringify(value)});

function fixture(overrides = {}, resolveHost = async () => [{address: '192.0.2.1', family: 4}]) {
  const calls = [];
  const responses = {
    '/portal': {status: 200, headers: htmlHeaders, body: form},
    '/api/bootstrap': json(401, {ok: false, code: 'AUTH_REQUIRED'}),
    '/__/firebase/init.json': json(200, {projectId: project, apiKey: 'SYNTHETIC_CONFIG_MARKER'}),
    ...overrides,
  };
  return {
    calls, options: {resolveHost, transport: async path => {
      calls.push(path);
      if (responses[path] instanceof Error) throw responses[path];
      assert.ok(Object.hasOwn(responses, path));
      return responses[path];
    }},
  };
}

test('canonical portal, anonymous denial and Firebase project must all agree', async () => {
  const f = fixture();
  const proof = await checkCanonicalPreflight(project, f.options);
  assert.equal(proof.code, 'CANONICAL_ROUTE_READY');
  assert.equal(proof.origin, CANONICAL_ORIGIN);
  assert.equal(proof.expectedProject, project);
  assert.equal(proof.authenticated, false);
  assert.deepEqual(f.calls, ['/portal', '/api/bootstrap', '/__/firebase/init.json']);
  assert.equal(JSON.stringify(proof).includes('SYNTHETIC_CONFIG_MARKER'), false);
});

test('actual AuthGate login controls satisfy the anonymous preflight', () => {
  const source = readFileSync(new URL('../../firebase-migration/functions/src/auroraAuthGate.ts', import.meta.url), 'utf8');
  const login = source.slice(source.indexOf('function loginPage('), source.indexOf('export const auroraNexusAuthGate'));
  assert.equal(hasUsableLoginForm(login), true);
});

test('project scope cannot be extended to production or a different namespace', async () => {
  for (const value of ['', 'wmgj-prd', 'wmgj-hml-jfn-prod', 'wmgj-hml-jfn-live', 'https://example.test']) {
    const f = fixture();
    await assert.rejects(checkCanonicalPreflight(value, f.options), {code: 'HML_PROJECT_REQUIRED'});
    assert.deepEqual(f.calls, []);
  }
});

test('unresolved, empty or invalid DNS stops before HTTP', async () => {
  for (const resolver of [async () => {throw Error('SENSITIVE_DNS_DETAIL');}, async () => [], async () => [{address: 'example.test'}]]) {
    const f = fixture({}, resolver);
    await assert.rejects(checkCanonicalPreflight(project, f.options), {code: 'CANONICAL_DNS_FAILED'});
    assert.deepEqual(f.calls, []);
  }
});

test('self redirect, cross-origin redirect and login redirect are rejected without following', async () => {
  for (const location of [CANONICAL_ORIGIN + '/portal', 'https://example.test/portal', CANONICAL_ORIGIN + '/login']) {
    const f = fixture({'/portal': {status: 308, headers: {...htmlHeaders, location}, body: 'redirect'}});
    await assert.rejects(checkCanonicalPreflight(project, f.options), {code: 'CANONICAL_REDIRECT_REJECTED'});
    assert.deepEqual(f.calls, ['/portal']);
  }
});

test('HTTP error, non-HTML response, static placeholder and disabled login are rejected', async () => {
  for (const portal of [
    {status: 404, headers: htmlHeaders, body: form},
    {status: 200, headers: {'content-type': 'application/json'}, body: form},
    {status: 200, headers: htmlHeaders, body: '<h1>Ambiente privado</h1>'},
    {status: 200, headers: htmlHeaders, body: form.replace('<form ', '<form hidden ')},
    {status: 200, headers: htmlHeaders, body: form.replace('name="password"', 'disabled name="password"')},
    {status: 200, headers: htmlHeaders, body: form.replace('type="submit"', 'type="button"')},
    {status: 200, headers: htmlHeaders, body: form + '<h1>Centro de gestão WMGJ</h1>'},
  ]) {
    const f = fixture({'/portal': portal});
    await assert.rejects(checkCanonicalPreflight(project, f.options), CanonicalPreflightError);
    assert.deepEqual(f.calls, ['/portal']);
  }
});

test('commented controls, scripts and disabled fieldsets do not prove a usable form', () => {
  for (const html of ['<!--' + form + '-->', '<script>' + form + '</script>', '<template>' + form + '</template>',
    form.replace('<input ', '<fieldset disabled><input ').replace('</form>', '</fieldset></form>'),
    form.replace('<form ', '<form style="display:none" ')]) {
    assert.equal(hasUsableLoginForm(html), false);
  }
});

test('removal and reparsing payloads cannot create form or control tokens', () => {
  for (const html of [
    '<scr<script>ignored</script>ipt>' + form + '</script>',
    '<fo<!-- ignored -->rm id="login-form">' + form + '</form>',
    '<form id="login-form"><input na<!-- ignored -->me="email" type="email"><input name="password" type="password"><button id="submit" type="submit">Entrar</button></form>',
    '<!-- outer <!-- inner -->' + form + '-->',
    '<script><!--<script></script>' + form + '-->',
    '<template><template>ignored</template>' + form + '</template>',
    '<div data-content=\'' + form + '\'></div>',
  ]) {
    assert.equal(hasUsableLoginForm(html), false, html);
  }
});

test('nested inactive scopes and raw text never supply login controls', () => {
  for (const tag of ['script', 'style', 'textarea', 'title', 'iframe', 'xmp', 'noscript']) {
    assert.equal(hasUsableLoginForm('<' + tag + '>' + form + '</' + tag + '>'), false, tag);
  }
  for (const html of [
    '<template><template>' + form + '</template></template>',
    '<template><script>"</template>"</script>' + form + '</template>',
    '<div hidden>' + form + '</div>',
    '<div style="display:none">' + form + '</div>',
    '<svg>' + form + '</svg>', '<math>' + form + '</math>',
  ]) assert.equal(hasUsableLoginForm(html), false, html);
  const partial = '<form id="login-form"><input name="email" type="email"><button id="submit" type="submit">Entrar</button>';
  assert.equal(hasUsableLoginForm(partial + '<template><input name="password" type="password"></template></form>'), false);
});

test('quoted tag delimiters remain attribute values, while real active forms still pass', () => {
  assert.equal(hasUsableLoginForm('<div data-note=\'literal > <!-- <form>\'></div>' + form), true);
  assert.equal(hasUsableLoginForm('<template><template>' + form + '</template></template>' + form), true);
  assert.equal(hasUsableLoginForm('<script>const inert = "<form><template>";</script>' + form), true);
  assert.equal(hasUsableLoginForm(form.replace('name="email"', 'required name="email"')), true);
});

test('unclosed or malformed ranges and duplicate attributes fail closed', () => {
  for (const html of [
    '<!--' + form, '<script>' + form, '<style>' + form, '<template>' + form,
    '<template>' + form + '</script>', form + '<!-- unclosed', form + '<script>unclosed',
    '<div title=\'unterminated >' + form, form + '<div title="unterminated',
    '<form id="login-form" id="other"><input name="email" type="email"><input name="password" type="password"><button id="submit" type="submit">Entrar</button></form>',
    '<script/>' + form, '<template/>' + form, '<form id="login-form">' + form + '</form>',
  ]) assert.equal(hasUsableLoginForm(html), false, html);
});

test('deep inactive nesting within the response limit stays inactive', () => {
  const nested = '<template>'.repeat(4096) + form + '</template>'.repeat(4096);
  assert.ok(Buffer.byteLength(nested) < MAX_RESPONSE_BYTES);
  assert.equal(hasUsableLoginForm(nested), false);
  assert.equal(hasUsableLoginForm(nested + form), true);
});

test('portal security headers are required', async () => {
  for (const header of ['cache-control', 'x-frame-options', 'x-content-type-options']) {
    const headers = {...htmlHeaders};
    delete headers[header];
    const f = fixture({'/portal': {status: 200, headers, body: form}});
    await assert.rejects(checkCanonicalPreflight(project, f.options), {code: 'CANONICAL_PORTAL_HEADERS_REQUIRED'});
  }
});

test('anonymous bootstrap must be the actual AUTH_REQUIRED JSON contract', async () => {
  for (const response of [json(200, {ok: true}), json(403, {ok: false, code: 'AUTH_REQUIRED'}),
    json(401, {ok: false, code: 'OTHER'}), json(401, {ok: 'false', code: 'AUTH_REQUIRED'}),
    {status: 401, headers: htmlHeaders, body: '<h1>unauthorized</h1>'},
    {status: 401, headers: {'content-type': 'application/json'}, body: 'invalid'}]) {
    const f = fixture({'/api/bootstrap': response});
    await assert.rejects(checkCanonicalPreflight(project, f.options), {code: 'CANONICAL_ANONYMOUS_DENIAL_REQUIRED'});
    assert.deepEqual(f.calls, ['/portal', '/api/bootstrap']);
  }
});

test('legacy Firebase project and HTML init placeholders cannot pass', async () => {
  for (const response of [json(200, {projectId: 'auroranexus-legacy'}), json(200, {}),
    json(500, {projectId: project}), {status: 200, headers: htmlHeaders, body: '<h1>Firebase</h1>'}]) {
    const f = fixture({'/__/firebase/init.json': response});
    await assert.rejects(checkCanonicalPreflight(project, f.options), {code: 'CANONICAL_HML_PROJECT_MISMATCH'});
  }
});

test('HTTPS failures are reported without transport details or response dumps', async () => {
  const f = fixture({'/portal': Error('SENSITIVE_TLS_DETAIL')});
  await assert.rejects(checkCanonicalPreflight(project, f.options), error => {
    assert.equal(error.message, 'CANONICAL_HTTPS_FAILED');
    return true;
  });
});

test('large responses are rejected instead of accumulated as proof', async () => {
  const f = fixture({'/portal': {status: 200, headers: htmlHeaders, body: 'x'.repeat(MAX_RESPONSE_BYTES + 1)}});
  await assert.rejects(checkCanonicalPreflight(project, f.options), {code: 'CANONICAL_RESPONSE_TOO_LARGE'});
});

test('transport itself cannot send requests to another origin', async () => {
  await assert.rejects(requestCanonical('https://example.test/portal'), {code: 'CANONICAL_ORIGIN_REQUIRED'});
});

test('CLI rejects insecure TLS settings and invalid scope without network or secret output', () => {
  const script = new URL('../../firebase-migration/scripts/check-canonical-preflight.mjs', import.meta.url);
  const result = spawnSync(process.execPath, [fileURLToPath(script), project], {
    env: {...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', SYNTHETIC_SECRET: 'SECRET_SHOULD_NOT_PRINT'}, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /CANONICAL_TLS_CONFIGURATION_REJECTED/);
  assert.equal(result.stderr.includes('SECRET_SHOULD_NOT_PRINT'), false);
  const invalid = spawnSync(process.execPath, [fileURLToPath(script), 'production'], {encoding: 'utf8'});
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /HML_PROJECT_REQUIRED/);
});
