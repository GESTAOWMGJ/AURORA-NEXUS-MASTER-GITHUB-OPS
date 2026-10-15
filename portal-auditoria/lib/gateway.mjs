import { ORG, MONTH, parseDashboard } from './contracts.mjs';
const MAX_BYTES = 262144;
function json(status, payload, requestId) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store, max-age=0',
    'Vary': 'Authorization, X-Firebase-AppCheck', 'X-Content-Type-Options': 'nosniff', 'X-Request-ID': requestId } });
}
async function boundedJson(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('CONTRACT');
  const length = response.headers.get('content-length');
  if (length && Number(length) > MAX_BYTES) throw new Error('CONTRACT');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('CONTRACT');
  const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('CONTRACT');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
// Função isolada para testes. A autoridade de identidade, papel e org permanece no FastAPI.
export async function dashboardGateway(request, env, fetchImpl = fetch) {
  const requestId = crypto.randomUUID();
  const fail = (status, code) => json(status, { code }, requestId);
  if (request.method !== 'GET') return fail(405, 'READ_ONLY');
  if (env.JFN_INTEGRATION_MODE !== 'homologation') return fail(503, 'INTEGRATION_DISABLED');
  const params = new URL(request.url).searchParams;
  const orgId = params.get('orgId'), competence = params.get('competence');
  if ([...params.keys()].some(k => !['orgId', 'competence'].includes(k)) ||
      params.getAll('orgId').length !== 1 || params.getAll('competence').length !== 1 ||
      !ORG.test(orgId ?? '') || !MONTH.test(competence ?? '')) return fail(400, 'INVALID_SCOPE');
  const allowed = (env.JFN_ALLOWED_ORGS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allowed.includes(orgId)) return fail(403, 'ORG_NOT_ALLOWED');
  const authorization = request.headers.get('authorization') ?? '';
  const appCheck = request.headers.get('x-firebase-appcheck') ?? '';
  if (!/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) return fail(401, 'AUTH_REQUIRED');
  if (!/^[A-Za-z0-9._-]{20,8192}$/.test(appCheck)) return fail(401, 'APP_CHECK_REQUIRED');
  let origin;
  try {
    origin = new URL(env.WMGJ_CONTROL_PLANE_ORIGIN);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash ||
        origin.pathname !== '/' || !origin.hostname.includes('.') || /^\d/.test(origin.hostname) ||
        /(^|\.)(localhost|local|internal)$/.test(origin.hostname)) throw new Error('CONFIG');
  } catch { return fail(503, 'UPSTREAM_NOT_CONFIGURED'); }
  const url = new URL(`/v1/organizations/${orgId}/dashboards/operational`, origin);
  url.searchParams.set('competence', competence);
  const timeout = AbortSignal.timeout(10000);
  const signal = AbortSignal.any([request.signal, timeout]);
  try {
    const upstream = await fetchImpl(url, { method: 'GET', cache: 'no-store', redirect: 'manual', signal,
      headers: { Authorization: authorization, 'X-Firebase-AppCheck': appCheck, 'X-Request-ID': requestId, Accept: 'application/json' } });
    if ([401, 403, 404, 429].includes(upstream.status)) {
      await upstream.body?.cancel();
      return fail(upstream.status, { 401: 'AUTH_REJECTED', 403: 'SCOPE_DENIED', 404: 'SNAPSHOT_NOT_FOUND', 429: 'UPSTREAM_RATE_LIMIT' }[upstream.status]);
    }
    if (!upstream.ok) { await upstream.body?.cancel(); return fail(502, 'UPSTREAM_UNAVAILABLE'); }
    const data = parseDashboard(await boundedJson(upstream), orgId, competence);
    return json(200, data, requestId);
  } catch {
    return fail(timeout.aborted ? 504 : 502, timeout.aborted ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_CONTRACT_OR_CONNECTION_FAILED');
  }
}
