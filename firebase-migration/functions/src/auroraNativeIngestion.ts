import { createHash } from 'node:crypto';
import { can, type AuroraMember } from './auroraAccess.js';

export const NATIVE_INGESTION_MAX_BYTES = 131072;
export const NATIVE_INGESTION_ORIGIN = 'https://auroranexus.com.br';
export function canImportNativeDocuments(member: AuroraMember): boolean {
  return member.allFacilities && member.mfaVerified
    && can(member, 'integrations.manage', ['platform_admin', 'org_admin', 'director']);
}
export type DocumentPrincipal = {orgId:string; keyId:string; name:string; member?:AuroraMember};
type Dependencies = {
  bearer: (authorization:unknown) => Promise<DocumentPrincipal|null>;
  session: (cookie:string|undefined) => Promise<AuroraMember|null>;
  csrf: (cookie:string|undefined, token:unknown) => boolean;
};
/** Explicit transport selection: an invalid bearer never falls back to a browser session. */
export async function authorizeDocumentIngestion(req:{get(name:string):string|undefined}, deps:Dependencies):
  Promise<{principal:DocumentPrincipal} | {status:number;code:string}> {
  const authorization = req.get('authorization');
  if (authorization !== undefined) {
    const principal = await deps.bearer(authorization);
    return principal ? {principal} : {status:401,code:'INVALID_INTEGRATION_KEY'};
  }
  if (req.get('origin') !== NATIVE_INGESTION_ORIGIN || req.get('sec-fetch-site') !== 'same-origin') {
    return {status:403,code:'CROSS_SITE_REJECTED'};
  }
  const member = await deps.session(req.get('cookie'));
  if (!member) return {status:401,code:'AUTH_REQUIRED'};
  if (!canImportNativeDocuments(member)) return {status:403,code:'MFA_AND_INTEGRATION_ADMIN_REQUIRED'};
  if (!deps.csrf(req.get('cookie'), req.get('x-aurora-csrf'))) return {status:403,code:'CSRF_REJECTED'};
  return {principal:{orgId:member.orgId,
    keyId:'web_'+createHash('sha256').update(`${member.orgId}:${member.uid}`).digest('hex').slice(0,32),
    name:'Importação autenticada',member}};
}
