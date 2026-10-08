import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CANONICAL_ORIGIN = 'https://auroranexus.com.br';
export const MAX_RESPONSE_BYTES = 262144;
const TIMEOUT_MS = 20000;

export class CanonicalPreflightError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function requireCondition(condition, code) {
  if (!condition) throw new CanonicalPreflightError(code);
}

// The origin is fixed. TLS verification and redirect rejection are never optional.
export function requestCanonical(path) {
  return new Promise((resolveResponse, reject) => {
    const url = new URL(path, CANONICAL_ORIGIN);
    if (url.origin !== CANONICAL_ORIGIN) {
      reject(new CanonicalPreflightError('CANONICAL_ORIGIN_REQUIRED'));
      return;
    }
    const fail = code => reject(new CanonicalPreflightError(code));
    const req = request(url, {
      method: 'GET', rejectUnauthorized: true, minVersion: 'TLSv1.2',
      headers: {Accept: path === '/portal' ? 'text/html' : 'application/json'},
    }, res => {
      if (!res.socket.authorized) {
        res.destroy();
        fail('CANONICAL_TLS_FAILED');
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          res.destroy();
          fail('CANONICAL_RESPONSE_TOO_LARGE');
          return;
        }
        chunks.push(chunk);
      });
      res.on('error', () => fail('CANONICAL_HTTPS_FAILED'));
      res.on('end', () => resolveResponse({
        status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    const timer = setTimeout(() => {
      req.destroy();
      fail('CANONICAL_HTTPS_TIMEOUT');
    }, TIMEOUT_MS);
    req.on('close', () => clearTimeout(timer));
    req.on('error', () => fail('CANONICAL_HTTPS_FAILED'));
    req.end();
  });
}

function attributes(tag) {
  const values = new Map();
  for (const match of tag.matchAll(/\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    values.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return values;
}

function usable(attributes) {
  return !attributes.has('disabled') && !attributes.has('hidden')
    && !attributes.has('readonly')
    && !/display\s*:\s*none|visibility\s*:\s*hidden/i.test(attributes.get('style') || '');
}

export function hasUsableLoginForm(html) {
  const visible = html.replace(/<!--[\s\S]*?-->|<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  const forms = [...visible.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form\s*>/gi)];
  return forms.some(([, opening, content]) => {
    const form = attributes(opening);
    if (form.get('id') !== 'login-form' || !usable(form)
      || /<fieldset\b[^>]*\bdisabled\b/i.test(content)) return false;
    const controls = [...content.matchAll(/<(?:input|button)\b[^>]*>/gi)].map(match => attributes(match[0]));
    return controls.some(a => a.get('type') === 'email' && a.get('name') === 'email' && usable(a))
      && controls.some(a => a.get('type') === 'password' && a.get('name') === 'password' && usable(a))
      && controls.some(a => a.get('id') === 'submit' && a.get('type') === 'submit' && usable(a));
  });
}

async function checkedResponse(transport, path) {
  let response;
  try { response = await transport(path); }
  catch (error) {
    if (error instanceof CanonicalPreflightError) throw error;
    throw new CanonicalPreflightError('CANONICAL_HTTPS_FAILED');
  }
  requireCondition(response && typeof response.body === 'string', 'CANONICAL_RESPONSE_INVALID');
  requireCondition(Buffer.byteLength(response.body) <= MAX_RESPONSE_BYTES, 'CANONICAL_RESPONSE_TOO_LARGE');
  requireCondition(!(response.status >= 300 && response.status < 400), 'CANONICAL_REDIRECT_REJECTED');
  return response;
}

function jsonBody(response, code) {
  requireCondition(/^application\/json\b/i.test(response.headers?.['content-type'] || ''), code);
  try { return JSON.parse(response.body); }
  catch { throw new CanonicalPreflightError(code); }
}

// Anonymous GETs only: this proves routing readiness, never login or release approval.
export async function checkCanonicalPreflight(expectedProject, {
  resolveHost = hostname => lookup(hostname, {all: true}), transport = requestCanonical,
} = {}) {
  requireCondition(/^wmgj-hml-jfn-[a-z0-9-]+$/.test(expectedProject || '')
    && !/prod|production|live|principal/i.test(expectedProject), 'HML_PROJECT_REQUIRED');
  let addresses;
  let dnsTimer;
  try {
    addresses = await Promise.race([
      resolveHost(new URL(CANONICAL_ORIGIN).hostname),
      new Promise((_, reject) => { dnsTimer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), TIMEOUT_MS); }),
    ]);
  }
  catch { throw new CanonicalPreflightError('CANONICAL_DNS_FAILED'); }
  finally { clearTimeout(dnsTimer); }
  requireCondition(Array.isArray(addresses) && addresses.length > 0
    && addresses.every(entry => isIP(entry.address)), 'CANONICAL_DNS_FAILED');

  const portal = await checkedResponse(transport, '/portal');
  requireCondition(portal.status === 200
    && /^text\/html\b/i.test(portal.headers?.['content-type'] || ''), 'CANONICAL_PORTAL_HTTP_INVALID');
  requireCondition(hasUsableLoginForm(portal.body)
    && !portal.body.includes('Centro de gestão WMGJ'), 'CANONICAL_LOGIN_FORM_REQUIRED');
  requireCondition(/(?:^|,)\s*no-store\b/i.test(portal.headers?.['cache-control'] || '')
    && /^DENY$/i.test(portal.headers?.['x-frame-options'] || '')
    && /^nosniff$/i.test(portal.headers?.['x-content-type-options'] || ''), 'CANONICAL_PORTAL_HEADERS_REQUIRED');

  const bootstrap = await checkedResponse(transport, '/api/bootstrap');
  const anonymous = jsonBody(bootstrap, 'CANONICAL_ANONYMOUS_DENIAL_REQUIRED');
  requireCondition(bootstrap.status === 401 && anonymous?.ok === false
    && anonymous?.code === 'AUTH_REQUIRED', 'CANONICAL_ANONYMOUS_DENIAL_REQUIRED');

  const init = await checkedResponse(transport, '/__/firebase/init.json');
  const config = jsonBody(init, 'CANONICAL_HML_PROJECT_MISMATCH');
  requireCondition(init.status === 200 && config?.projectId === expectedProject, 'CANONICAL_HML_PROJECT_MISMATCH');
  return {
    code: 'CANONICAL_ROUTE_READY', origin: CANONICAL_ORIGIN, expectedProject,
    dnsResolved: true, httpsVerified: true, loginFormVerified: true,
    anonymousDenied: true, firebaseProjectMatched: true, authenticated: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCondition(process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'CANONICAL_TLS_CONFIGURATION_REJECTED');
    console.log(JSON.stringify(await checkCanonicalPreflight(process.argv[2])));
  } catch (error) {
    console.error(error instanceof CanonicalPreflightError ? error.code : 'CANONICAL_PREFLIGHT_FAILED');
    process.exitCode = 1;
  }
}
